import { Router } from 'express';
import { ApiEnvelope, UpdateProfileRequest, UserProfile } from 'party-shared-types';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { supabase } from '../db/supabase';

const router = Router();

/**
 * @swagger
 * /profile/me:
 *   get:
 *     summary: Get the signed-in user's profile
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     displayName: { type: string }
 *                     avatarUrl: { type: string, nullable: true }
 *                     level: { type: integer }
 *                     totalScore: { type: integer }
 *                     createdAt: { type: string, format: date-time }
 *       401:
 *         description: Missing or invalid bearer token
 *       404:
 *         description: Profile not found
 */
router.get('/me', requireAuth, async (req: AuthedRequest, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, level, total_score, created_at')
    .eq('id', req.userId)
    .single();

  if (error || !data) {
    const body: ApiEnvelope<UserProfile> = { error: { code: 'PROFILE_NOT_FOUND', message: 'Profile not found' } };
    return res.status(404).json(body);
  }

  const profile: UserProfile = {
    id: data.id,
    displayName: data.display_name,
    avatarUrl: data.avatar_url,
    level: data.level,
    totalScore: data.total_score,
    createdAt: data.created_at,
  };
  const body: ApiEnvelope<UserProfile> = { data: profile };
  res.json(body);
});

/**
 * @swagger
 * /profile/me:
 *   patch:
 *     summary: Update the signed-in user's profile
 *     tags: [Profile]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName: { type: string }
 *               avatarUrl: { type: string, nullable: true }
 *     responses:
 *       200:
 *         description: Updated
 *       400:
 *         description: Update failed
 *       401:
 *         description: Missing or invalid bearer token
 */
router.patch('/me', requireAuth, async (req: AuthedRequest, res) => {
  const update = req.body as UpdateProfileRequest;

  const { error } = await supabase
    .from('profiles')
    .update({ display_name: update.displayName, avatar_url: update.avatarUrl })
    .eq('id', req.userId);

  if (error) {
    return res.status(400).json({ error: { code: 'UPDATE_FAILED', message: error.message } });
  }

  res.json({ data: { ok: true } });
});

export default router;
