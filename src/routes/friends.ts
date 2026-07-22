import { Router } from 'express';
import { ApiEnvelope, FriendSummary, RespondFriendRequestBody, SendFriendRequestBody } from 'party-shared-types';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { supabase } from '../db/supabase';

const router = Router();

router.get('/', requireAuth, async (req: AuthedRequest, res) => {
  // TODO: join friends + profiles into FriendSummary[]; isOnline needs a presence
  // source (e.g. Redis) once we have more than one server instance.
  const body: ApiEnvelope<FriendSummary[]> = { data: [] };
  res.json(body);
});

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
