import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';

import profileRouter from './routes/profile';
import friendsRouter from './routes/friends';
import roomsRouter from './routes/rooms';
import { ThirteenTreePokerRoom } from './rooms/ThirteenTreePokerRoom';
import { swaggerSpec } from './swagger';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/profile', profileRouter);
app.use('/friends', friendsRouter);
app.use('/rooms', roomsRouter);

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// filterBy(['code']): routes joinOrCreate('thirteen_tree_poker', { code, ... }) calls that
// share the same `code` into the SAME live room instance, instead of Colyseus matching
// clients into whichever room of this type happens to be open. Without this, two unrelated
// lobbies created via POST /rooms could get merged into one live Colyseus room.
gameServer.define('thirteen_tree_poker', ThirteenTreePokerRoom).filterBy(['code']);

const port = Number(process.env.PORT) || 2567;
httpServer.listen(port, () => {
  console.log(`party-backend listening on :${port}`);
});
