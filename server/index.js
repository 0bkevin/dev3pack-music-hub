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
  getPublicHostStatus,
} from './spotify.js';
import { Room } from './state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10) || 3000;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const HOST_ADMIN_SECRET = (process.env.HOST_ADMIN_SECRET || '').trim();
const DISCONNECT_GRACE_MS = Math.max(0, parseInt(process.env.DISCONNECT_GRACE_MS || '8000', 10) || 8000);
const ZOMBIE_TTL_MS = 30_000;
const MAX_WS_PER_IP = 12;
const HOST_COOKIE = 'd3m_host';
const PREAUTH_COOKIE = 'd3m_host_init';
const PREAUTH_TTL_MS = 5 * 60_000;

// Ephemeral per-boot salt for IP pseudonymization in structured audit logs (ISO 27701)
const LOG_SALT = crypto.randomBytes(16).toString('hex');

function hashIp(ip) {
  return crypto.createHash('sha256').update(`${LOG_SALT}:${ip || 'unknown'}`).digest('hex').slice(0, 12);
}

// Structured JSON security audit logger — never logs secrets, tokens, raw IPs, or user PII
function auditLog(event, meta = {}) {
  const entry = { ts: new Date().toISOString(), event, ...meta };
  console.log(JSON.stringify(entry));
}

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}
app.use(express.json({ limit: '32kb' }));

// Security headers (SOC 2 CC6.6 / ISO 27001 A.8.20)
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://sdk.scdn.co",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' https://*.scdn.co https://*.spotifycdn.com data:",
  "connect-src 'self' ws: wss: https://*.spotify.com https://sdk.scdn.co",
  "media-src 'self' https://*.scdn.co",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Prevent intermediary caching of dynamic API responses (ISO 27701 / SOC 2 C1.1)
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(express.static(DIST_DIR));

// ---- Helpers: safe cookies, host auth, per-IP rate limiting ----

const pendingPreAuth = new Map(); // token -> expiresAt

function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const rawV = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(rawV);
    } catch {
      out[k] = rawV;
    }
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
  const ip = req.socket?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function isHttpsReq(req) {
  return Boolean(req.secure || (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https'));
}

function hasValidHostCookie(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifyHostSession(cookies[HOST_COOKIE]);
}

function consumePreAuthCookie(req) {
  const cookies = parseCookies(req.headers.cookie);
  const tok = cookies[PREAUTH_COOKIE];
  if (!tok) return false;
  const exp = pendingPreAuth.get(tok);
  pendingPreAuth.delete(tok);
  return Boolean(exp && Date.now() < exp);
}

function requireHostSession(req, res, next) {
  if (!hasValidHostCookie(req)) {
    auditLog('host.auth_denied', { path: req.path, ipHash: hashIp(req.ip) });
    return res.status(401).json({ error: 'Solo el host autenticado puede acceder a este recurso.' });
  }
  next();
}

function makeIpLimiter(maxHits, windowMs, bucket) {
  const hits = new Map(); // ip -> [timestamps]
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const log = (hits.get(ip) || []).filter((ts) => now - ts < windowMs);
    if (log.length >= maxHits) {
      auditLog('rate_limit.exceeded', { bucket, ipHash: hashIp(ip) });
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

const joinLimiter = makeIpLimiter(25, 10 * 60_000, 'join');
const searchLimiter = makeIpLimiter(45, 60_000, 'search');
const mutateLimiter = makeIpLimiter(60, 60_000, 'mutate');
const leaveLimiter = makeIpLimiter(20, 60_000, 'leave');
const authLimiter = makeIpLimiter(10, 60_000, 'host_auth');
const hostApiLimiter = makeIpLimiter(30, 60_000, 'host_api');

// ---- WebSocket & room wiring ----

const sockets = new Map(); // ws -> { clientId: string | null, ip: string }
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
  for (const [ws, meta] of sockets.entries()) {
    if (meta.clientId === clientId) safeSend(ws, data);
  }
}

function hasOtherSocket(clientId, excludeWs = null) {
  for (const [ws, meta] of sockets.entries()) {
    if (ws !== excludeWs && meta.clientId === clientId && ws.readyState === ws.OPEN) return true;
  }
  return false;
}

function countSocketsForIp(ip) {
  let n = 0;
  for (const [ws, meta] of sockets.entries()) {
    if (meta.ip === ip && ws.readyState === ws.OPEN) n++;
  }
  return n;
}

function cancelLeave(clientId) {
  const t = leaveTimers.get(clientId);
  if (t) {
    clearTimeout(t);
    leaveTimers.delete(clientId);
  }
}

const room = new Room(broadcast);

// ---- Health endpoint (SOC 2 Availability) ----

app.get('/healthz', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    uptimeSec: Math.floor(process.uptime()),
    listeners: room.clients.size,
    queueLength: room.queue.length,
  });
});

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

