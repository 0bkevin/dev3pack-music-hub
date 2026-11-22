import crypto from 'node:crypto';
import { ALLOWED_ORIGINS, TRUST_PROXY } from './config.js';

// Ephemeral per-boot salt for IP pseudonymization in structured audit logs (ISO 27701)
const LOG_SALT = crypto.randomBytes(16).toString('hex');

export function hashIp(ip) {
  return crypto
    .createHash('sha256')
    .update(`${LOG_SALT}:${ip || 'unknown'}`)
    .digest('hex')
    .slice(0, 12);
}

// Structured JSON security audit logger — never logs secrets, tokens, raw IPs, or user PII
export function auditLog(event, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...meta }));
}

export function parseCookies(header) {
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

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function isLoopback(req) {
  const ip = req.socket?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function isHttpsReq(req) {
  return Boolean(req.secure || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https'));
}

export function isAllowedWsOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (ALLOWED_ORIGINS.length > 0) {
    return ALLOWED_ORIGINS.includes(origin);
  }
  const host = req.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function makeIpLimiter(maxHits, windowMs, bucket) {
  const hits = new Map();
  const globalHits = [];
  const globalMax = maxHits * 4;

  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();

    // Global backstop prevents total bypass if proxy X-Forwarded-For is misconfigured
    while (globalHits.length && now - globalHits[0] >= windowMs) globalHits.shift();
    if (globalHits.length >= globalMax) {
      auditLog('rate_limit.global_exceeded', { bucket, ipHash: hashIp(ip) });
      return res.status(429).json({ error: 'Servidor temporalmente ocupado. Intenta en un momento.' });
    }

    const log = (hits.get(ip) || []).filter((ts) => now - ts < windowMs);
    if (log.length >= maxHits) {
      auditLog('rate_limit.exceeded', { bucket, ipHash: hashIp(ip) });
      return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta de nuevo en un momento.' });
    }
    log.push(now);
    globalHits.push(now);
    hits.set(ip, log);
    if (hits.size > 2000) {
      for (const [k, v] of hits) {
        if (!v.length || now - v[v.length - 1] >= windowMs) hits.delete(k);
      }
    }
    next();
  };
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://sdk.scdn.co",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' https://*.scdn.co https://*.spotifycdn.com data:",
  "connect-src 'self' ws: wss: https://*.spotify.com https://sdk.scdn.co",
  "media-src 'self' https://*.scdn.co",
  "frame-src https://sdk.scdn.co",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

export function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (isHttpsReq(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}
