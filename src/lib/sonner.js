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
    prev.map((item) => (item.id === id ? { ...item, leaving: true } : item))
  );
  setTimeout(() => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, 240);
}

function scheduleDismiss(id, remaining) {
  clearEntry(id);
  const ms = Math.max(400, remaining);
  const timer = setTimeout(() => dismiss(id), ms);
  timers.set(id, { timer, startedAt: Date.now(), remaining: ms });
}

function pauseToast(id) {
  const entry = timers.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  const elapsed = Date.now() - entry.startedAt;
  timers.set(id, {
    timer: null,
    startedAt: 0,
    remaining: Math.max(400, entry.remaining - elapsed),
  });
}

function resumeToast(id) {
  const entry = timers.get(id);
  if (!entry || entry.timer) return;
  scheduleDismiss(id, entry.remaining);
}

function push(type, title, description = '', duration = 3800) {
  const id = ++seq;
  const item = { id, type, title, description, duration, leaving: false };
  setToasts((prev) => {
    const next = [...prev, item];
    while (next.length > 3) {
      const evicted = next.shift();
      if (evicted) clearEntry(evicted.id);
    }
    return next;
  });
  scheduleDismiss(id, duration);
  return id;
}

export const toast = {
  success: (title, description, duration = 3600) => push('success', title, description, duration),
  info: (title, description, duration = 3800) => push('info', title, description, duration),
  error: (title, description, duration = 4600) => push('error', title, description, duration),
  dismiss,
};

export { toasts, pauseToast, resumeToast };
