import { Room, Client } from '@colyseus/core';
import { Schema, MapSchema, ArraySchema, type } from '@colyseus/schema';
import {
  Card,
  ComboSize,
  FiveCardComboKind,
  RealtimeErrorCode,
  ThirteenTreePokerAction,
  ThirteenTreePokerMatchResult,
  ThirteenTreePokerRoundResult,
} from 'party-shared-types';
import { verifyJoinToken, JoinTokenPayload } from '../realtime/joinToken';
import { dealHands } from '../games/thirteenTreePoker/deck';
import { classifyCombo, compareCombos } from '../games/thirteenTreePoker/combos';
import { supabase } from '../db/supabase';

const RECONNECTION_GRACE_SECONDS = 60;
const PLAYERS_PER_MATCH = 4;
const CARDS_PER_PLAYER = 13;
const STARTING_CARD: Card = '3D';

class PlayerState extends Schema {
  @type('string') userId = '';
  @type('string') displayName = '';
  @type('number') seatIndex = 0;
  @type('boolean') connected = true;
  @type('boolean') isHost = false;
  @type('number') cardCount = 0;
  @type('number') matchScore = 0;
  @type('boolean') hasPassed = false;
  @type('boolean') eliminated = false;
  @type('number') placement = 0; // 0 = undetermined; 1 (winner)..4 (first eliminated) once set
}

class ThirteenTreePokerState extends Schema {
  @type('string') status = 'waiting'; // waiting | dealt | playing | round_end | match_end
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type('string') currentTurnUserId = '';
  @type('string') leaderUserId = ''; // must play freely (no combo to beat) on their turn
  @type(['string']) lastComboCards = new ArraySchema<string>(); // empty = current turn leads freely
  @type('string') lastComboSize = ''; // '' | single | pair | triple | five
  @type('string') lastComboFiveKind = ''; // only set when lastComboSize === 'five'
  @type('string') lastComboPlayedBy = '';
  @type('number') targetScore = 30;
  @type('number') roundNumber = 0;
}

interface SeatEntry {
  sessionId: string;
  player: PlayerState;
}

export class ThirteenTreePokerRoom extends Room<{ state: ThirteenTreePokerState }> {
  maxClients = PLAYERS_PER_MATCH;

  private processedActionIds = new Set<string>();
  private hands = new Map<string, Card[]>(); // sessionId -> hand
  private supabaseRoomId: string | null = null;
  private matchStartedAt = 0;
  private eliminatedCount = 0; // how many of the 4 have been eliminated so far this match

  onCreate(options: { targetScore?: number; code?: string }) {
    this.state = new ThirteenTreePokerState();
    this.state.targetScore = options?.targetScore ?? 30;
    this.onMessage('action', (client, message: ThirteenTreePokerAction) => this.handleAction(client, message));

    // Exposes the human-friendly room code via matchMaker.query()/metadata, so an
    // admin listing (GET /rooms/live) can show which live room is which — the
    // code otherwise only lives inside filterBy's internal bookkeeping.
    if (options?.code) this.setMetadata({ code: options.code });
  }

  // Verifies the short-lived join token issued by POST /rooms or /rooms/join so a
  // client can't fake another user's identity when opening the WS connection directly.
  onAuth(_client: Client, options: { joinToken?: string }): JoinTokenPayload {
    if (!options?.joinToken) throw new Error('Missing join token');
    return verifyJoinToken(options.joinToken);
  }

  onJoin(client: Client, options: { displayName?: string }) {
    const { userId, roomId } = client.auth as JoinTokenPayload;
    this.supabaseRoomId = roomId;

    const player = new PlayerState();
    player.userId = userId;
    player.displayName = options.displayName ?? 'Player';
    player.seatIndex = this.state.players.size;
    player.isHost = this.state.players.size === 0;
    this.state.players.set(client.sessionId, player);
  }

  // Connection dropped without an explicit leave (refresh, network blip). Mark the
  // seat as disconnected but keep it reserved so the client can rejoin and resync.
  onDrop(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;

    this.allowReconnection(client, RECONNECTION_GRACE_SECONDS).catch(() => {
      // Window expired or reconnection was rejected — onLeave() does the final cleanup.
    });
  }

  onReconnect(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;

    // A resumed connection doesn't replay past client.send() calls, so resend their hand.
    const hand = this.hands.get(client.sessionId);
    if (hand) client.send('hand', { hand });
  }

