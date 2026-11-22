import { createSignal } from 'solid-js';

let seq = 0;
const [toasts, setToasts] = createSignal([]);
const timers = new Map(); // id -> { timer, startedAt, remaining }

function clearEntry(id) {
  const entry = timers.get(id);
  if (entry) {
    clearTimeout(entry.timer);
    timers.delete(id);
  }
}

function dismiss(id) {
  clearEntry(id);
  setToasts((prev) =>
    prev.map((item) => (item.id === id ? { ...item, removed: true } : item))
  );
  setTimeout(() => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, 360);
}

function scheduleDismiss(id, remaining) {
  clearEntry(id);
  const ms = Math.max(400, remaining);
  const timer = setTimeout(() => dismiss(id), ms);
  timers.set(id, { timer, startedAt: Date.now(), remaining: ms });
}

function pauseAllToasts() {
  const now = Date.now();
  for (const [id, entry] of timers) {
    if (!entry.timer) continue;
    clearTimeout(entry.timer);
    const elapsed = now - entry.startedAt;
    timers.set(id, {
      timer: null,
      startedAt: 0,
      remaining: Math.max(400, entry.remaining - elapsed),
    });
  }
}

function resumeAllToasts() {
  for (const [id, entry] of timers) {
    if (entry.timer) continue;
    scheduleDismiss(id, entry.remaining);
  }
}

function push(type, title, description = '', duration = 3600) {
  const id = ++seq;
  const item = { id, type, title, description, duration, removed: false };
  // Newest toast is always index 0 (front of the Sonner stack)
  setToasts((prev) => {
    const next = [item, ...prev];
    while (next.length > 3) {
      const evicted = next.pop();
      if (evicted) clearEntry(evicted.id);
    }
    return next;
  });
  scheduleDismiss(id, duration);
  return id;
}

export const toast = {
  success: (title, description, duration = 3400) => push('success', title, description, duration),
  info: (title, description, duration = 3600) => push('info', title, description, duration),
  error: (title, description, duration = 4500) => push('error', title, description, duration),
  dismiss,
};

export { toasts, pauseAllToasts, resumeAllToasts };
