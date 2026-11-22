import { Show } from 'solid-js';
import { MusicNoteIcon, QueueIcon, SearchIcon, TvIcon } from '../Icons.jsx';

export function Topbar(props) {
  return (
    <header class="topbar">
      <a class="brand" href="/">
        <span class="brand-mark">
          <MusicNoteIcon size={15} strokeWidth={2.4} />
        </span>
        <span class="brand-title">
          Dev3pack <span class="brand-sub">Music</span>
        </span>
      </a>

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
          placeholder="¿Qué quieres escuchar?"
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

      <div class="topbar-actions">
        <button
          class="queue-toggle-btn"
          id="queue-toggle-btn"
          type="button"
          aria-label="Ver cola"
          onClick={props.onToggleQueue}
        >
          <QueueIcon />
          <span>Cola</span>
          <span class="queue-toggle-count tabular">{props.queueCount()}</span>
        </button>
        <Show when={props.session()?.name}>
          <button
            class="user-btn"
            id="who-btn"
            type="button"
            title="Cambiar nombre"
            onClick={props.onOpenJoin}
          >
            <span class="user-avatar">
              {props.session().name.trim()[0]?.toUpperCase() || '?'}
            </span>
            <span class="user-btn-name">{props.session().name}</span>
          </button>
        </Show>
        <a class="tv-link" href="/screen" target="_blank" rel="noopener">
          <TvIcon />
          <span class="tv-link-label">Modo TV</span>
        </a>
      </div>
    </header>
  );
}
