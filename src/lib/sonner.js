import { createSignal } from 'solid-js';

let seq = 0;
const [toasts, setToasts] = createSignal([]);
const timers = new Map();

function dismiss(id) {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
  setToasts((prev) =>
    prev.map((item) => (item.id === id ? { ...item, leaving: true } : item))
  );
  setTimeout(() => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, 240);
}

function scheduleDismiss(id, duration) {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => dismiss(id), duration);
  timers.set(id, timer);
}

function pauseToast(id) {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
}

function resumeToast(id, duration = 2200) {
  scheduleDismiss(id, duration);
}

function push(type, title, description = '', duration = 3800) {
  const id = ++seq;
  const item = { id, type, title, description, duration, leaving: false };
  setToasts((prev) => [...prev.slice(-2), item]);
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
