import jwt from 'jsonwebtoken';

const JOIN_TOKEN_SECRET = process.env.JOIN_TOKEN_SECRET || 'dev-only-secret-change-me';
const JOIN_TOKEN_TTL_SECONDS = 30;

export interface JoinTokenPayload {
  userId: string;
  roomId: string;
}

// Short-lived token issued by POST /rooms and /rooms/join, then handed to the
// Colyseus room's onAuth. Binds userId + roomId together so a client can't
// spoof another player's identity when opening the WebSocket connection.
export function issueJoinToken(userId: string, roomId: string): string {
  return jwt.sign({ userId, roomId }, JOIN_TOKEN_SECRET, { expiresIn: JOIN_TOKEN_TTL_SECONDS });
}

export function verifyJoinToken(token: string): JoinTokenPayload {
  return jwt.verify(token, JOIN_TOKEN_SECRET) as JoinTokenPayload;
}
