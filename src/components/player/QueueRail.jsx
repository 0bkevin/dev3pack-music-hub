import { Show, For } from 'solid-js';
import { Cover } from '../Cover.jsx';

export function QueueRail(props) {
  return (
    <>
      <Show when={props.open()}>
        <div class="drawer-backdrop" onClick={props.onClose} />
      </Show>

      <aside class={`queue-rail${props.open() ? ' open' : ''}`} id="queue-rail">
        <div class="rail-head">
          <h2 class="rail-title">A continuación</h2>
          <div class="rail-head-right">
            <span class="rail-badge">{props.queue().length}</span>
            <button
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
