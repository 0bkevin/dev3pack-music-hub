import 'dotenv/config';
import crypto from 'node:crypto';

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const PORT = parseInt(process.env.PORT || '3000', 10) || 3000;
const REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI || `http://127.0.0.1:${PORT}/callback`;
const MARKET = process.env.SPOTIFY_MARKET || 'US';

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

export const spotifyEnabled = Boolean(CLIENT_ID && CLIENT_SECRET);

// ---- Client Credentials token (app-level search) ----
let appToken = null;
let appTokenExpiresAt = 0;
let appTokenInFlight = null;

// ---- Host OAuth session (Premium account for full playback via Web Playback SDK) ----
const host = {
  accessToken: null,
  refreshToken: null,
  expiresAt: 0,
  user: null,
  product: null,
  deviceId: null,
  sessionToken: null,
};
let refreshInFlight = null;

// Support multiple concurrent/in-flight OAuth states with TTL so one stray call can't break another
const pendingOAuthStates = new Map(); // state -> createdAt
const OAUTH_STATE_TTL_MS = 10 * 60_000;

// ---- Search rate-limit protection & cache (playback uses a separate priority path) ----
const SP_WINDOW_MS = 5000;
const SP_MAX_SEARCH_CALLS = 18;
const spSearchCallTimes = [];
const searchCache = new Map(); // query -> { at, tracks }
const SEARCH_CACHE_MS = 30_000;

async function spSearchFetch(url, opts = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const now = Date.now();
    while (spSearchCallTimes.length && now - spSearchCallTimes[0] > SP_WINDOW_MS) {
      spSearchCallTimes.shift();
    }
    if (spSearchCallTimes.length < SP_MAX_SEARCH_CALLS) {
      spSearchCallTimes.push(Date.now());
      return fetch(url, opts);
    }
    const wait = Math.min(SP_WINDOW_MS, SP_WINDOW_MS - (now - spSearchCallTimes[0]) + 60);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error('Buscador temporalmente saturado, intenta en unos segundos.');
}

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
}

async function getAppToken() {
  if (appToken && Date.now() < appTokenExpiresAt - 30_000) return appToken;
  if (appTokenInFlight) return appTokenInFlight;

  appTokenInFlight = (async () => {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: basicAuthHeader(),
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`Spotify auth failed (${res.status})`);
    const data = await res.json();
    appToken = data.access_token;
    appTokenExpiresAt = Date.now() + data.expires_in * 1000;
    return appToken;
  })();

  try {
    return await appTokenInFlight;
  } finally {
    appTokenInFlight = null;
  }
}

export async function getHostAccessToken() {
  if (!host.accessToken) return null;
  if (Date.now() < host.expiresAt - 60_000) return host.accessToken;
  if (!host.refreshToken) return null;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: basicAuthHeader(),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: host.refreshToken,
      }),
    });
    if (!res.ok) {
      disconnectHost();
      return null;
    }
    const data = await res.json();
    host.accessToken = data.access_token;
    if (data.refresh_token) host.refreshToken = data.refresh_token;
    host.expiresAt = Date.now() + data.expires_in * 1000;
    return host.accessToken;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export function getAuthUrl() {
  if (!spotifyEnabled) throw new Error('Configura SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET en .env');
  const now = Date.now();
  for (const [k, ts] of pendingOAuthStates) {
    if (now - ts > OAUTH_STATE_TTL_MS) pendingOAuthStates.delete(k);
  }
  const oauthState = crypto.randomBytes(16).toString('hex');
  pendingOAuthStates.set(oauthState, now);

  const url = new URL('https://accounts.spotify.com/authorize');
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state: oauthState,
    show_dialog: 'true',
  });
  return url.toString();
}

