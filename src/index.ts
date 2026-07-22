import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';

import profileRouter from './routes/profile';
import friendsRouter from './routes/friends';
import roomsRouter from './routes/rooms';
import { ThirteenTreePokerRoom } from './rooms/ThirteenTreePokerRoom';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/profile', profileRouter);
app.use('/friends', friendsRouter);
app.use('/rooms', roomsRouter);

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define('thirteen_tree_poker', ThirteenTreePokerRoom);

const port = Number(process.env.PORT) || 2567;
httpServer.listen(port, () => {
  console.log(`party-backend listening on :${port}`);
});
