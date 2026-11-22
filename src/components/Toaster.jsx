import { For, Show } from 'solid-js';
import { toasts, toast, pauseToast, resumeToast } from '../lib/sonner.js';

function ToastIcon(props) {
  return (
    <span class={`sonner-icon ${props.type}`} aria-hidden="true">
      <Show when={props.type === 'success'}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </Show>
      <Show when={props.type === 'error'}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" x2="12" y1="8" y2="12" />
          <line x1="12" x2="12.01" y1="16" y2="16" />
        </svg>
      </Show>
      <Show when={props.type === 'info'}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </Show>
    </span>
  );
}

export function Toaster(props) {
  return (
    <ol
      class={`sonner-toaster${props.offsetPlayer ? ' above-player' : ''}`}
      id="sonner-toaster"
      aria-label="Notificaciones"
    >
      <For each={toasts()}>
        {(item) => (
          <li
            class={`sonner-toast ${item.type}${item.leaving ? ' leaving' : ''}`}
            role={item.type === 'error' ? 'alert' : 'status'}
            aria-live={item.type === 'error' ? 'assertive' : 'polite'}
            onMouseEnter={() => pauseToast(item.id)}
            onMouseLeave={() => resumeToast(item.id)}
          >
            <ToastIcon type={item.type} />
            <div class="sonner-body">
              <div class="sonner-title">{item.title}</div>
              <Show when={item.description}>
                <div class="sonner-desc">{item.description}</div>
              </Show>
            </div>
            <button
              type="button"
              class="sonner-close"
              aria-label="Cerrar notificación"
              onClick={() => toast.dismiss(item.id)}
            >
              ×
            </button>
          </li>
        )}
      </For>
    </ol>
  );
}
