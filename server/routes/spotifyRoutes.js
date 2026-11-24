import { Router } from 'express';
import crypto from 'node:crypto';
import { HOST_ADMIN_SECRET, HOST_COOKIE, PREAUTH_COOKIE, PREAUTH_TTL_MS, TRUST_PROXY } from '../config.js';
import {
  getAuthUrl,
  exchangeCode,
  getHostAccessToken,
  verifyHostSession,
  setHostDevice,
  pauseAndDisconnectHost,
  getHostStatus,
  getPublicHostStatus,
} from '../spotify.js';
import {
  auditLog,
  getClientIp,
  hashIp,
  isHttpsReq,
  isLoopback,
  makeIpLimiter,
  parseCookies,
  safeEqual,
} from '../security.js';

const OAUTH_COOKIE = 'd3m_spotify_oauth';

function oauthCookie(req, value, maxAge) {
  return `${OAUTH_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/callback; Max-Age=${maxAge}${isHttpsReq(req) ? '; Secure' : ''}`;
}

export function createSpotifyRoutes(room) {
  const apiRouter = Router();
  const pendingPreAuth = new Map();
  const authLimiter = makeIpLimiter(10, 60_000, 'host_auth');
  const hostApiLimiter = makeIpLimiter(30, 60_000, 'host_api');

  const hasValidHostCookie = (req) => verifyHostSession(parseCookies(req.headers.cookie)[HOST_COOKIE]);

  function consumePreAuthCookie(req) {
    const tok = parseCookies(req.headers.cookie)[PREAUTH_COOKIE];
    if (!tok) return false;
    const exp = pendingPreAuth.get(tok);
    pendingPreAuth.delete(tok);
    return Boolean(exp && Date.now() < exp);
  }

  function requireHostSession(req, res, next) {
    if (!hasValidHostCookie(req)) {
      auditLog('host.auth_denied', { path: req.path, ipHash: hashIp(getClientIp(req)) });
      return res.status(401).json({ error: 'Solo el host autenticado puede acceder a este recurso.' });
    }
    next();
  }

  apiRouter.get('/status', (req, res) => {
    const isHost = hasValidHostCookie(req);
    res.json({ ...(isHost ? getHostStatus() : getPublicHostStatus()), isHost });
  });

  apiRouter.post('/authorize', authLimiter, (req, res) => {
    if (!HOST_ADMIN_SECRET) {
      return res.status(400).json({ error: 'HOST_ADMIN_SECRET no está configurado.' });
    }
    const key = req.headers['x-admin-key'] || req.body?.key || '';
    if (!safeEqual(String(key), HOST_ADMIN_SECRET)) {
      auditLog('host.authorize_failed', { ipHash: hashIp(getClientIp(req)) });
      return res.status(403).json({ error: 'Clave de host inválida.' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    pendingPreAuth.set(token, Date.now() + PREAUTH_TTL_MS);
    res.setHeader(
      'Set-Cookie',
      `${PREAUTH_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=300${isHttpsReq(req) ? '; Secure' : ''}`
    );
    auditLog('host.authorize_ok', { ipHash: hashIp(getClientIp(req)) });
    res.json({ ok: true, loginUrl: '/api/spotify/login' });
  });

  apiRouter.get('/login', authLimiter, (req, res) => {
    const authorized = HOST_ADMIN_SECRET
      ? hasValidHostCookie(req) || consumePreAuthCookie(req)
      : (!TRUST_PROXY && isLoopback(req)) || hasValidHostCookie(req);
    if (!authorized) {
      auditLog('host.login_denied', { ipHash: hashIp(getClientIp(req)) });
      return res.status(403).send('Acceso restringido al host. Autoriza primero vía POST /api/spotify/authorize o desde 127.0.0.1.');
    }
    try {
      auditLog('host.oauth_started', { ipHash: hashIp(getClientIp(req)) });
      const url = new URL(getAuthUrl());
      res.setHeader('Set-Cookie', oauthCookie(req, url.searchParams.get('state'), 600));
      res.redirect(url.toString());
    } catch {
      res.status(400).send('Spotify no está configurado en el servidor.');
    }
  });

  apiRouter.get('/token', hostApiLimiter, requireHostSession, async (_req, res) => {
    const accessToken = await getHostAccessToken();
    if (!accessToken) return res.status(401).json({ error: 'Host de Spotify no conectado.' });
    res.json({ accessToken });
  });

  apiRouter.post('/device', hostApiLimiter, requireHostSession, async (req, res) => {
    const { deviceId } = req.body || {};
    if (typeof deviceId !== 'string' || !setHostDevice(deviceId)) {
      return res.status(400).json({ error: 'deviceId inválido (1-128 caracteres).' });
    }
    room.emitState();
    const playback = await room.syncCurrentPlayback();
    res.json({ ok: true, host: getHostStatus(), playback });
  });

  apiRouter.delete('/device', hostApiLimiter, requireHostSession, (_req, res) => {
    setHostDevice(null);
    room.emitState();
    res.json({ ok: true, host: getHostStatus() });
  });

  apiRouter.post('/disconnect', hostApiLimiter, requireHostSession, async (req, res) => {
    await pauseAndDisconnectHost();
    const secureFlag = isHttpsReq(req) ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${HOST_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureFlag}`);
    auditLog('host.disconnected', { ipHash: hashIp(getClientIp(req)) });
    room.emitState();
    res.json({ ok: true });
  });

  const callbackMiddleware = [
    authLimiter,
    async (req, res) => {
      const { code, state, error } = req.query;
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Set-Cookie', oauthCookie(req, '', 0));
      if (error) {
        auditLog('host.oauth_denied', { ipHash: hashIp(getClientIp(req)) });
        return res.redirect('/screen?spotify_error=auth_denied');
      }
      if (typeof code !== 'string' || typeof state !== 'string') {
        return res.redirect('/screen?spotify_error=invalid_callback');
      }
      if (!safeEqual(state, parseCookies(req.headers.cookie)[OAUTH_COOKIE])) {
        return res.redirect('/screen?spotify_error=state_invalid');
      }
      try {
        const { sessionToken } = await exchangeCode(code, state);
        const secureFlag = isHttpsReq(req) ? '; Secure' : '';
        res.setHeader('Set-Cookie', [
          `${HOST_COOKIE}=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Lax; Path=/${secureFlag}`,
          `${PREAUTH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureFlag}`,
          oauthCookie(req, '', 0),
        ]);
        auditLog('host.oauth_connected', { ipHash: hashIp(getClientIp(req)) });
        room.emitState();
        res.redirect('/screen');
      } catch (e) {
        const codeName = e.message === 'oauth_state_invalid' ? 'state_invalid' : 'exchange_failed';
        auditLog('host.oauth_failed', { reason: codeName, ipHash: hashIp(getClientIp(req)) });
        res.redirect(`/screen?spotify_error=${codeName}`);
      }
    },
  ];

  function prunePreAuth() {
    const now = Date.now();
    for (const [tok, exp] of pendingPreAuth) {
      if (now >= exp) pendingPreAuth.delete(tok);
    }
  }

  return { apiRouter, callbackMiddleware, prunePreAuth };
}
