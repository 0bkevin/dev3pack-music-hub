import crypto from 'node:crypto';
import {
  SPOTIFY_CLIENT_ID as CLIENT_ID,
  SPOTIFY_CLIENT_SECRET as CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI as REDIRECT_URI,
  SPOTIFY_MARKET as MARKET,
} from './config.js';
import { searchDemoCatalog, getDemoTrackById, randomDemoTrack } from './demoCatalog.js';

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

export const spotifyEnabled = Boolean(CLIENT_ID && CLIENT_SECRET);

let appToken = null;
let appTokenExpiresAt = 0;
let appTokenInFlight = null;

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

const pendingOAuthStates = new Map();
const OAUTH_STATE_TTL_MS = 10 * 60_000;

const SP_WINDOW_MS = 5000;
const SP_MAX_SEARCH_CALLS = 18;
const spSearchCallTimes = [];
const searchCache = new Map();
const searchInFlight = new Map();
const SEARCH_CACHE_MS = 30_000;
const trackCatalog = new Map();
const trackFetchInFlight = new Map();
const TRACK_CATALOG_MAX = 2000;
const SPOTIFY_ID_RE = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_URI_RE = /^spotify:track:([A-Za-z0-9]{22})$/;

const RANDOM_TERMS = [
  'rock', 'pop', 'latin', 'reggaeton', 'hip hop', 'electronic', 'indie',
  'cumbia', 'salsa', 'jazz', 'synthwave', 'house', 'punk', 'r&b',
  'lofi', 'disco', 'techno', 'afrobeat', 'bossa nova',
];

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
}

function spotifyFetch(url, options) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
}

async function spSearchFetch(url, opts = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const now = Date.now();
    while (spSearchCallTimes.length && now - spSearchCallTimes[0] > SP_WINDOW_MS) {
      spSearchCallTimes.shift();
    }
    if (spSearchCallTimes.length < SP_MAX_SEARCH_CALLS) {
      spSearchCallTimes.push(Date.now());
      return spotifyFetch(url, opts);
    }
    const wait = Math.min(SP_WINDOW_MS, SP_WINDOW_MS - (now - spSearchCallTimes[0]) + 60);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw new Error('Buscador temporalmente saturado, intenta en unos segundos.');
}

