import { Show, For } from 'solid-js';
import { fmtMs } from '../../lib/api.js';
import { Cover } from '../Cover.jsx';
import { SearchIcon } from '../Icons.jsx';

export function TrackBrowser(props) {
  return (
    <section class="browser-section">
      <div class="browser-top">
        <div class="search-wrap">
          <span class="search-icon">
            <SearchIcon />
          </span>
          <input
            ref={props.searchRef}
            class="search-input"
            id="search-input"
            value={props.searchText()}
            onInput={(e) => props.onSearchInput(e.currentTarget.value)}
            placeholder="Buscar canción, artista o álbum…"
            autocomplete="off"
          />
          <Show when={props.isManualSearch()}>
            <button
              class="search-clear"
              id="search-clear"
              type="button"
              aria-label="Limpiar búsqueda"
              onClick={props.onClearSearch}
            >
              ×
            </button>
          </Show>
        </div>

        <span class="section-sub">Máx. 3 canciones cada 10 min · 30 min para repetir</span>
      </div>

      <Show
        when={!props.isManualSearch()}
        fallback={
          <div class="section-header">
            <h2 class="section-title">Resultados para &ldquo;{props.searchText().trim()}&rdquo;</h2>
          </div>
        }
      >
        <div class="mood-pills" id="mood-pills">
          <For each={props.moods}>
            {(mood) => (
              <button
                class={`mood-pill${props.activeMood() === mood ? ' active' : ''}`}
                type="button"
                data-q={mood}
                onClick={() => props.onSelectMood(mood)}
              >
                {mood}
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="track-table-head">
        <span class="th-num">#</span>
        <span />
        <span>Título</span>
        <span class="th-album">Álbum</span>
        <span class="th-dur">Duración</span>
        <span />
      </div>

      <div class="track-list" id="results">
        <Show
          when={props.results().length > 0}
          fallback={
            <div class="empty-copy">
              {props.searching() ? 'Buscando…' : 'No encontramos canciones para esa búsqueda.'}
            </div>
          }
        >
          <For each={props.results()}>
            {(track, idx) => {
              const isPlaying = () => props.currentTrackId() === track.id;
              const isQueued = () => props.queuedIds().has(track.id);
              const isBusy = () => props.pendingIds().has(track.id);
              const disabled = () => isPlaying() || isQueued() || isBusy();
              const label = () =>
                isPlaying() ? 'Sonando' : isQueued() ? '✓ En cola' : '+ Cola';

              return (
                <div class="track-row">
                  <span class="track-idx">{idx() + 1}</span>
                  <Cover track={track} class="track-art" />
                  <div class="track-main">
                    <div class="track-name">{track.name}</div>
                    <div class="track-artist">{track.artists}</div>
                  </div>
                  <div class="track-album">{track.album || ''}</div>
                  <div class="track-dur">{fmtMs(track.durationMs)}</div>
                  <button
                    class="add-btn"
                    type="button"
                    disabled={disabled()}
                    onClick={() => props.onEnqueue(track)}
                  >
                    {label()}
                  </button>
                </div>
              );
            }}
          </For>
        </Show>
      </div>
    </section>
  );
}
