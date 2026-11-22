export const MIN_DURATION_MS = 15_000;
export const MAX_DURATION_MS = 10 * 60_000;

export const PREDEFINED_EMOJIS = [
  '🎧', '🔥', '⚡', '🎸', '🎹', '🚀', '👾', '🦊',
  '🪩', '🌊', '💜', '🎵', '🥁', '🌙', '🎤', '✨',
];

const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const EMOJI_RE = /\p{Extended_Pictographic}/u;

export function randomEmoji() {
  return PREDEFINED_EMOJIS[Math.floor(Math.random() * PREDEFINED_EMOJIS.length)];
}

/**
 * Accepts any single valid Unicode emoji grapheme (including ZWJ / variation selectors),
 * rejecting plain text, HTML, or multi-emoji strings. Falls back to a predefined random emoji.
 */
export function sanitizeEmoji(raw) {
  if (typeof raw !== 'string') return randomEmoji();
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 24 || /[<>"'&`\\/\s\r\n\t]/.test(trimmed)) {
    return randomEmoji();
  }
  const segments = [...graphemeSegmenter.segment(trimmed)].map((s) => s.segment);
  if (segments.length !== 1) return randomEmoji();
  const seg = segments[0];
  if (!EMOJI_RE.test(seg)) return randomEmoji();
  return seg;
}

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
