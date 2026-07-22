import { Room, Client } from '@colyseus/core';
import { Schema, MapSchema, type } from '@colyseus/schema';
import { ThirteenTreePokerAction, RealtimeErrorCode } from 'party-shared-types';
import { verifyJoinToken, JoinTokenPayload } from '../realtime/joinToken';

class PlayerState extends Schema {
  @type('string') userId = '';
  @type('string') displayName = '';
  @type('number') seatIndex = 0;
  @type('boolean') connected = true;
  @type('boolean') isHost = false;
  @type('number') cardCount = 0;
  @type('number') score = 0;
  @type('boolean') hasPassed = false;
}

class ThirteenTreePokerState extends Schema {
  @type('string') status = 'waiting';
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type('string') currentTurnUserId = '';
}

const RECONNECTION_GRACE_SECONDS = 60;

export class ThirteenTreePokerRoom extends Room<{ state: ThirteenTreePokerState }> {
  maxClients = 4; // TODO: confirm seat count once "13 модны покер" rules are finalized

  private processedActionIds = new Set<string>();

  onCreate() {
    this.state = new ThirteenTreePokerState();
    this.onMessage('action', (client, message: ThirteenTreePokerAction) => this.handleAction(client, message));
  }

  // Verifies the short-lived join token issued by POST /rooms or /rooms/join so a
  // client can't fake another user's identity when opening the WS connection directly.
  onAuth(_client: Client, options: { joinToken?: string }): JoinTokenPayload {
    if (!options?.joinToken) throw new Error('Missing join token');
    return verifyJoinToken(options.joinToken);
  }

  onJoin(client: Client, options: { displayName?: string }) {
    const { userId } = client.auth as JoinTokenPayload;

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
  }

  // Final departure — either a consented leave, or the reconnection window from
  // onDrop() ran out. Either way the seat is gone for good.
  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }

  private handleAction(client: Client, message: ThirteenTreePokerAction) {
    if (this.processedActionIds.has(message.actionId)) {
      client.send('error', { code: RealtimeErrorCode.DUPLICATE_ACTION, message: 'Action already processed' });
      return;
    }
    this.processedActionIds.add(message.actionId);

    const player = this.state.players.get(client.sessionId);
    if (!player || player.userId !== this.state.currentTurnUserId) {
      client.send('error', { code: RealtimeErrorCode.NOT_YOUR_TURN, message: 'Not your turn' });
      return;
    }

    // TODO: shuffle/deal/turn-order/scoring rules for "13 модны покер" — designed together during development.
    switch (message.type) {
      case 'play_cards':
        break;
      case 'pass':
        break;
    }
  }
}