  // Final departure — either a consented leave, or the reconnection window from
  // onDrop() ran out. Either way the seat is gone for good.
  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.hands.delete(client.sessionId);
  }

  private handleAction(client: Client, message: ThirteenTreePokerAction) {
    if (this.processedActionIds.has(message.actionId)) {
      client.send('error', { code: RealtimeErrorCode.DUPLICATE_ACTION, message: 'Action already processed' });
      return;
    }
    this.processedActionIds.add(message.actionId);

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (message.type === 'deal_cards') {
      this.handleDealCards(client, player);
      return;
    }
    if (message.type === 'start_game') {
      this.handleStartGame(client, player);
      return;
    }

    // play_cards/pass are only meaningful once start_game has flipped the room
    // to 'playing' — reject them during 'waiting'/'dealt'/'round_end'/'match_end'
    // instead of relying on currentTurnUserId happening to not match.
    if (this.state.status !== 'playing') {
      client.send('error', { code: RealtimeErrorCode.INVALID_ACTION, message: 'Round has not started yet' });
      return;
    }

    if (player.userId !== this.state.currentTurnUserId) {
      client.send('error', { code: RealtimeErrorCode.NOT_YOUR_TURN, message: 'Not your turn' });
      return;
    }

    if (message.type === 'play_cards') {
      this.handlePlayCards(client, player, message.payload.cards);
    } else if (message.type === 'pass') {
      this.handlePass(client, player);
    }
  }

  // --- deal / start (two-step, host-driven, repeats every round) -------------

  private handleDealCards(client: Client, player: PlayerState) {
    if (!player.isHost) {
      client.send('error', { code: RealtimeErrorCode.INVALID_ACTION, message: 'Only the host can deal' });
      return;
    }
    if (this.state.status !== 'waiting' && this.state.status !== 'round_end' && this.state.status !== 'match_end') {
      client.send('error', { code: RealtimeErrorCode.INVALID_ACTION, message: 'Cards already dealt for this round' });
      return;
    }
    if (this.state.players.size !== PLAYERS_PER_MATCH) {
      client.send('error', {
        code: RealtimeErrorCode.INVALID_ACTION,
        message: `Need exactly ${PLAYERS_PER_MATCH} players`,
      });
      return;
    }

    // A fresh match (vs. continuing to the next round of one already in progress)
    // resets everyone's cumulative score/elimination state.
    const isNewMatch = this.state.status === 'waiting' || this.state.status === 'match_end';
    if (isNewMatch) {
      for (const p of this.state.players.values()) {
        p.matchScore = 0;
        p.eliminated = false;
        p.placement = 0;
      }
      this.eliminatedCount = 0;
      this.matchStartedAt = Date.now();
    }

    this.dealRound(isNewMatch ? undefined : this.state.leaderUserId);

    if (isNewMatch && this.supabaseRoomId) {
      supabase
        .from('rooms')
        .update({ status: 'in_progress' })
        .eq('id', this.supabaseRoomId)
        .then(() => {});
    }
  }

  private handleStartGame(client: Client, player: PlayerState) {
    if (!player.isHost) {
      client.send('error', { code: RealtimeErrorCode.INVALID_ACTION, message: 'Only the host can start the round' });
      return;
    }
    if (this.state.status !== 'dealt') {
      client.send('error', { code: RealtimeErrorCode.INVALID_ACTION, message: 'Deal cards before starting' });
      return;
    }
    this.state.status = 'playing';
  }

  // Deals a fresh hand to every active player and moves the room to 'dealt' —
  // NOT 'playing' yet. Players can see their cards, but play_cards/pass stay
  // rejected until the host's separate start_game flips the room to 'playing'.
  // Any pacing between the two (a "look at your hand" countdown, etc.) is a
  // frontend concern — the server has no timer of its own here.
  private dealRound(leaderUserId?: string) {
    const activeEntries = this.getActiveSeatOrderEntries();
    const dealtHands = dealHands(activeEntries.length, CARDS_PER_PLAYER);

    activeEntries.forEach(({ sessionId, player }, i) => {
      this.hands.set(sessionId, dealtHands[i]);
      player.cardCount = dealtHands[i].length;
      player.hasPassed = false;
    });

    for (const { sessionId } of activeEntries) {
      const hand = this.hands.get(sessionId);
      const seatClient = this.clients.get(sessionId);
      if (hand && seatClient) seatClient.send('hand', { hand });
    }

    const startingLeader = leaderUserId ?? this.findStartingCardHolder(activeEntries);
    this.state.leaderUserId = startingLeader;
    this.state.currentTurnUserId = startingLeader;
    this.state.lastComboCards.clear();
    this.state.lastComboSize = '';
    this.state.lastComboFiveKind = '';
    this.state.lastComboPlayedBy = '';
    this.state.roundNumber += 1;
    this.state.status = 'dealt';
  }

  private findStartingCardHolder(seatEntries: SeatEntry[]): string {
    for (const { sessionId, player } of seatEntries) {
      if (this.hands.get(sessionId)?.includes(STARTING_CARD)) return player.userId;
    }
    return seatEntries[0]?.player.userId ?? ''; // shouldn't happen with a full 52-card deal
  }

  private getSeatOrderEntries(): SeatEntry[] {
    return [...this.state.players.entries()]
      .map(([sessionId, player]) => ({ sessionId, player }))
      .sort((a, b) => a.player.seatIndex - b.player.seatIndex);
  }

  private getActiveSeatOrderEntries(): SeatEntry[] {
    return this.getSeatOrderEntries().filter((e) => !e.player.eliminated);
  }

  // --- playing a combo -------------------------------------------------------

  private handlePlayCards(client: Client, player: PlayerState, cards: Card[] | undefined) {
    if (!cards || cards.length === 0) {
      client.send('error', { code: RealtimeErrorCode.INVALID_ACTION, message: 'No cards specified' });
      return;
    }

    const hand = this.hands.get(client.sessionId) ?? [];
    if (!cards.every((c) => hand.includes(c))) {
      client.send('error', { code: RealtimeErrorCode.INVALID_ACTION, message: 'You do not hold those cards' });
      return;
    }

    const combo = classifyCombo(cards);
    if (!combo) {
      client.send('error', { code: RealtimeErrorCode.INVALID_ACTION, message: 'Not a legal combination' });
      return;
    }

    const leadingFreely = this.state.lastComboCards.length === 0;
    if (!leadingFreely) {
      if (combo.size !== this.state.lastComboSize) {
        client.send('error', { code: RealtimeErrorCode.INVALID_ACTION, message: "Must match the previous play's size" });
        return;
      }
      const currentCombo = {
        cards: [...this.state.lastComboCards],
        size: this.state.lastComboSize as ComboSize,
        fiveKind: (this.state.lastComboFiveKind || undefined) as FiveCardComboKind | undefined,
      };
      if (compareCombos(combo, currentCombo) <= 0) {
        client.send('error', { code: RealtimeErrorCode.INVALID_ACTION, message: 'Must beat the previous play' });
        return;
      }
    }

    const remaining = hand.filter((c) => !cards.includes(c));
    this.hands.set(client.sessionId, remaining);
    player.cardCount = remaining.length;
    client.send('hand', { hand: remaining }); // keep the client's private hand in sync after every play

    this.state.lastComboCards.clear();
    cards.forEach((c) => this.state.lastComboCards.push(c));
    this.state.lastComboSize = combo.size;
    this.state.lastComboFiveKind = combo.fiveKind ?? '';
    this.state.lastComboPlayedBy = player.userId;

    for (const { player: p } of this.getActiveSeatOrderEntries()) p.hasPassed = false;

    if (remaining.length === 0) {
      this.endRound(player.userId);
      return;
    }

    this.state.currentTurnUserId = this.nextSeat(player.userId, { skipPassed: false });
  }

  private handlePass(client: Client, player: PlayerState) {
    if (this.state.lastComboCards.length === 0) {
      client.send('error', { code: RealtimeErrorCode.INVALID_ACTION, message: 'You are leading — you must play' });
      return;
    }

    player.hasPassed = true;

    const others = this.getActiveSeatOrderEntries()
      .map((e) => e.player)
      .filter((p) => p.userId !== this.state.lastComboPlayedBy);
    const allOthersPassed = others.every((p) => p.hasPassed);

    if (allOthersPassed) {
      const winner = this.state.lastComboPlayedBy;
      for (const { player: p } of this.getActiveSeatOrderEntries()) p.hasPassed = false;
      this.state.lastComboCards.clear();
      this.state.lastComboSize = '';
      this.state.lastComboFiveKind = '';
      this.state.lastComboPlayedBy = '';
      this.state.leaderUserId = winner;
      this.state.currentTurnUserId = winner;
      return;
    }

    this.state.currentTurnUserId = this.nextSeat(player.userId, { skipPassed: true });
  }

  private nextSeat(afterUserId: string, opts: { skipPassed: boolean }): string {
    const order = this.getActiveSeatOrderEntries().map((e) => e.player);
    const idx = order.findIndex((p) => p.userId === afterUserId);
    for (let step = 1; step <= order.length; step++) {
      const candidate = order[(idx + step) % order.length];
      if (opts.skipPassed && candidate.hasPassed) continue;
      return candidate.userId;
    }
    return afterUserId; // shouldn't happen — every seat passed including the asker
  }

  // --- round end / elimination / match end / scoring -------------------------

  private endRound(winnerUserId: string) {
    const activeEntries = this.getActiveSeatOrderEntries();
    const penalties: ThirteenTreePokerRoundResult['penalties'] = [];
    const crossedThreshold: SeatEntry[] = [];

    for (const entry of activeEntries) {
      const p = entry.player;
      if (p.userId === winnerUserId) continue;
      const cardsLeft = p.cardCount;
      const multiplier = cardsLeft === 13 ? 3 : cardsLeft >= 10 ? 2 : 1;
      const pointsAdded = cardsLeft * multiplier;
      p.matchScore += pointsAdded;
      penalties.push({ userId: p.userId, cardsLeft, pointsAdded, matchScore: p.matchScore });
      if (p.matchScore >= this.state.targetScore) crossedThreshold.push(entry);
    }

    // Tie-break within the same round: the higher score gets the worse placement.
    crossedThreshold.sort((a, b) => b.player.matchScore - a.player.matchScore);

    const eliminatedThisRound: ThirteenTreePokerRoundResult['eliminated'] = [];
    for (const entry of crossedThreshold) {
      const placement = PLAYERS_PER_MATCH - this.eliminatedCount;
      entry.player.eliminated = true;
      entry.player.placement = placement;
      this.eliminatedCount += 1;
      this.hands.delete(entry.sessionId);
      this.clients.get(entry.sessionId)?.send('hand', { hand: [] });
      eliminatedThisRound.push({ userId: entry.player.userId, placement });
    }

    this.broadcast('round_result', {
      roundNumber: this.state.roundNumber,
      winnerUserId,
      penalties,
      eliminated: eliminatedThisRound,
    } as ThirteenTreePokerRoundResult);

    this.state.status = 'round_end';
    this.state.currentTurnUserId = ''; // no one's turn while waiting on the host's next deal_cards

    const stillActive = this.getActiveSeatOrderEntries();
    if (stillActive.length === 1) {
      stillActive[0].player.placement = PLAYERS_PER_MATCH - this.eliminatedCount; // resolves to 1
      this.endMatch(stillActive[0].player.userId);
    } else {
      // Round winner leads the next round — remembered here for the host's next
      // deal_cards to pick up. The room stays in 'round_end' until then (rounds
      // no longer auto-deal; see the class-level two-step deal/start comment).
      this.state.leaderUserId = winnerUserId;
    }
  }

  private endMatch(winnerUserId: string) {
    this.state.status = 'match_end';

    const finalScores = this.getSeatOrderEntries()
      .map(({ player }) => ({ userId: player.userId, matchScore: player.matchScore, placement: player.placement }))
      .sort((a, b) => a.placement - b.placement);

    this.broadcast('match_result', { winnerUserId, finalScores } as ThirteenTreePokerMatchResult);

    if (this.supabaseRoomId) {
      this.persistMatchHistory(finalScores).catch(() => {
        // Best-effort — a history-write failure shouldn't crash the live room.
      });
    }
  }

  private async persistMatchHistory(
    finalScores: { userId: string; matchScore: number; placement: number }[],
  ) {
    const durationSeconds = Math.max(0, Math.round((Date.now() - this.matchStartedAt) / 1000));

    const { data: history, error } = await supabase
      .from('game_history')
      .insert({ room_id: this.supabaseRoomId, game_type: 'thirteen_tree_poker', duration_seconds: durationSeconds })
      .select()
      .single();
    if (error || !history) return;

    const seatEntries = this.getSeatOrderEntries();
    const rows = finalScores.map((entry) => ({
      history_id: history.id,
      user_id: entry.userId,
      display_name: seatEntries.find((e) => e.player.userId === entry.userId)?.player.displayName ?? 'Player',
      score_delta: entry.matchScore,
      placement: entry.placement,
    }));
    await supabase.from('game_history_players').insert(rows);
    await supabase.from('rooms').update({ status: 'finished' }).eq('id', this.supabaseRoomId);

    // TODO: convert this match's placement into profiles.total_score / level updates —
    // exact conversion formula hasn't been decided yet, discuss separately.
  }
}
