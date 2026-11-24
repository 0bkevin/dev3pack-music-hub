import { Show, For, createEffect } from 'solid-js';
import { Cover } from '../Cover.jsx';

export function QueueRail(props) {
  let railRef;
  let closeBtnRef;
  let prevFocused = null;
  let wasOpen = false;

  createEffect(() => {
    const isOpen = props.open();
    if (isOpen && !wasOpen) {
      prevFocused = document.activeElement;
      queueMicrotask(() => closeBtnRef?.focus());
    } else if (!isOpen && wasOpen) {
      if (prevFocused && typeof prevFocused.focus === 'function') {
        prevFocused.focus();
      }
      prevFocused = null;
    }
    wasOpen = isOpen;
  });

  function trapDrawerFocus(event) {
    if (!props.open() || event.key !== 'Tab' || !railRef || !window.matchMedia('(max-width: 980px)').matches) return;
    const controls = railRef.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <Show when={props.open()}>
        <div class="drawer-backdrop" onClick={props.onClose} />
      </Show>

      <aside
        ref={(el) => { railRef = el; }}
        class={`queue-rail${props.open() ? ' open' : ''}`}
        id="queue-rail"
        onKeyDown={trapDrawerFocus}
      >
        <div class="rail-head">
          <h2 class="rail-title">A continuación</h2>
          <div class="rail-head-right">
            <span class="rail-badge">{props.queue().length}</span>
            <button
              ref={(el) => { closeBtnRef = el; }}
              class="rail-close-btn"
              type="button"
              aria-label="Cerrar cola"
              onClick={props.onClose}
            >
              ×
            </button>
          </div>
        </div>

        <div class="rail-scroll">
          <Show
            when={props.queue().length > 0}
            fallback={<div class="empty-copy">Cola vacía</div>}
          >
            <For each={props.queue()}>
              {(item, i) => {
                const isMine = () => Boolean(props.selfPublicId?.() && item.userId === props.selfPublicId());
                return (
                  <div class={`q-item${i() === 0 ? ' next-up' : ''}`}>
                    <Cover track={item.track} />
                    <div class="q-info">
                      <Show when={i() === 0}>
                        <div class="next-tag">Siguiente</div>
                      </Show>
                      <div class="q-name">{item.track.name}</div>
                      <div class="q-sub">
                        {item.track.artists}
                        <span class="q-sep">·</span>
                        <span class="q-who">
                          {item.addedByEmoji ? `${item.addedByEmoji} ` : ''}
                          {item.addedBy}
                        </span>
                      </div>
                    </div>
                    <Show when={isMine()}>
                      <button
                        type="button"
                        class="q-cancel-btn"
                        aria-label={`Quitar ${item.track.name} de la cola`}
                        title="Quitar de la cola"
                        onClick={() => props.onCancel?.(item)}
                      >
                        ×
                      </button>
                    </Show>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>
      </aside>
    </>
  );
}
