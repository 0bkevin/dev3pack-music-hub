import { createSignal, For, Show } from 'solid-js';
import { toasts, toast, pauseAllToasts, resumeAllToasts } from '../lib/sonner.js';

function SonnerIcon(props) {
  return (
    <span class="sonner-icon" data-type={props.type} aria-hidden="true">
      <Show when={props.type === 'success'}>
        <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor">
          <path
            fill-rule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
            clip-rule="evenodd"
          />
        </svg>
      </Show>
      <Show when={props.type === 'error'}>
        <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor">
          <path
            fill-rule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
            clip-rule="evenodd"
          />
        </svg>
      </Show>
      <Show when={props.type === 'info'}>
        <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor">
          <path
            fill-rule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
            clip-rule="evenodd"
          />
        </svg>
      </Show>
    </span>
  );
}

export function Toaster(props) {
  const [expanded, setExpanded] = createSignal(false);

  return (
    <ol
      class={`sonner-toaster${props.offsetPlayer ? ' above-player' : ''}`}
      id="sonner-toaster"
      data-expanded={expanded()}
      aria-label="Notificaciones"
      onMouseEnter={() => {
        setExpanded(true);
        pauseAllToasts();
      }}
      onMouseLeave={() => {
        setExpanded(false);
        resumeAllToasts();
      }}
    >
      <For each={toasts()}>
        {(item, idx) => (
          <li
            class={`sonner-toast ${item.type}`}
            data-front={idx() === 0}
            data-expanded={expanded()}
            data-removed={item.removed}
            style={{
              '--index': idx(),
              '--z-index': 10 - idx(),
            }}
            role={item.type === 'error' ? 'alert' : 'status'}
            aria-live={item.type === 'error' ? 'assertive' : 'polite'}
          >
            <button
              type="button"
              class="sonner-close"
              aria-label="Cerrar notificación"
              onClick={() => toast.dismiss(item.id)}
            >
              ×
            </button>
            <SonnerIcon type={item.type} />
            <div class="sonner-body">
              <div class="sonner-title">{item.title}</div>
              <Show when={item.description}>
                <div class="sonner-desc">{item.description}</div>
              </Show>
            </div>
          </li>
        )}
      </For>
    </ol>
  );
}
