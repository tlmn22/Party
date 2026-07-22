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

/**
 * @swagger
 * /rooms:
 *   post:
 *     summary: Create a new game room
 *     tags: [Rooms]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [gameType]
 *             properties:
 *               gameType: { type: string, example: thirteen_tree_poker }
 *               maxPlayers: { type: integer, example: 4 }
 *     responses:
 *       200:
 *         description: Room created — use the returned joinToken to open the Colyseus WS connection
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     room:
 *                       type: object
 *                       properties:
 *                         roomId: { type: string, format: uuid }
 *                         code: { type: string, example: A7K9QX }
 *                         gameType: { type: string }
 *                         hostUserId: { type: string, format: uuid }
 *                         playerCount: { type: integer }
 *                         maxPlayers: { type: integer }
 *                         status: { type: string, enum: [waiting, in_progress, finished] }
 *                         createdAt: { type: string, format: date-time }
 *                     joinToken:
 *                       type: string
 *                       description: Short-lived (30s) token for the Colyseus onAuth handshake
 *       400:
 *         description: Room creation failed
 *       401:
 *         description: Missing or invalid bearer token
 */
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

/**
 * @swagger
 * /rooms/join:
 *   post:
 *     summary: Join an existing room by its code (typed in, or decoded from a QR)
 *     tags: [Rooms]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string, example: A7K9QX }
 *     responses:
 *       200:
 *         description: Joined — use the returned joinToken to open the Colyseus WS connection
 *       401:
 *         description: Missing or invalid bearer token
 *       404:
 *         description: Invalid room code
 */
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
