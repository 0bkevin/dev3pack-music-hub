import 'dotenv/config';

function envInt(name, fallback, min = 1, max = 10_000) {
  const n = parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export const PORT = envInt('PORT', 3000, 1, 65535);
export const DB_PATH = (process.env.DB_PATH || './data/music-hub.sqlite').trim();
export const DB_RETENTION_MS = envInt('DB_RETENTION_HOURS', 72, 1, 720) * 60 * 60_000;
export const IP_HASH_SALT = (process.env.IP_HASH_SALT || '').trim();
export const TRUST_PROXY = process.env.TRUST_PROXY === '1';
export const HOST_ADMIN_SECRET = (process.env.HOST_ADMIN_SECRET || '').trim();
export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
export const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
export const SPOTIFY_REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI || `http://127.0.0.1:${PORT}/callback`;
export const SPOTIFY_MARKET = process.env.SPOTIFY_MARKET || 'US';

export const DISLIKES_TO_SKIP = envInt('DISLIKES_TO_SKIP', 5, 1, 100);
export const REPLAY_COOLDOWN_MS = envInt('REPLAY_COOLDOWN_MINUTES', 30, 1, 1440) * 60_000;
export const ENQUEUE_MAX = envInt('ENQUEUE_MAX_PER_WINDOW', 3, 1, 50);
export const ENQUEUE_WINDOW_MS = envInt('ENQUEUE_WINDOW_MINUTES', 10, 1, 120) * 60_000;
export const MAX_TRACK_MINUTES = envInt('MAX_TRACK_MINUTES', 7, 1, 60);
export const MAX_TRACK_DURATION_MS = MAX_TRACK_MINUTES * 60_000;
export const MAX_VOTES_PER_TRACK = envInt('MAX_VOTES_PER_TRACK', 2, 1, 10);
export const MAX_CLIENTS = envInt('MAX_CLIENTS', 250, 10, 2000);
export const DISCONNECT_GRACE_MS = envInt('DISCONNECT_GRACE_MS', 8000, 0, 60_000);

// Generous defaults for shared hackathon venue Wi-Fi (NAT)
export const JOIN_RATE_MAX = envInt('JOIN_RATE_MAX_PER_IP', 200, 10, 5000);
export const SEARCH_RATE_MAX = envInt('SEARCH_RATE_MAX_PER_IP', 180, 20, 5000);
export const MUTATE_RATE_MAX = envInt('MUTATE_RATE_MAX_PER_IP', 300, 30, 5000);

export const ZOMBIE_TTL_MS = 30_000;
export const MAX_WS_PER_IP = envInt('MAX_WS_PER_IP', 40, 1, 5000);
export const MAX_WS_CONNECTIONS = envInt('MAX_WS_CONNECTIONS', Math.max(MAX_CLIENTS * 2, 500), 10, 10_000);
export const HOST_COOKIE = 'd3m_host';
export const PREAUTH_COOKIE = 'd3m_host_init';
export const PREAUTH_TTL_MS = 5 * 60_000;
