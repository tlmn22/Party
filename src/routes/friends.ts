import { Router } from 'express';
import { ApiEnvelope, FriendSummary, RespondFriendRequestBody, SendFriendRequestBody } from 'party-shared-types';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { supabase } from '../db/supabase';

const router = Router();

/**
 * @swagger
 * /friends:
 *   get:
 *     summary: List the signed-in user's friends (accepted + pending)
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Friend list
 */
router.get('/', requireAuth, async (req: AuthedRequest, res) => {
  // TODO: join friends + profiles into FriendSummary[]; isOnline needs a presence
  // source (e.g. Redis) once we have more than one server instance.
  const body: ApiEnvelope<FriendSummary[]> = { data: [] };
  res.json(body);
});

/**
 * @swagger
 * /friends/request:
 *   post:
 *     summary: Send a friend request
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [targetUserId]
 *             properties:
 *               targetUserId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Request sent
 *       400:
 *         description: Request failed
 */
router.post('/request', requireAuth, async (req: AuthedRequest, res) => {
  const { targetUserId } = req.body as SendFriendRequestBody;

  const { error } = await supabase.from('friends').insert({
    user_id: req.userId,
    friend_id: targetUserId,
    status: 'pending',
    requested_by: req.userId,
  });

  if (error) {
    return res.status(400).json({ error: { code: 'REQUEST_FAILED', message: error.message } });
  }
  res.json({ data: { ok: true } });
});

/**
 * @swagger
 * /friends/respond:
 *   post:
 *     summary: Accept or decline an incoming friend request
 *     tags: [Friends]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [requesterUserId, accept]
 *             properties:
 *               requesterUserId: { type: string, format: uuid }
 *               accept: { type: boolean }
 *     responses:
 *       200:
 *         description: Handled
 *       400:
 *         description: Respond failed
 */
router.post('/respond', requireAuth, async (req: AuthedRequest, res) => {
  const { requesterUserId, accept } = req.body as RespondFriendRequestBody;

  if (!accept) {
    await supabase.from('friends').delete().eq('user_id', requesterUserId).eq('friend_id', req.userId);
    return res.json({ data: { ok: true } });
  }

  const { error } = await supabase
    .from('friends')
    .update({ status: 'accepted' })
    .eq('user_id', requesterUserId)
    .eq('friend_id', req.userId);

  if (error) {
    return res.status(400).json({ error: { code: 'RESPOND_FAILED', message: error.message } });
  }
  res.json({ data: { ok: true } });
});

export default router;
