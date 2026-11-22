import { createSignal, createEffect, createMemo, onMount, onCleanup, Show, For } from 'solid-js';
import { api } from '../lib/api.js';
import { isCommandSearchEvent, shortcutHint } from '../lib/shortcuts.js';
import { Cover } from './Cover.jsx';
import { SearchIcon } from './Icons.jsx';

const DEFAULT_QUERY = 'Electronic';

export function CommandSearch(props) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [tracks, setTracks] = createSignal([]);
  const [loading, setLoading] = createSignal(false);
  const [activeIdx, setActiveIdx] = createSignal(0);
  const [submittingId, setSubmittingId] = createSignal(null);

  let inputRef;
  let listRef;
  let searchTimer = null;
  let prevFocused = null;
  let requestSeq = 0;

  const queuedIds = createMemo(() => new Set((props.queue?.() || []).map((q) => q.track.id)));
  const currentId = () => props.currentTrackId?.() || null;

  async function runSearch(q) {
    const clean = q.trim() || DEFAULT_QUERY;
    const seq = ++requestSeq;
    setLoading(true);
    try {
      const { tracks: found } = await api(`/api/search?q=${encodeURIComponent(clean)}`);
      if (seq !== requestSeq) return;
      setTracks(found || []);
      setActiveIdx(0);
    } catch (err) {
      if (seq === requestSeq) props.onNotify?.(err.message, false);
    } finally {
      if (seq === requestSeq) setLoading(false);
    }
  }

  function openPalette() {
    prevFocused = document.activeElement;
    setOpen(true);
    setQuery('');
    setActiveIdx(0);
    runSearch('');
    queueMicrotask(() => inputRef?.focus());
  }

  function closePalette() {
    clearTimeout(searchTimer);
    setOpen(false);
    if (prevFocused && typeof prevFocused.focus === 'function') {
      prevFocused.focus();
    }
  }

  function handleQueryInput(val) {
    setQuery(val);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(val), 200);
  }

  async function propose(track) {
    if (!track || submittingId()) return;
    if (currentId() === track.id || queuedIds().has(track.id)) return;
    setSubmittingId(track.id);
    try {
      const ok = await props.onEnqueue(track);
      if (ok !== false) closePalette();
    } finally {
      setSubmittingId(null);
    }
  }

  createEffect(() => {
    const idx = activeIdx();
    if (!open() || !listRef) return;
    const row = listRef.children[idx];
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  });

  function handleInputKeyDown(e) {
    const list = tracks();
    if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
      return;
    }
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key.toLowerCase() === 'n')) {
      e.preventDefault();
      if (list.length) setActiveIdx((i) => (i + 1) % list.length);
      return;
    }
    if (e.key === 'ArrowUp' || (e.ctrlKey && e.key.toLowerCase() === 'p')) {
      e.preventDefault();
      if (list.length) setActiveIdx((i) => (i - 1 + list.length) % list.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const picked = list[activeIdx()];
      if (picked) propose(picked);
    }
  }

  onMount(() => {
    const onGlobalKeyDown = (e) => {
      if (isCommandSearchEvent(e)) {
        e.preventDefault();
        e.stopPropagation();
        if (open()) closePalette();
        else openPalette();
        return;
      }
      if (e.key === 'Escape' && open()) {
        e.preventDefault();
        closePalette();
      }
    };

    window.addEventListener('keydown', onGlobalKeyDown, { capture: true });
    onCleanup(() => {
      window.removeEventListener('keydown', onGlobalKeyDown, { capture: true });
      clearTimeout(searchTimer);
    });
  });

  return (
    <Show when={open()}>
      <div
        class="cmd-backdrop"
        id="cmd-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) closePalette();
        }}
      >
        <div
          class="cmd-dialog"
          id="cmd-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Buscar y proponer canción"
        >
          <div class="cmd-input-row">
            <span class="cmd-search-icon">
              <SearchIcon />
            </span>
            <input
              ref={(el) => { inputRef = el; }}
              class="cmd-input"
              id="cmd-input"
              value={query()}
              onInput={(e) => handleQueryInput(e.currentTarget.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Buscar canción o artista para proponer…"
              autocomplete="off"
              spellcheck={false}
            />
            <Show when={query().length > 0}>
              <button
                class="cmd-clear"
                type="button"
                aria-label="Limpiar búsqueda"
                onClick={() => {
                  setQuery('');
                  runSearch('');
                  inputRef?.focus();
                }}
              >
                ×
              </button>
            </Show>
            <kbd class="cmd-kbd">Esc</kbd>
          </div>

          <div class="cmd-list" id="cmd-list" ref={(el) => { listRef = el; }} role="listbox">
            <Show
              when={tracks().length > 0}
              fallback={
                <div class="cmd-empty">
                  {loading() ? 'Buscando canciones…' : 'No encontramos canciones para esa búsqueda.'}
                </div>
              }
            >
              <For each={tracks()}>
                {(track, idx) => {
                  const isPlaying = () => currentId() === track.id;
                  const isQueued = () => queuedIds().has(track.id);
                  const isDisabled = () => isPlaying() || isQueued() || submittingId() === track.id;
                  const isSelected = () => activeIdx() === idx();

                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected()}
                      class={`cmd-row${isSelected() ? ' selected' : ''}${isDisabled() ? ' muted' : ''}`}
                      onMouseEnter={() => setActiveIdx(idx())}
                      onClick={() => propose(track)}
                    >
                      <Cover track={track} class="cmd-art" />
                      <span class="cmd-text">
                        <span class="cmd-title">{track.name}</span>
                        <span class="cmd-sep">—</span>
                        <span class="cmd-artist">{track.artists}</span>
                      </span>
                      <span class="cmd-action">
                        {isPlaying()
                          ? 'Sonando'
                          : isQueued()
                            ? '✓ En cola'
                            : isSelected()
                              ? '↵ Proponer'
                              : '+ Cola'}
                      </span>
                    </button>
                  );
                }}
              </For>
            </Show>
          </div>

          <div class="cmd-footer">
            <span>
              <kbd class="cmd-kbd-sm">↑↓</kbd> navegar
            </span>
            <span>
              <kbd class="cmd-kbd-sm">↵</kbd> agregar a la cola
            </span>
            <span class="cmd-footer-right">
              <kbd class="cmd-kbd-sm">{shortcutHint()}</kbd> abrir / cerrar
            </span>
          </div>
        </div>
      </div>
    </Show>
  );
}