async function getAppToken() {
  if (appToken && Date.now() < appTokenExpiresAt - 30_000) return appToken;
  if (appTokenInFlight) return appTokenInFlight;

  appTokenInFlight = (async () => {
    const res = await spotifyFetch('https://accounts.spotify.com/api/token', {
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
  if (!host.refreshToken) {
    disconnectHost();
    return null;
  }
  if (refreshInFlight) return refreshInFlight;

  const session = host.sessionToken;
  const refreshToken = host.refreshToken;
  const refresh = (async () => {
    const res = await spotifyFetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: basicAuthHeader(),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    if (host.sessionToken !== session) return null;
    if (!res.ok) {
      if (res.status === 400 || res.status === 401) disconnectHost();
      return null;
    }
    const data = await res.json();
    if (host.sessionToken !== session) return null;
    host.accessToken = data.access_token;
    if (data.refresh_token) host.refreshToken = data.refresh_token;
    host.expiresAt = Date.now() + data.expires_in * 1000;
    return host.accessToken;
  })().catch(() => null);
  refreshInFlight = refresh;

  try {
    return await refresh;
  } finally {
    if (refreshInFlight === refresh) refreshInFlight = null;
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

  const res = await spotifyFetch('https://accounts.spotify.com/api/token', {
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
  const meRes = await spotifyFetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  if (!meRes.ok) throw new Error(`oauth_profile_failed_${meRes.status}`);
  const me = await meRes.json();
  const sessionToken = crypto.randomBytes(32).toString('hex');
  disconnectHost();
  Object.assign(host, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    user: me.display_name || me.id || 'Host',
    product: me.product || null,
    sessionToken,
  });
  return { sessionToken, status: getHostStatus() };
}

export function verifyHostSession(token) {
  if (!token || !host.sessionToken || typeof token !== 'string') return false;
  const a = Buffer.from(token);
  const b = Buffer.from(host.sessionToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function setHostDevice(deviceId) {
  if (deviceId === null) {
    host.deviceId = null;
    return true;
  }
  if (typeof deviceId !== 'string') return false;
  const trimmed = deviceId.trim();
  if (!trimmed || trimmed.length > 128) return false;
  host.deviceId = trimmed;
  return true;
}

export function disconnectHost() {
  refreshInFlight = null;
  host.accessToken = null;
  host.refreshToken = null;
  host.expiresAt = 0;
  host.user = null;
  host.product = null;
  host.deviceId = null;
  host.sessionToken = null;
}

export async function pauseAndDisconnectHost() {
  const token = host.accessToken;
  const deviceId = host.deviceId;
  disconnectHost();
  if (!token || !deviceId) return;
  try {
    const url = new URL('https://api.spotify.com/v1/me/player/pause');
    url.searchParams.set('device_id', deviceId);
    await spotifyFetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* best-effort pause on disconnect */
  }
}

export function getPublicHostStatus() {
  return {
    configured: spotifyEnabled,
    connected: Boolean(host.accessToken),
    deviceReady: Boolean(host.deviceId),
  };
}

export function getHostStatus() {
  return {
    ...getPublicHostStatus(),
    user: host.accessToken ? host.user : null,
  };
}

export function providerMode() {
  return spotifyEnabled ? 'spotify' : 'demo';
}

export async function playTrackOnHost(track, positionMs = 0) {
  if (!track?.uri || !SPOTIFY_URI_RE.test(track.uri)) {
    return { ok: false, reason: 'invalid-uri' };
  }
  if (!host.deviceId) return { ok: false, reason: 'device-not-ready' };
  const token = await getHostAccessToken();
  if (!token) return { ok: false, reason: 'host-not-connected' };

  const url = new URL('https://api.spotify.com/v1/me/player/play');
  url.searchParams.set('device_id', host.deviceId);
  const safePositionMs = Number.isFinite(positionMs) ? Math.max(0, Math.floor(positionMs)) : 0;

  const res = await spotifyFetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      uris: [track.uri],
      position_ms: safePositionMs,
    }),
  });
  return res.status === 204 || res.ok ? { ok: true } : { ok: false, status: res.status };
}

function cacheTrack(track) {
  if (!track?.id) return track;
  if (trackCatalog.has(track.id)) trackCatalog.delete(track.id);
  trackCatalog.set(track.id, track);
  if (trackCatalog.size > TRACK_CATALOG_MAX) {
    trackCatalog.delete(trackCatalog.keys().next().value);
  }
  return track;
}

function normalize(t) {
  const id = String(t.id);
  return cacheTrack({
    id,
    uri: t.uri || `spotify:track:${id}`,
    name: String(t.name || '').slice(0, 140),
    artists: (t.artists || []).map((a) => a.name).join(', ').slice(0, 140),
    album: String(t.album?.name || '').slice(0, 140),
    imageUrl: t.album?.images?.[0]?.url || null,
    durationMs: t.duration_ms || 180_000,
    source: 'spotify',
  });
}

async function getSearchToken() {
  return (await getHostAccessToken()) || getAppToken();
}

export async function resolveTrack(rawTrack) {
  if (!rawTrack || typeof rawTrack !== 'object' || Array.isArray(rawTrack)) return null;
  if (!spotifyEnabled) {
    return getDemoTrackById(typeof rawTrack.id === 'string' ? rawTrack.id.trim() : '');
  }

  const rawId = typeof rawTrack.id === 'string' ? rawTrack.id.trim() : '';
  const uriMatch = typeof rawTrack.uri === 'string' ? rawTrack.uri.trim().match(SPOTIFY_URI_RE) : null;
  if (rawTrack.uri !== undefined && rawTrack.uri !== null && !uriMatch) return null;
  if (rawId && uriMatch && rawId !== uriMatch[1]) return null;

  const trackId = uriMatch ? uriMatch[1] : SPOTIFY_ID_RE.test(rawId) ? rawId : null;
  if (!trackId) return null;

  const cached = trackCatalog.get(trackId);
  if (cached) return cached;

  if (trackFetchInFlight.has(trackId)) return trackFetchInFlight.get(trackId);

  const req = (async () => {
    const access = await getSearchToken();
    const url = new URL(`https://api.spotify.com/v1/tracks/${trackId}`);
    url.searchParams.set('market', MARKET);
    const res = await spSearchFetch(url, { headers: { Authorization: `Bearer ${access}` } });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`Error al validar canción en Spotify (${res.status}).`);
    const data = await res.json();
    if (!data?.id || data.type !== 'track') return null;
    return normalize(data);
  })();

  trackFetchInFlight.set(trackId, req);
  try {
    return await req;
  } finally {
    if (trackFetchInFlight.get(trackId) === req) trackFetchInFlight.delete(trackId);
  }
}

export async function searchTracks(query) {
  if (!spotifyEnabled) return searchDemoCatalog(query);

  const key = query.toLowerCase().trim().slice(0, 100);
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_MS) return cached.tracks;
  if (searchInFlight.has(key)) return searchInFlight.get(key);

  const req = (async () => {
    const access = await getSearchToken();
    const url = new URL('https://api.spotify.com/v1/search');
    url.search = new URLSearchParams({ q: key, type: 'track', limit: '10', market: MARKET });
    const res = await spSearchFetch(url, { headers: { Authorization: `Bearer ${access}` } });
    if (!res.ok) throw new Error(`Error al buscar en Spotify (${res.status}).`);
    const tracks = ((await res.json()).tracks?.items || []).map(normalize);
    searchCache.set(key, { at: Date.now(), tracks });
    if (searchCache.size > 200) searchCache.delete(searchCache.keys().next().value);
    return tracks;
  })();

  searchInFlight.set(key, req);
  try {
    return await req;
  } finally {
    if (searchInFlight.get(key) === req) searchInFlight.delete(key);
  }
}

export async function randomTrack(excludeIds = new Set()) {
  if (!spotifyEnabled) return randomDemoTrack(excludeIds);
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
      const res = await spSearchFetch(url, { headers: { Authorization: `Bearer ${access}` } });
      if (res.status === 429) {
        const retrySec = Number.parseFloat(res.headers.get('retry-after') || '1');
        const waitMs = Math.min(5000, Math.max(500, Math.ceil((Number.isFinite(retrySec) ? retrySec : 1) * 1000)));
        if (attempt < 5) await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (!res.ok) {
        if (attempt < 5) await new Promise((r) => setTimeout(r, 150));
        continue;
      }
      const items = (await res.json()).tracks?.items || [];
      const fresh = items.filter((t) => !excludeIds.has(t.id));
      if (fresh.length) return normalize(fresh[Math.floor(Math.random() * fresh.length)]);
    } catch {
      if (attempt < 5) await new Promise((r) => setTimeout(r, 150));
      continue;
    }
  }
  return null;
}
