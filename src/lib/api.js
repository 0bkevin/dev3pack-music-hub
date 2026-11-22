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

export function trackGradient(track) {
  const hue = track?.hue ?? (hashCode(track?.id || '0') % 360);
  return `linear-gradient(135deg, hsl(${hue},75%,42%), hsl(${(hue + 65) % 360},75%,50%))`;
}

export function fmtMs(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
