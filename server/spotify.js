import crypto from 'node:crypto';
import {
  SPOTIFY_CLIENT_ID as CLIENT_ID,
  SPOTIFY_CLIENT_SECRET as CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI as REDIRECT_URI,
  SPOTIFY_MARKET as MARKET,
} from './config.js';
import { searchDemoCatalog, randomDemoTrack } from './demoCatalog.js';

const SCOPES = [
  'streaming',
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
const SEARCH_CACHE_MS = 30_000;

const RANDOM_TERMS = [
  'rock', 'pop', 'latin', 'reggaeton', 'hip hop', 'electronic', 'indie',
  'cumbia', 'salsa', 'jazz', 'synthwave', 'house', 'punk', 'r&b',
  'lofi', 'disco', 'techno', 'afrobeat', 'bossa nova',
];

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
}

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
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
  if (!track?.uri || !/^spotify:track:[A-Za-z0-9]{22}$/.test(track.uri)) {
    return { ok: false, reason: 'invalid-uri' };
  }
  const token = await getHostAccessToken();
  if (!token) return { ok: false, reason: 'host-not-connected' };

  const url = new URL('https://api.spotify.com/v1/me/player/play');
  if (host.deviceId) url.searchParams.set('device_id', host.deviceId);

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
  return res.status === 204 || res.ok ? { ok: true } : { ok: false, status: res.status };
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
  return (await getHostAccessToken()) || getAppToken();
}

export async function searchTracks(query) {
  if (!spotifyEnabled) return searchDemoCatalog(query);

  const key = query.toLowerCase().trim().slice(0, 100);
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_MS) return cached.tracks;

  const access = await getSearchToken();
  const url = new URL('https://api.spotify.com/v1/search');
  url.search = new URLSearchParams({ q: key, type: 'track', limit: '10', market: MARKET });
  const res = await spSearchFetch(url, { headers: { Authorization: `Bearer ${access}` } });
  if (!res.ok) throw new Error(`Error al buscar en Spotify (${res.status}).`);
  const tracks = ((await res.json()).tracks?.items || []).map(normalize);
  searchCache.set(key, { at: Date.now(), tracks });
  if (searchCache.size > 200) searchCache.delete(searchCache.keys().next().value);
  return tracks;
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