app.post('/api/leave', leaveLimiter, (req, res) => {
  const { clientId } = req.body || {};
  if (typeof clientId === 'string' && room.clients.has(clientId)) {
    cancelLeave(clientId);
    for (const [ws, meta] of sockets.entries()) {
      if (meta.clientId === clientId) {
        meta.clientId = null;
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
  } catch {
    res.status(502).json({ error: 'No se pudo consultar el catálogo en este momento.' });
  }
});

app.post('/api/queue', mutateLimiter, (req, res) => {
  const { clientId, track } = req.body || {};
  const result = room.enqueue(clientId, track);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/vote', mutateLimiter, (req, res) => {
  const { clientId, vote, trackId } = req.body || {};
  const result = room.vote(clientId, vote, typeof trackId === 'string' ? trackId : null);
  if (result.error) return res.status(400).json(result);
  if (typeof clientId === 'string') sendToClient(clientId, room.clientVoteState(clientId));
  res.json(result);
});

app.get('/api/state', (_req, res) => res.json(room.snapshot()));

// ---- Spotify Host OAuth + Web Playback SDK endpoints (host-authenticated) ----

app.get('/api/spotify/status', (req, res) => {
  const isHost = hasValidHostCookie(req);
  res.json({ ...(isHost ? getHostStatus() : getPublicHostStatus()), isHost });
});

// Exchange HOST_ADMIN_SECRET via POST body or X-Admin-Key header (never in URL query string!)
app.post('/api/spotify/authorize', authLimiter, (req, res) => {
  if (!HOST_ADMIN_SECRET) {
    return res.status(400).json({ error: 'HOST_ADMIN_SECRET no está configurado.' });
  }
  const key = req.headers['x-admin-key'] || req.body?.key || '';
  if (!safeEqual(String(key), HOST_ADMIN_SECRET)) {
    auditLog('host.authorize_failed', { ipHash: hashIp(req.ip) });
    return res.status(403).json({ error: 'Clave de host inválida.' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  pendingPreAuth.set(token, Date.now() + PREAUTH_TTL_MS);
  res.setHeader(
    'Set-Cookie',
    `${PREAUTH_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=300${isHttpsReq(req) ? '; Secure' : ''}`
  );
  auditLog('host.authorize_ok', { ipHash: hashIp(req.ip) });
  res.json({ ok: true, loginUrl: '/api/spotify/login' });
});

app.get('/api/spotify/login', authLimiter, (req, res) => {
  const authorized = HOST_ADMIN_SECRET
    ? hasValidHostCookie(req) || consumePreAuthCookie(req)
    : isLoopback(req) || hasValidHostCookie(req);

  if (!authorized) {
    auditLog('host.login_denied', { ipHash: hashIp(req.ip) });
    return res.status(403).send('Acceso restringido al host. Autoriza primero vía POST /api/spotify/authorize o desde 127.0.0.1.');
  }
  try {
    auditLog('host.oauth_started', { ipHash: hashIp(req.ip) });
    res.redirect(getAuthUrl());
  } catch {
    res.status(400).send('Spotify no está configurado en el servidor.');
  }
});

app.get('/callback', authLimiter, async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    auditLog('host.oauth_denied', { ipHash: hashIp(req.ip) });
    return res.redirect('/screen?spotify_error=auth_denied');
  }
  if (typeof code !== 'string' || typeof state !== 'string') {
    return res.redirect('/screen?spotify_error=invalid_callback');
  }
  try {
    const { sessionToken } = await exchangeCode(code, state);
    const secureFlag = isHttpsReq(req) ? '; Secure' : '';
    res.setHeader('Set-Cookie', [
      `${HOST_COOKIE}=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Lax; Path=/${secureFlag}`,
      `${PREAUTH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    ]);
    auditLog('host.oauth_connected', { ipHash: hashIp(req.ip) });
    room.emitState();
    res.redirect('/screen');
  } catch (e) {
    const codeName = e.message === 'oauth_state_invalid' ? 'state_invalid' : 'exchange_failed';
    auditLog('host.oauth_failed', { reason: codeName, ipHash: hashIp(req.ip) });
    res.redirect(`/screen?spotify_error=${codeName}`);
  }
});

app.get('/api/spotify/token', hostApiLimiter, requireHostSession, async (_req, res) => {
  const accessToken = await getHostAccessToken();
  if (!accessToken) return res.status(401).json({ error: 'Host de Spotify no conectado.' });
  res.json({ accessToken });
});

app.post('/api/spotify/device', hostApiLimiter, requireHostSession, async (req, res) => {
  const { deviceId } = req.body || {};
  if (typeof deviceId !== 'string' || !deviceId.trim()) {
    return res.status(400).json({ error: 'deviceId requerido.' });
  }
  setHostDevice(deviceId);
  room.emitState();
  await room.syncCurrentPlayback();
  res.json({ ok: true, host: getHostStatus() });
});

app.post('/api/spotify/disconnect', hostApiLimiter, requireHostSession, (req, res) => {
  disconnectHost();
  res.setHeader('Set-Cookie', `${HOST_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  auditLog('host.disconnected', { ipHash: hashIp(req.ip) });
  room.emitState();
  res.json({ ok: true });
});

app.get('/screen', (_req, res) =>
  res.sendFile(path.join(DIST_DIR, 'screen.html'))
);

// ---- HTTP + WebSocket server ----

function isAllowedWsOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (curl/ws CLI)
  const host = req.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const server = createServer(app);
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 4 * 1024,
  verifyClient: ({ req }, cb) => {
    const ip = req.socket?.remoteAddress || 'unknown';
    if (!isAllowedWsOrigin(req)) {
      auditLog('ws.origin_rejected', { ipHash: hashIp(ip) });
      return cb(false, 403, 'Forbidden Origin');
    }
    if (countSocketsForIp(ip) >= MAX_WS_PER_IP) {
      auditLog('ws.ip_cap_exceeded', { ipHash: hashIp(ip) });
      return cb(false, 429, 'Too Many Connections');
    }
    return cb(true);
  },
});

wss.on('connection', (ws, req) => {
  const ip = req.socket?.remoteAddress || 'unknown';
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {
    sockets.delete(ws);
    try { ws.terminate(); } catch { /* ignore */ }
  });

  const meta = { clientId: null, ip };
  sockets.set(ws, meta);
  safeSend(ws, JSON.stringify(room.snapshot()));

  // First-message auth frame so client tokens never appear in URLs or proxy logs
  ws.on('message', (raw) => {
    if (meta.clientId) return;
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg?.type !== 'auth' || typeof msg.clientId !== 'string') return;
    if (room.clients.has(msg.clientId)) {
      cancelLeave(msg.clientId);
      meta.clientId = msg.clientId;
      safeSend(ws, JSON.stringify(room.clientVoteState(msg.clientId)));
    } else {
      safeSend(ws, JSON.stringify({ type: 'session-expired' }));
    }
  });

  ws.on('close', () => {
    const id = meta.clientId;
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
  for (const [tok, exp] of pendingPreAuth) {
    if (now >= exp) pendingPreAuth.delete(tok);
  }
  for (const [id, client] of room.clients) {
    if (now - client.joinedAt > ZOMBIE_TTL_MS && !hasOtherSocket(id) && !leaveTimers.has(id)) {
      room.leave(id);
    }
  }
  room.pruneExpired();
}, 15_000);
maintenanceTimer.unref();

// Graceful shutdown (SOC 2 Availability)
function shutdown(signal) {
  auditLog('server.shutdown', { signal });
  clearInterval(maintenanceTimer);
  clearTimeout(room.endTimer);
  for (const t of leaveTimers.values()) clearTimeout(t);
  leaveTimers.clear();
  for (const ws of wss.clients) {
    try { ws.close(1001, 'Server restarting'); } catch { /* ignore */ }
  }
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, () => {
  auditLog('server.started', {
    port: PORT,
    spotifyConfigured: spotifyEnabled,
    trustProxy: process.env.TRUST_PROXY === '1',
    hostAdminSecretSet: Boolean(HOST_ADMIN_SECRET),
  });
});
