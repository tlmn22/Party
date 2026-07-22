import { Router } from 'express';
import {
  ApiEnvelope,
  CreateRoomRequest,
  CreateRoomResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  RoomSummary,
} from 'party-shared-types';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { supabase } from '../db/supabase';
import { issueJoinToken } from '../realtime/joinToken';

const router = Router();

// 6 chars, upper-case, no ambiguous glyphs (0/O, 1/I) — easy to read aloud or retype from a screen.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

router.post('/', requireAuth, async (req: AuthedRequest, res) => {
  const { gameType, maxPlayers } = req.body as CreateRoomRequest;
  const code = generateRoomCode();

  const { data, error } = await supabase
    .from('rooms')
    .insert({ code, game_type: gameType, host_user_id: req.userId, max_players: maxPlayers ?? 4 })
    .select()
    .single();

  if (error || !data) {
    const body: ApiEnvelope<never> = { error: { code: 'ROOM_CREATE_FAILED', message: error?.message ?? 'unknown' } };
    return res.status(400).json(body);
  }

  const room: RoomSummary = {
    roomId: data.id,
    code: data.code,
    gameType: data.game_type,
    hostUserId: data.host_user_id,
    playerCount: 0,
    maxPlayers: data.max_players,
    status: data.status,
    createdAt: data.created_at,
  };

  const response: CreateRoomResponse = { room, joinToken: issueJoinToken(req.userId!, room.roomId) };
  res.json({ data: response } as ApiEnvelope<CreateRoomResponse>);
});

router.post('/join', requireAuth, async (req: AuthedRequest, res) => {
  const { code } = req.body as JoinRoomRequest;

  const { data, error } = await supabase.from('rooms').select().eq('code', code).single();
  if (error || !data) {
    const body: ApiEnvelope<never> = { error: { code: 'ROOM_NOT_FOUND', message: 'Invalid room code' } };
    return res.status(404).json(body);
  }

  const room: RoomSummary = {
    roomId: data.id,
    code: data.code,
    gameType: data.game_type,
    hostUserId: data.host_user_id,
    playerCount: 0, // TODO: fill from the live Colyseus room once we look it up server-side
    maxPlayers: data.max_players,
    status: data.status,
    createdAt: data.created_at,
  };

  const response: JoinRoomResponse = { room, joinToken: issueJoinToken(req.userId!, room.roomId) };
  res.json({ data: response } as ApiEnvelope<JoinRoomResponse>);
});

export default router;
