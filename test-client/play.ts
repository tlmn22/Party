// Manual interactive test client for "13 модны покер" — NOT part of the app,
// just a terminal harness so a real Colyseus connection can be played by hand
// while there's no frontend yet. Run one instance per player in separate terminals.
//
// Usage (host, creates the room):
//   npx ts-node test-client/play.ts --email test2@example.com --password Password123! --host --target-score 30
//
// Usage (joiners, use the code the host prints):
//   npx ts-node test-client/play.ts --email test3@example.com --password Password123! --code ABCDEF
//
// Usage (simulating a refresh/dropped connection — reconnect into the SAME seat):
//   npx ts-node test-client/play.ts --reconnect <token>
//   (the token is printed as "RECONNECT TOKEN: ..." right after every successful
//   connect — save it before killing/refreshing a client to test getting back in)
//
// Requires SUPABASE_URL + SUPABASE_ANON_KEY in the environment (anon key is the
// public one from Project Settings -> API, safe to pass around — NOT service_role).
//
// Commands once connected:
//   deal                  — host only, deals cards for a new match/round (room -> 'dealt')
//   start                 — host only, begins actual play for the dealt round (room -> 'playing')
//   play 7D 7H            — play a combo (space-separated cards)
//   pass
//   hand                  — reprint your current hand
//   state                 — reprint a summary of the room state
//   quit

import 'dotenv/config';
import * as readline from 'readline';
import { randomUUID } from 'crypto';
import { Client } from '@colyseus/sdk';
import { Card } from 'party-shared-types';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || arg('anon-key');
const BACKEND_URL = arg('backend-url') || 'http://localhost:2567';
const WS_URL = arg('ws-url') || 'ws://localhost:2567';

async function supabaseSignInOrSignUp(email: string, password: string): Promise<string> {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set (env or --anon-key)');
  }

  const signIn = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (signIn.ok) return (await signIn.json()).access_token;

  const signUp = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const signUpBody = await signUp.json();
  if (signUpBody.access_token) return signUpBody.access_token;

  const retry = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!retry.ok) throw new Error(`Supabase auth failed: ${JSON.stringify(await retry.json())}`);
  return (await retry.json()).access_token;
}

function renderState(state: any) {
  const players = [...state.players.values()].map(
    (p: any) =>
      `${p.displayName}${p.isHost ? '*' : ''}: cards=${p.cardCount} score=${p.matchScore}` +
      `${p.eliminated ? ` [eliminated, placement ${p.placement}]` : ''}` +
      `${p.userId === state.currentTurnUserId ? ' <- turn' : ''}`,
  );
  const lastCombo = state.lastComboCards.length ? [...state.lastComboCards].join(' ') : '(free lead)';
  console.log(
    `\n--- round ${state.roundNumber} | status=${state.status} | target=${state.targetScore} ---\n` +
      players.join('\n') +
      `\nlast combo: ${lastCombo} (${state.lastComboSize || '-'})\n`,
  );
}

async function main() {
  const reconnectToken = arg('reconnect');
  const client = new Client(WS_URL);
  let colyseusRoom: any;
  let displayName: string;

  if (reconnectToken) {
    // Simulates a refreshed/dropped client getting back into the SAME seat —
    // this is Colyseus's own mechanism, entirely separate from our joinToken/onAuth
    // REST flow. No Supabase login or /rooms call needed for this path at all.
    console.log('Reconnecting with saved token...');
    colyseusRoom = await client.reconnect(reconnectToken);
    displayName = '(reconnected)';
    console.log(`Reconnected. sessionId=${colyseusRoom.sessionId}`);
  } else {
    const email = arg('email');
    const password = arg('password');
    const isHost = flag('host');
    const code = arg('code');
    const targetScore = arg('target-score') ? Number(arg('target-score')) : undefined;

    if (!email || !password) throw new Error('--email and --password are required (or use --reconnect <token>)');
    if (!isHost && !code) throw new Error('Non-host must pass --code <room code>');

    console.log('Logging in to Supabase...');
    const accessToken = await supabaseSignInOrSignUp(email, password);
    displayName = email.split('@')[0];

    let room: any;
    if (isHost) {
      console.log('Creating room...');
      const res = await fetch(`${BACKEND_URL}/rooms`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameType: 'thirteen_tree_poker', targetScore }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(`Create room failed: ${JSON.stringify(body)}`);
      room = body.data;
      console.log(`\n>>> ROOM CODE: ${room.room.code} <<<  (give this to the other 3 players)\n`);
    } else {
      console.log(`Joining room ${code}...`);
      const res = await fetch(`${BACKEND_URL}/rooms/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(`Join room failed: ${JSON.stringify(body)}`);
      room = body.data;
    }

    console.log('Connecting to Colyseus...');
    colyseusRoom = await client.joinOrCreate('thirteen_tree_poker', {
      joinToken: room.joinToken,
      code: room.room.code,
      displayName,
    });
    console.log(`Connected as ${displayName}. sessionId=${colyseusRoom.sessionId}`);
  }

  console.log(`\n>>> RECONNECT TOKEN: ${colyseusRoom.reconnectionToken} <<<`);
  console.log('(save this — if this client drops/refreshes, restart with --reconnect <token> to get back into the same seat)\n');

  let myHand: Card[] = [];

  colyseusRoom.onMessage('hand', (msg: { hand: Card[] }) => {
    myHand = msg.hand;
    console.log('Your hand:', myHand.join(' ') || '(empty)');
  });
  colyseusRoom.onMessage('round_result', (msg: any) => console.log('\n[round_result]', JSON.stringify(msg)));
  colyseusRoom.onMessage('match_result', (msg: any) => console.log('\n[match_result]', JSON.stringify(msg)));
  colyseusRoom.onMessage('error', (msg: any) => console.log('\n[error]', JSON.stringify(msg)));
  colyseusRoom.onStateChange((state: any) => renderState(state));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\nCommands: deal | start | play <card> <card>... | pass | hand | state | quit\n');
  rl.setPrompt('> ');
  rl.prompt();

  rl.on('line', (line) => {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    if (cmd === 'deal') {
      colyseusRoom.send('action', { actionId: randomUUID(), type: 'deal_cards', payload: {} });
    } else if (cmd === 'start') {
      colyseusRoom.send('action', { actionId: randomUUID(), type: 'start_game', payload: {} });
    } else if (cmd === 'play') {
      colyseusRoom.send('action', { actionId: randomUUID(), type: 'play_cards', payload: { cards: rest } });
    } else if (cmd === 'pass') {
      colyseusRoom.send('action', { actionId: randomUUID(), type: 'pass', payload: {} });
    } else if (cmd === 'hand') {
      console.log('Your hand:', myHand.join(' ') || '(empty)');
    } else if (cmd === 'state') {
      renderState(colyseusRoom.state);
    } else if (cmd === 'quit') {
      colyseusRoom.leave();
      rl.close();
      process.exit(0);
    } else if (cmd) {
      console.log('Unknown command. Use: deal | start | play <card>... | pass | hand | state | quit');
    }
    rl.prompt();
  });
}

main().catch((e) => {
  console.error('Test client failed:', e);
  process.exit(1);
});
