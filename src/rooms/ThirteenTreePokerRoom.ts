import { Room, Client } from '@colyseus/core';
import { Schema, MapSchema, ArraySchema, type } from '@colyseus/schema';
import {
  Card,
  ComboSize,
  FiveCardComboKind,
  RealtimeErrorCode,
  ThirteenTreePokerAction,
  ThirteenTreePokerHandResult,
  ThirteenTreePokerMatchResult,
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
}

class ThirteenTreePokerState extends Schema {
  @type('string') status = 'waiting'; // waiting | playing | hand_end | match_end
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type('string') currentTurnUserId = '';
  @type('string') leaderUserId = ''; // must play freely (no combo to beat) on their turn
  @type(['string']) lastComboCards = new ArraySchema<string>(); // empty = current turn leads freely
  @type('string') lastComboSize = ''; // '' | single | pair | triple | five
  @type('string') lastComboFiveKind = ''; // only set when lastComboSize === 'five'
  @type('string') lastComboPlayedBy = '';
  @type('number') targetScore = 30;
  @type('number') handNumber = 0;
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

  onCreate(options: { targetScore?: number }) {
    this.state = new ThirteenTreePokerState();
    this.state.targetScore = options?.targetScore ?? 30;
    this.onMessage('action', (client, message: ThirteenTreePokerAction) => this.handleAction(client, message));
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

    if (message.type === 'start_game') {
      this.handleStartGame(client, player);
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

  // --- start / deal ---------------------------------------------------------

  private handleStartGame(client: Client, player: PlayerState) {
    if (!player.isHost) {
      client.send('error', { code: RealtimeErrorCode.INVALID_ACTION, message: 'Only the host can start the game' });
      return;
    }
    if (this.state.status !== 'waiting' && this.state.status !== 'match_end') {
      client.send('error', { code: RealtimeErrorCode.INVALID_ACTION, message: 'Match already in progress' });
      return;
    }
    if (this.state.players.size !== PLAYERS_PER_MATCH) {
      client.send('error', {
        code: RealtimeErrorCode.INVALID_ACTION,
        message: `Need exactly ${PLAYERS_PER_MATCH} players`,
      });
      return;
    }

    for (const p of this.state.players.values()) {
      p.matchScore = 0;
      p.eliminated = false;
    }

    this.matchStartedAt = Date.now();
    this.startNewHand();

    if (this.supabaseRoomId) {
      supabase
        .from('rooms')
        .update({ status: 'in_progress' })
        .eq('id', this.supabaseRoomId)
        .then(() => {});
    }
  }

  private startNewHand(leaderUserId?: string) {
    const seatEntries = this.getSeatOrderEntries();
    const dealtHands = dealHands(seatEntries.length, CARDS_PER_PLAYER);

    seatEntries.forEach(({ sessionId, player }, i) => {
      this.hands.set(sessionId, dealtHands[i]);
      player.cardCount = dealtHands[i].length;
      player.hasPassed = false;
    });

    for (const { sessionId } of seatEntries) {
      const hand = this.hands.get(sessionId);
      const seatClient = this.clients.get(sessionId);
      if (hand && seatClient) seatClient.send('hand', { hand });
    }

    const startingLeader = leaderUserId ?? this.findStartingCardHolder(seatEntries);
    this.state.leaderUserId = startingLeader;
    this.state.currentTurnUserId = startingLeader;
    this.state.lastComboCards.clear();
    this.state.lastComboSize = '';
    this.state.lastComboFiveKind = '';
    this.state.lastComboPlayedBy = '';
    this.state.handNumber += 1;
    this.state.status = 'playing';
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

    for (const p of this.state.players.values()) p.hasPassed = false;

    if (remaining.length === 0) {
      this.endHand(player.userId);
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

    const others = this.getSeatOrderEntries()
      .map((e) => e.player)
      .filter((p) => p.userId !== this.state.lastComboPlayedBy);
    const allOthersPassed = others.every((p) => p.hasPassed);

    if (allOthersPassed) {
      const winner = this.state.lastComboPlayedBy;
      for (const p of this.state.players.values()) p.hasPassed = false;
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
    const order = this.getSeatOrderEntries().map((e) => e.player);
    const idx = order.findIndex((p) => p.userId === afterUserId);
    for (let step = 1; step <= order.length; step++) {
      const candidate = order[(idx + step) % order.length];
      if (opts.skipPassed && candidate.hasPassed) continue;
      return candidate.userId;
    }
    return afterUserId; // shouldn't happen — every seat passed including the asker
  }

  // --- hand end / match end / scoring ----------------------------------------

  private endHand(winnerUserId: string) {
    const penalties: ThirteenTreePokerHandResult['penalties'] = [];

    for (const p of this.state.players.values()) {
      if (p.userId === winnerUserId) continue;
      const cardsLeft = p.cardCount;
      const multiplier = cardsLeft === 13 ? 3 : cardsLeft >= 10 ? 2 : 1;
      const pointsAdded = cardsLeft * multiplier;
      p.matchScore += pointsAdded;
      penalties.push({ userId: p.userId, cardsLeft, pointsAdded });
    }

    this.broadcast(
      'hand_result',
      { handNumber: this.state.handNumber, winnerUserId, penalties } as ThirteenTreePokerHandResult,
    );

    this.state.status = 'hand_end';

    const loser = [...this.state.players.values()].find((p) => p.matchScore >= this.state.targetScore);
    if (loser) {
      this.endMatch(loser.userId);
    } else {
      this.startNewHand(winnerUserId);
    }
  }

  private endMatch(loserUserId: string) {
    this.state.status = 'match_end';

    const seatEntries = this.getSeatOrderEntries();
    const finalScores = seatEntries
      .map(({ player }) => ({ userId: player.userId, matchScore: player.matchScore }))
      .sort((a, b) => a.matchScore - b.matchScore); // lowest score = best placement

    const loserEntry = seatEntries.find((e) => e.player.userId === loserUserId);
    if (loserEntry) loserEntry.player.eliminated = true;

    this.broadcast('match_result', { loserUserId, finalScores } as ThirteenTreePokerMatchResult);

    if (this.supabaseRoomId) {
      this.persistMatchHistory(seatEntries, finalScores).catch(() => {
        // Best-effort — a history-write failure shouldn't crash the live room.
      });
    }
  }

  private async persistMatchHistory(
    seatEntries: SeatEntry[],
    finalScores: { userId: string; matchScore: number }[],
  ) {
    const durationSeconds = Math.max(0, Math.round((Date.now() - this.matchStartedAt) / 1000));

    const { data: history, error } = await supabase
      .from('game_history')
      .insert({ room_id: this.supabaseRoomId, game_type: 'thirteen_tree_poker', duration_seconds: durationSeconds })
      .select()
      .single();
    if (error || !history) return;

    const rows = finalScores.map((entry, index) => ({
      history_id: history.id,
      user_id: entry.userId,
      display_name: seatEntries.find((e) => e.player.userId === entry.userId)?.player.displayName ?? 'Player',
      score_delta: entry.matchScore,
      placement: index + 1,
    }));
    await supabase.from('game_history_players').insert(rows);
    await supabase.from('rooms').update({ status: 'finished' }).eq('id', this.supabaseRoomId);

    // TODO: convert this match's placement into profiles.total_score / level updates —
    // exact conversion formula hasn't been decided yet, discuss separately.
  }
}
