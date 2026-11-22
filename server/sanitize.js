export const MIN_DURATION_MS = 15_000;
export const MAX_DURATION_MS = 10 * 60_000;

const ALLOWED_IMAGE_HOSTS = new Set([
  'i.scdn.co',
  'mosaic.scdn.co',
  'image-cdn-ak.spotifycdn.com',
  'image-cdn-fa.spotifycdn.com',
]);

function sanitizeImageUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  if (raw.length > 512 || /[\s"'()\\<>]/.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    if (!ALLOWED_IMAGE_HOSTS.has(u.hostname) && !u.hostname.endsWith('.scdn.co')) {
      return null;
    }
    return u.toString();
  } catch {
    return null;
  }
}

export function sanitizeTrack(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.id !== 'string') return null;
  const id = raw.id.trim();
  if (!id || id.length > 64 || !/^[A-Za-z0-9:_-]+$/.test(id)) return null;

  if (typeof raw.name !== 'string') return null;
  const name = raw.name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 140);
  if (!name) return null;

  const artists = typeof raw.artists === 'string'
    ? raw.artists.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 140)
    : '';
  const album = typeof raw.album === 'string'
    ? raw.album.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 140)
    : '';

  const rawDur = typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs)
    ? raw.durationMs
    : 180_000;
  const durationMs = Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, Math.floor(rawDur)));

  const uri = typeof raw.uri === 'string' && /^spotify:track:[A-Za-z0-9]{22}$/.test(raw.uri)
    ? raw.uri
    : null;

  const hue = typeof raw.hue === 'number' && Number.isFinite(raw.hue)
    ? ((Math.floor(raw.hue) % 360) + 360) % 360
    : undefined;

  return {
    id,
    uri,
    name,
    artists,
    album,
    imageUrl: sanitizeImageUrl(raw.imageUrl),
    durationMs,
    source: uri ? 'spotify' : 'demo',
    ...(hue !== undefined ? { hue } : {}),
  };
}
