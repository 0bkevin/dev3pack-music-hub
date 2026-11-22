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
            fallback={
              <div class="empty-copy">
                La cola está vacía. Cuando termine la canción actual elegimos una aleatoria.
              </div>
            }
          >
            <For each={props.queue()}>
              {(item, i) => (
                <div class={`q-item${i() === 0 ? ' next-up' : ''}`}>
                  <Cover track={item.track} />
                  <div class="q-info">
                    <Show when={i() === 0}>
                      <div class="next-tag">Siguiente</div>
                    </Show>
                    <div class="q-name">{item.track.name}</div>
                    <div class="q-sub">{item.track.artists}</div>
                    <div class="q-who">por {item.addedBy}</div>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </aside>
    </>
  );
}
