import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
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
  verifyHostSession,
  setHostDevice,
  disconnectHost,
  getHostStatus,
} from './spotify.js';
import { Room } from './state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10) || 3000;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const HOST_ADMIN_SECRET = (process.env.HOST_ADMIN_SECRET || '').trim();
const DISCONNECT_GRACE_MS = Math.max(0, parseInt(process.env.DISCONNECT_GRACE_MS || '8000', 10) || 8000);
const ZOMBIE_TTL_MS = 30_000;
const HOST_COOKIE = 'd3m_host';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(express.static(DIST_DIR));

// ---- Helpers: cookies, host auth, per-IP rate limiting ----

function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function isLoopback(req) {
  const ip = req.socket?.remoteAddress || req.ip || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function hasValidHostCookie(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifyHostSession(cookies[HOST_COOKIE]);
}

function requireHostSession(req, res, next) {
  if (!hasValidHostCookie(req)) {
    return res.status(401).json({ error: 'Solo el host autenticado puede acceder a este recurso.' });
  }
  next();
}

function makeIpLimiter(maxHits, windowMs) {
  const hits = new Map(); // ip -> [timestamps]
  return (req, res, next) => {
    if (process.env.DISABLE_IP_RATE_LIMIT === '1') return next();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const log = (hits.get(ip) || []).filter((ts) => now - ts < windowMs);
    if (log.length >= maxHits) {
      return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta de nuevo en un momento.' });
    }
    log.push(now);
    hits.set(ip, log);
    if (hits.size > 2000) {
      for (const [k, v] of hits) {
        if (!v.length || now - v[v.length - 1] >= windowMs) hits.delete(k);
      }
    }
    next();
  };
}

const joinLimiter = makeIpLimiter(25, 10 * 60_000);
const searchLimiter = makeIpLimiter(45, 60_000);

// ---- WebSocket & room wiring ----

const sockets = new Map(); // ws -> clientToken | null
const leaveTimers = new Map(); // clientToken -> Timeout

function safeSend(ws, data) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(data);
  } catch {
    try { ws.terminate(); } catch { /* ignore */ }
  }
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of sockets.keys()) safeSend(ws, data);
}

function sendToClient(clientId, msg) {
  const data = JSON.stringify(msg);
  for (const [ws, id] of sockets.entries()) {
    if (id === clientId) safeSend(ws, data);
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

app.post('/api/join', joinLimiter, (req, res) => {
  const client = room.join(req.body?.name);
  if (client.error) return res.status(429).json(client);
  res.json({
    clientId: client.id,
    publicId: client.publicId,
    name: client.name,
    anonymous: client.anonymous,
  });
});

app.post('/api/leave', (req, res) => {
  const { clientId } = req.body || {};
  if (typeof clientId === 'string' && room.clients.has(clientId)) {
    cancelLeave(clientId);
    for (const [ws, id] of sockets.entries()) {
      if (id === clientId) {
        sockets.set(ws, null);
        safeSend(ws, JSON.stringify({ type: 'session-expired' }));
      }
    }
    room.leave(clientId);
  }
  res.json({ ok: true });
});

app.get('/api/search', searchLimiter, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
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
  const result = room.vote(clientId, vote, typeof trackId === 'string' ? trackId : null);
  if (result.error) return res.status(400).json(result);
  if (typeof clientId === 'string') sendToClient(clientId, room.clientVoteState(clientId));
  res.json(result);
});

app.get('/api/state', (_req, res) => res.json(room.snapshot()));

// ---- Spotify Host OAuth + Web Playback SDK endpoints (host-authenticated) ----

app.get('/api/spotify/status', (req, res) => {
  res.json({ ...getHostStatus(), isHost: hasValidHostCookie(req) });
});

app.get('/api/spotify/login', (req, res) => {
  const key = typeof req.query.key === 'string' ? req.query.key : '';
  const authorized = HOST_ADMIN_SECRET
    ? safeEqual(key, HOST_ADMIN_SECRET) || hasValidHostCookie(req)
    : isLoopback(req) || hasValidHostCookie(req);

  if (!authorized) {
    return res.status(403).send('Acceso restringido al host. Usa HOST_ADMIN_SECRET o abre /screen desde el host local.');
  }
  try {
    res.redirect(getAuthUrl());
  } catch (e) {
    res.status(400).send(e.message);
  }
});

app.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/screen?spotify_error=auth_denied');
  if (typeof code !== 'string' || typeof state !== 'string') {
    return res.redirect('/screen?spotify_error=invalid_callback');
  }
  try {
    const { sessionToken } = await exchangeCode(code, state);
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader(
      'Set-Cookie',
      `${HOST_COOKIE}=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Lax; Path=/${isSecure ? '; Secure' : ''}`
    );
    room.emitState();
    res.redirect('/screen');
  } catch (e) {
    res.redirect(`/screen?spotify_error=${encodeURIComponent(e.message || 'oauth_failed')}`);
  }
});

app.get('/api/spotify/token', requireHostSession, async (_req, res) => {
  const accessToken = await getHostAccessToken();
  if (!accessToken) return res.status(401).json({ error: 'Host de Spotify no conectado.' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ accessToken });
});

app.post('/api/spotify/device', requireHostSession, async (req, res) => {
  const { deviceId } = req.body || {};
  if (typeof deviceId !== 'string' || !deviceId.trim()) {
    return res.status(400).json({ error: 'deviceId requerido.' });
  }
  setHostDevice(deviceId);
  room.emitState();
  await room.syncCurrentPlayback();
  res.json({ ok: true, host: getHostStatus() });
});

app.post('/api/spotify/disconnect', requireHostSession, (_req, res) => {
  disconnectHost();
  res.setHeader('Set-Cookie', `${HOST_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  room.emitState();
  res.json({ ok: true });
});

app.get('/screen', (_req, res) =>
  res.sendFile(path.join(DIST_DIR, 'screen.html'))
);

// ---- HTTP + WebSocket server ----

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {
    sockets.delete(ws);
    try { ws.terminate(); } catch { /* ignore */ }
  });

  const url = new URL(req.url, 'http://localhost');
  const clientId = url.searchParams.get('client');
  sockets.set(ws, null);
  if (clientId) {
    if (room.clients.has(clientId)) {
      cancelLeave(clientId);
      sockets.set(ws, clientId);
      safeSend(ws, JSON.stringify(room.clientVoteState(clientId)));
    } else {
      safeSend(ws, JSON.stringify({ type: 'session-expired' }));
    }
  }
  safeSend(ws, JSON.stringify(room.snapshot()));

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

// Heartbeat to terminate dead sockets + sweep zombie HTTP-only joins + prune expired state
const maintenanceTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      sockets.delete(ws);
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }

  const now = Date.now();
  for (const [id, client] of room.clients) {
    if (now - client.joinedAt > ZOMBIE_TTL_MS && !hasOtherSocket(id) && !leaveTimers.has(id)) {
      room.leave(id);
    }
  }
  room.pruneExpired();
}, 15_000);
maintenanceTimer.unref();

server.listen(PORT, () => {
  console.log(`▶ dev3pack-hub-music on http://127.0.0.1:${PORT}`);
  console.log(`▶ display screen: http://127.0.0.1:${PORT}/screen`);
  console.log(
    `▶ spotify: ${spotifyEnabled ? 'CONFIGURED (connect host on /screen for full playback)' : 'WAITING FOR CREDENTIALS (demo catalog active — set SPOTIFY_CLIENT_ID & SPOTIFY_CLIENT_SECRET in .env)'}`
  );
});
