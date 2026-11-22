const SESSION_KEY = 'd3m_session';
const SESSION_TTL_MS = 12 * 60 * 60_000; // 12h retention cap (ISO 27701)

export function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.clientId || (parsed.exp && Date.now() > parsed.exp)) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  if (session) {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ ...session, exp: Date.now() + SESSION_TTL_MS })
    );
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Curated fallback gradients engineered to harmonize with Caracas 2026 vinotinto (#551727)
const VINOTINTO_GRADIENTS = [
  'linear-gradient(135deg, #5e1629, #a83254)',
  'linear-gradient(135deg, #431538, #8c2d64)',
  'linear-gradient(135deg, #6e1423, #c23b57)',
  'linear-gradient(135deg, #4f1a24, #9f6342)',
  'linear-gradient(135deg, #521830, #a04468)',
  'linear-gradient(135deg, #661926, #b54a4a)',
  'linear-gradient(135deg, #351633, #7e2b54)',
  'linear-gradient(135deg, #551727, #b3556d)',
];

export function trackGradient(track) {
  const idx = hashCode(String(track?.id || '0')) % VINOTINTO_GRADIENTS.length;
  return VINOTINTO_GRADIENTS[idx];
}

export function fmtMs(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
