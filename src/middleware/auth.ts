import { Request, Response, NextFunction } from 'express';
import { supabase } from '../db/supabase';

export interface AuthedRequest extends Request {
  userId?: string;
}

// Frontend authenticates directly against Supabase Auth and sends the resulting
// access token as a Bearer header; we just verify it, we never issue it ourselves.
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Missing bearer token' } });
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired token' } });
  }

  req.userId = data.user.id;
  next();
}