export async function exchangeCode(code, state) {
  const createdAt = pendingOAuthStates.get(state);
  if (!state || !createdAt || Date.now() - createdAt > OAUTH_STATE_TTL_MS) {
    pendingOAuthStates.delete(state);
    throw new Error('oauth_state_invalid');
  }
  pendingOAuthStates.delete(state);

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!res.ok) {
    console.error(`Spotify token exchange failed (${res.status})`);
    throw new Error(`oauth_exchange_failed_${res.status}`);
  }
  const data = await res.json();
  host.accessToken = data.access_token;
  host.refreshToken = data.refresh_token;
  host.expiresAt = Date.now() + data.expires_in * 1000;
  host.sessionToken = crypto.randomBytes(32).toString('hex');

  const meRes = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${host.accessToken}` },
  });
  if (meRes.ok) {
    const me = await meRes.json();
    host.user = me.display_name || me.id || 'Host';
    host.product = me.product || null;
  }
  return { sessionToken: host.sessionToken, status: getHostStatus() };
}

export function verifyHostSession(token) {
  if (!token || !host.sessionToken || typeof token !== 'string') return false;
  const a = Buffer.from(token);
  const b = Buffer.from(host.sessionToken);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function setHostDevice(deviceId) {
  if (typeof deviceId !== 'string' || deviceId.length > 128) return;
  host.deviceId = deviceId.trim() || null;
}

export function disconnectHost() {
  host.accessToken = null;
  host.refreshToken = null;
  host.expiresAt = 0;
  host.user = null;
  host.product = null;
  host.deviceId = null;
  host.sessionToken = null;
}

export function getHostStatus() {
  return {
    configured: spotifyEnabled,
    connected: Boolean(host.accessToken),
    user: host.accessToken ? host.user : null,
    deviceReady: Boolean(host.deviceId),
  };
}

export function providerMode() {
  return spotifyEnabled ? 'spotify' : 'demo';
}

export async function playTrackOnHost(track, positionMs = 0) {
  if (!track?.uri || !/^spotify:track:[A-Za-z0-9]{22}$/.test(track.uri)) {
    return { ok: false, reason: 'invalid-uri' };
  }
  const token = await getHostAccessToken();
  if (!token) return { ok: false, reason: 'host-not-connected' };

  const url = new URL('https://api.spotify.com/v1/me/player/play');
  if (host.deviceId) url.searchParams.set('device_id', host.deviceId);

  // Playback calls bypass the search throttle bucket so search traffic can never starve audio
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      uris: [track.uri],
      position_ms: Math.max(0, Math.floor(positionMs)),
    }),
  });
  if (res.status === 204 || res.ok) return { ok: true };
  return { ok: false, status: res.status };
}

function normalize(t) {
  return {
    id: String(t.id),
    uri: t.uri || `spotify:track:${t.id}`,
    name: String(t.name || '').slice(0, 140),
    artists: (t.artists || []).map((a) => a.name).join(', ').slice(0, 140),
    album: String(t.album?.name || '').slice(0, 140),
    imageUrl: t.album?.images?.[0]?.url || null,
    durationMs: t.duration_ms || 180_000,
    spotifyUrl: t.external_urls?.spotify || null,
    explicit: Boolean(t.explicit),
    source: 'spotify',
  };
}

async function getSearchToken() {
  const hostTok = await getHostAccessToken();
  return hostTok || getAppToken();
}

export async function searchTracks(query) {
  if (!spotifyEnabled) return demoSearch(query);

  const key = query.toLowerCase().trim().slice(0, 100);
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_MS) return cached.tracks;

  const access = await getSearchToken();
  const url = new URL('https://api.spotify.com/v1/search');
  // Spotify 2026 Dev Mode caps search limit at 10
  url.search = new URLSearchParams({
    q: key,
    type: 'track',
    limit: '10',
    market: MARKET,
  });
  const res = await spSearchFetch(url, { headers: { Authorization: `Bearer ${access}` } });
  if (!res.ok) {
    throw new Error(`Error al buscar en Spotify (${res.status}).`);
  }
  const data = await res.json();
  const tracks = (data.tracks?.items || []).map(normalize);
  searchCache.set(key, { at: Date.now(), tracks });
  if (searchCache.size > 200) searchCache.delete(searchCache.keys().next().value);
  return tracks;
}

const RANDOM_TERMS = [
  'rock', 'pop', 'latin', 'reggaeton', 'hip hop', 'electronic', 'indie',
  'cumbia', 'salsa', 'jazz', 'synthwave', 'house', 'punk', 'r&b',
  'lofi', 'disco', 'techno', 'afrobeat', 'bossa nova',
];

export async function randomTrack(excludeIds = new Set()) {
  if (!spotifyEnabled) {
    const pool = DEMO_CATALOG.filter((t) => !excludeIds.has(t.id));
    return pool[Math.floor(Math.random() * pool.length)] || DEMO_CATALOG[0];
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const access = await getSearchToken();
      const url = new URL('https://api.spotify.com/v1/search');
      url.search = new URLSearchParams({
        q: RANDOM_TERMS[Math.floor(Math.random() * RANDOM_TERMS.length)],
        type: 'track',
        limit: '10',
        offset: String(Math.floor(Math.random() * 120)),
        market: MARKET,
      });
      const res = await fetch(url, { headers: { Authorization: `Bearer ${access}` } });
      if (!res.ok) continue;
      const items = (await res.json()).tracks?.items || [];
      const fresh = items.filter((t) => !excludeIds.has(t.id));
      const pool = fresh.length ? fresh : items;
      if (pool.length) return normalize(pool[Math.floor(Math.random() * pool.length)]);
    } catch {
      continue;
    }
  }
  return null;
}

// ---- Demo catalog (only used while SPOTIFY_CLIENT_ID / SECRET are empty) ----

const DEMO_CATALOG = [
  { id: 'demo-1', name: 'Midnight City', artists: 'M83', album: 'Hurry Up, We\'re Dreaming', durationMs: 243000, hue: 260 },
  { id: 'demo-2', name: 'Get Lucky', artists: 'Daft Punk, Pharrell Williams', album: 'Random Access Memories', durationMs: 248000, hue: 45 },
  { id: 'demo-3', name: 'Vivir Mi Vida', artists: 'Marc Anthony', album: '3.0', durationMs: 262000, hue: 12 },
  { id: 'demo-4', name: 'Tití Me Preguntó', artists: 'Bad Bunny', album: 'Un Verano Sin Ti', durationMs: 243000, hue: 160 },
  { id: 'demo-5', name: 'Starboy', artists: 'The Weeknd, Daft Punk', album: 'Starboy', durationMs: 230000, hue: 300 },
  { id: 'demo-6', name: 'Bohemian Rhapsody', artists: 'Queen', album: 'A Night at the Opera', durationMs: 354000, hue: 210 },
  { id: 'demo-7', name: 'Levitating', artists: 'Dua Lipa', album: 'Future Nostalgia', durationMs: 203000, hue: 190 },
  { id: 'demo-8', name: 'Provenza', artists: 'Karol G', album: 'Mañana Será Bonito', durationMs: 212000, hue: 140 },
  { id: 'demo-9', name: 'Take On Me', artists: 'a-ha', album: 'Hunting High and Low', durationMs: 225000, hue: 200 },
  { id: 'demo-10', name: 'Nights', artists: 'Frank Ocean', album: 'Blonde', durationMs: 307000, hue: 330 },
  { id: 'demo-11', name: 'Gasolina', artists: 'Daddy Yankee', album: 'Barrio Fino', durationMs: 192000, hue: 25 },
  { id: 'demo-12', name: 'Clair de Lune', artists: 'Flight Facilities', album: 'Down to Earth', durationMs: 272000, hue: 175 },
].map((t) => ({ ...t, uri: null, imageUrl: null, spotifyUrl: null, source: 'demo' }));

function demoSearch(query) {
  const q = query.toLowerCase();
  const hits = DEMO_CATALOG.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.artists.toLowerCase().includes(q) ||
      t.album.toLowerCase().includes(q)
  );
  return hits.length ? hits : DEMO_CATALOG.slice(0, 8);
}
