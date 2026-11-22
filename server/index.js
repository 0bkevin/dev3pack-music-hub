import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  searchTracks,
  spotifyEnabled,
  providerMode,
  getAuthUrl,
  exchangeCode,
  getHostAccessToken,
  setHostDevice,
  disconnectHost,
  getHostStatus,
} from './spotify.js';
import { Room } from './state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const DIST_DIR = path.join(__dirname, '..', 'dist');

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(DIST_DIR));

const sockets = new Map(); // ws -> clientId | null
const leaveTimers = new Map(); // clientId -> Timeout
const DISCONNECT_GRACE_MS = Math.max(0, parseInt(process.env.DISCONNECT_GRACE_MS || '8000', 10));

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of sockets.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function sendToClient(clientId, msg) {
  const data = JSON.stringify(msg);
  for (const [ws, id] of sockets.entries()) {
    if (id === clientId && ws.readyState === ws.OPEN) ws.send(data);
  }
}

function hasOtherSocket(clientId, excludeWs = null) {
  for (const [ws, id] of sockets.entries()) {
    if (ws !== excludeWs && id === clientId && ws.readyState === ws.OPEN) return true;
  }
  return false;
}

function cancelLeave(clientId) {
  const t = leaveTimers.get(clientId);
  if (t) {
    clearTimeout(t);
    leaveTimers.delete(clientId);
  }
}

const room = new Room(broadcast);

// ---- Participant & room API ----

app.post('/api/join', (req, res) => {
  const client = room.join(req.body?.name);
  res.json({ clientId: client.id, name: client.name, anonymous: client.anonymous });
});

app.post('/api/leave', (req, res) => {
  const { clientId } = req.body || {};
  if (clientId) {
    cancelLeave(clientId);
    room.leave(clientId);
  }
  res.json({ ok: true });
});

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ tracks: [] });
  try {
    const tracks = await searchTracks(q);
    res.json({ tracks, mode: providerMode() });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/queue', (req, res) => {
  const { clientId, track } = req.body || {};
  const result = room.enqueue(clientId, track);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/vote', (req, res) => {
  const { clientId, vote, trackId } = req.body || {};
  const result = room.vote(clientId, vote, trackId);
  if (result.error) return res.status(400).json(result);
  if (clientId) sendToClient(clientId, room.clientVoteState(clientId));
  res.json(result);
});

app.get('/api/state', (_req, res) => res.json(room.snapshot()));

// ---- Spotify Host OAuth + Web Playback SDK endpoints ----

app.get('/api/spotify/status', (_req, res) => res.json(getHostStatus()));

app.get('/api/spotify/login', (_req, res) => {
  try {
    res.redirect(getAuthUrl());
  } catch (e) {
    res.status(400).send(e.message);
  }
});

app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`/screen?spotify_error=${encodeURIComponent(error)}`);
  try {
    await exchangeCode(code, state);
    room.emitState();
    res.redirect('/screen');
  } catch (e) {
    res.redirect(`/screen?spotify_error=${encodeURIComponent(e.message)}`);
  }
});

app.get('/api/spotify/token', async (_req, res) => {
  const accessToken = await getHostAccessToken();
  if (!accessToken) return res.status(401).json({ error: 'Host de Spotify no conectado.' });
  res.json({ accessToken });
});

app.post('/api/spotify/device', async (req, res) => {
  const { deviceId } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: 'deviceId requerido.' });
  setHostDevice(deviceId);
  room.emitState();
  await room.syncCurrentPlayback();
  res.json({ ok: true, host: getHostStatus() });
});

app.post('/api/spotify/disconnect', (_req, res) => {
  disconnectHost();
  room.emitState();
  res.json({ ok: true });
});

app.get('/screen', (_req, res) =>
  res.sendFile(path.join(DIST_DIR, 'screen.html'))
);

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const clientId = url.searchParams.get('client');
  sockets.set(ws, null);
  if (clientId) {
    if (room.clients.has(clientId)) {
      cancelLeave(clientId);
      sockets.set(ws, clientId);
      ws.send(JSON.stringify(room.clientVoteState(clientId)));
    } else {
      ws.send(JSON.stringify({ type: 'session-expired' }));
    }
  }
  ws.send(JSON.stringify(room.snapshot()));

  ws.on('close', () => {
    const id = sockets.get(ws);
    sockets.delete(ws);
    if (!id || hasOtherSocket(id, ws)) return;
    if (DISCONNECT_GRACE_MS === 0) {
      room.leave(id);
      return;
    }
    cancelLeave(id);
    leaveTimers.set(
      id,
      setTimeout(() => {
        leaveTimers.delete(id);
        if (!hasOtherSocket(id)) room.leave(id);
      }, DISCONNECT_GRACE_MS)
    );
  });
});

server.listen(PORT, () => {
  console.log(`▶ dev3pack-hub-music on http://127.0.0.1:${PORT}`);
  console.log(`▶ display screen: http://127.0.0.1:${PORT}/screen`);
  console.log(
    `▶ spotify: ${spotifyEnabled ? 'CONFIGURED (connect host on /screen for full playback)' : 'WAITING FOR CREDENTIALS (demo catalog active — set SPOTIFY_CLIENT_ID & SPOTIFY_CLIENT_SECRET in .env)'}`
  );
});
