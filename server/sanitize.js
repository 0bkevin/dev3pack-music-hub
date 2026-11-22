import { MAX_TRACK_DURATION_MS } from './config.js';

export const MIN_DURATION_MS = 15_000;
export const MAX_DURATION_MS = MAX_TRACK_DURATION_MS;
export const MIN_NAME_LENGTH = 2;
export const MAX_NAME_LENGTH = 20;

const VALID_NAME_CHARS = /^[\p{L}\p{N} ._'-]+$/u;

// Substring patterns checked against space-stripped, accent-stripped, leetspeak-folded text
const BLOCKED_SUBSTRINGS = [
  // Extremist / dictatorial / political figures
  'hitler', 'mussolin', 'musolin', 'stalin', 'pinochet', 'maduro', 'chavez',
  'trump', 'binladen', 'nazi', 'fascist', 'holocaust', 'gestapo', 'fuhrer',
  // Obscene / profanity (ES / VE / EN)
  'mamaguevo', 'mamahuevo', 'maricon', 'marico', 'malparido', 'gonorrea',
  'carechimba', 'gilipollas', 'pendejo', 'cabron', 'chingar', 'chinga',
  'mierda', 'pajero', 'follar', 'boludo', 'pelotudo', 'culiao', 'huevon', 'webon',
  'motherfucker', 'fuck', 'bitch', 'asshole', 'cunt', 'whore', 'nigger', 'nigga',
  'faggot', 'retard', 'porno', 'hentai', 'orgia', 'vagina', 'chocha', 'verga',
  // Gore / violence / abuse
  'gore', 'decapita', 'mutila', 'necrofilia', 'pedofil', 'violador', 'violacion',
  'suicid', 'homicid', 'genocid', 'masacre', 'terrorist', 'tortura',
  'dismember', 'behead', 'rapist',
];

// Whole-word patterns (avoids false positives inside legitimate names like "Analia" or "Sexto")
const BLOCKED_WORDS = new Set([
  'adolf', 'osama', 'kkk', 'isis', 'reich',
  'puta', 'puto', 'putas', 'putos', 'zorra', 'perra', 'cono', 'culo', 'pene',
  'cuca', 'paja', 'coger', 'joder', 'forro', 'concha', 'carajo', 'tetas',
  'nalgas', 'sexo', 'sex', 'porn', 'xxx', 'milf', 'bdsm',
  'shit', 'dick', 'cock', 'pussy', 'slut', 'bastard',
  'gore', 'rape', 'murder', 'killer', 'asesino', 'matar', 'violar',
  'cadaver', 'sangre', 'bomba',
]);

function foldForModeration(str) {
  return str
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't')
    .replace(/(.)\1{2,}/g, '$1$1');
}

export function validateDisplayName(raw) {
  if (raw === undefined || raw === null) return { anonymous: true, name: '' };
  if (typeof raw !== 'string') return { error: 'Nombre inválido.' };
  const clean = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!clean) return { anonymous: true, name: '' };

  if (clean.length < MIN_NAME_LENGTH || clean.length > MAX_NAME_LENGTH) {
    return {
      error: `El nombre debe tener entre ${MIN_NAME_LENGTH} y ${MAX_NAME_LENGTH} caracteres.`,
    };
  }
  if (!VALID_NAME_CHARS.test(clean)) {
    return { error: 'Usa solo letras, números y espacios en tu nombre.' };
  }

  const folded = foldForModeration(clean);
  const compact = folded.replace(/[^a-z]/g, '');
  const compactSingle = compact.replace(/(.)\1+/g, '$1');

  for (const term of BLOCKED_SUBSTRINGS) {
    const termSingle = term.replace(/(.)\1+/g, '$1');
    if (compact.includes(term) || compactSingle.includes(termSingle)) {
      return { error: 'Ese nombre no está permitido. Elige otro nombre.' };
    }
  }

  const words = folded.split(/[^a-z]+/).filter(Boolean);
  for (const w of words) {
    const wSingle = w.replace(/(.)\1+/g, '$1');
    if (BLOCKED_WORDS.has(w) || BLOCKED_WORDS.has(wSingle)) {
      return { error: 'Ese nombre no está permitido. Elige otro nombre.' };
    }
  }

  return { anonymous: false, name: clean };
}

export const PREDEFINED_EMOJIS = [
  '🎧', '🔥', '⚡', '🎸', '🎹', '🚀', '👾', '🦊',
  '🪩', '🌊', '💜', '🎵', '🥁', '🌙', '🎤', '✨',
];

const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const EMOJI_RE = /\p{Extended_Pictographic}/u;
// Reject combining marks, tag characters (U+E0000-E007F), and format chars other than ZWJ (U+200D) / VS16 (U+FE0F)
const DISALLOWED_EMOJI_CP = /[\u{E0000}-\u{E007F}\p{Mark}]/u;

export function randomEmoji() {
  return PREDEFINED_EMOJIS[Math.floor(Math.random() * PREDEFINED_EMOJIS.length)];
}

/**
 * Accepts any single valid Unicode emoji grapheme (including standard ZWJ sequences),
 * rejecting plain text, HTML, combining-mark graffiti, tag characters, or multi-emoji strings.
 */
export function sanitizeEmoji(raw) {
  if (typeof raw !== 'string') return randomEmoji();
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 14 || /[<>"'&`\\/\s\r\n\t]/.test(trimmed)) {
    return randomEmoji();
  }
  const segments = [...graphemeSegmenter.segment(trimmed)].map((s) => s.segment);
  if (segments.length !== 1) return randomEmoji();
  const seg = segments[0];
  if (!EMOJI_RE.test(seg)) return randomEmoji();
  // Strip allowed VS16/ZWJ before checking for disallowed combining/tag/format code points
  const stripped = seg.replace(/[\uFE0F\u200D]/g, '');
  if (DISALLOWED_EMOJI_CP.test(stripped) || /\p{Cf}/u.test(stripped)) {
    return randomEmoji();
  }
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
