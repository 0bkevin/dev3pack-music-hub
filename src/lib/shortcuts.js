export function isMacPlatform(nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav) return false;
  const platform =
    nav.userAgentData?.platform ||
    nav.platform ||
    nav.userAgent ||
    '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function shortcutHint(nav) {
  return isMacPlatform(nav) ? '⌘K' : 'Ctrl K';
}

export function isEditableTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const tag = String(target.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(target.isContentEditable);
}

/**
 * Matches Cmd+K (macOS) or Ctrl+K (Windows/Linux) across QWERTY, AZERTY, Spanish,
 * and non-Latin keyboard layouts via e.code === 'KeyK' fallback, plus '/' when not typing.
 */
export function isCommandSearchEvent(e) {
  if (!e || e.altKey || e.shiftKey) return false;
  const isK = e.code === 'KeyK' || (typeof e.key === 'string' && e.key.toLowerCase() === 'k');
  if ((e.metaKey || e.ctrlKey) && isK) return true;
  if (!e.metaKey && !e.ctrlKey && e.key === '/' && !isEditableTarget(e.target)) return true;
  return false;
}
