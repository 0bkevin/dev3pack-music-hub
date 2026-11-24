import { createSignal, createEffect, createMemo, onMount, onCleanup, Show, For } from 'solid-js';
import { api } from '../lib/api.js';
import { isCommandSearchEvent, shortcutHint } from '../lib/shortcuts.js';
import { Cover } from './Cover.jsx';
import { CheckIcon, PlusIcon, SearchIcon } from './Icons.jsx';

const DEFAULT_QUERY = 'Electronic';

export function CommandSearch(props) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [tracks, setTracks] = createSignal([]);
  const [loading, setLoading] = createSignal(false);
  const [activeIdx, setActiveIdx] = createSignal(0);
  const [submittingId, setSubmittingId] = createSignal(null);

  let inputRef;
  let dialogRef;
  let listRef;
  let searchTimer = null;
  let prevFocused = null;
  let searchRequest = null;

  const queuedIds = createMemo(() => new Set((props.queue?.() || []).map((q) => q.track.id)));
  const currentId = () => props.currentTrackId?.() || null;
  const isTrackUnavailable = (track) =>
    !track || currentId() === track.id || queuedIds().has(track.id) || submittingId() === track.id;

  function findNextActionableIndex(list, start, step) {
    if (!list.length) return 0;
    for (let i = 0; i < list.length; i++) {
      const idx = (start + step * i + list.length) % list.length;
      if (!isTrackUnavailable(list[idx])) return idx;
    }
    return Math.min(Math.max(0, start), list.length - 1);
  }

  async function runSearch(q) {
    const clean = q.trim() || DEFAULT_QUERY;
    searchRequest?.abort();
    const request = new AbortController();
    searchRequest = request;
    setLoading(true);
    try {
      const { tracks: found } = await api(`/api/search?q=${encodeURIComponent(clean)}`, { signal: request.signal });
      if (request.signal.aborted) return;
      const list = found || [];
      setTracks(list);
      setActiveIdx(findNextActionableIndex(list, 0, 1));
    } catch (err) {
      if (!request.signal.aborted) {
        setTracks([]);
        props.onNotify?.(err.message, false);
      }
    } finally {
      if (!request.signal.aborted) setLoading(false);
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
    searchRequest?.abort();
    setOpen(false);
    if (prevFocused && typeof prevFocused.focus === 'function') {
      prevFocused.focus();
    }
  }

  function handleQueryInput(val) {
    setQuery(val);
    clearTimeout(searchTimer);
    searchRequest?.abort();
    setLoading(true);
    searchTimer = setTimeout(() => runSearch(val), 200);
  }

  async function propose(track) {
    if (!track || loading() || submittingId()) return;
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
      if (list.length) setActiveIdx((i) => findNextActionableIndex(list, (i + 1) % list.length, 1));
      return;
    }
    if (e.key === 'ArrowUp' || (e.ctrlKey && e.key.toLowerCase() === 'p')) {
      e.preventDefault();
      if (list.length) setActiveIdx((i) => findNextActionableIndex(list, (i - 1 + list.length) % list.length, -1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const picked = list[activeIdx()];
      if (picked) propose(picked);
    }
  }

  function keepFocusInDialog(event) {
    if (event.key !== 'Tab') return;
    const controls = dialogRef.querySelectorAll('input:not([disabled]), button:not([disabled])');
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  onMount(() => {
    const onGlobalKeyDown = (e) => {
      if (props.disabled?.()) {
        if (open()) closePalette();
        return;
      }
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
      searchRequest?.abort();
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
          ref={dialogRef}
          class="cmd-dialog"
          id="cmd-dialog"
          role="dialog"
          aria-modal="true"
          onKeyDown={keepFocusInDialog}
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
              placeholder="Buscar canción o artista…"
              autocomplete="off"
              spellcheck={false}
            />
            <Show when={query().length > 0}>
              <button
                class="cmd-clear"
                type="button"
                aria-label="Limpiar búsqueda"
                onClick={() => {
                  clearTimeout(searchTimer);
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
              when={!loading() && tracks().length > 0}
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
                      aria-disabled={isDisabled() ? 'true' : undefined}
                      tabIndex={isDisabled() ? -1 : 0}
                      class={`cmd-row${isSelected() ? ' selected' : ''}${isDisabled() ? ' muted' : ''}`}
                      onMouseEnter={() => { if (!isDisabled()) setActiveIdx(idx()); }}
                      onClick={() => propose(track)}
                    >
                      <Cover track={track} class="cmd-art" />
                      <span class="cmd-text">
                        <span class="cmd-title">{track.name}</span>
                        <span class="cmd-sep">—</span>
                        <span class="cmd-artist">{track.artists}</span>
                      </span>
                      <span class="cmd-action">
                        <Show
                          when={!isPlaying()}
                          fallback={<span>Sonando</span>}
                        >
                          <Show
                            when={!isQueued()}
                            fallback={
                              <>
                                <CheckIcon size={11} />
                                <span>En cola</span>
                              </>
                            }
                          >
                            <Show
                              when={isSelected()}
                              fallback={
                                <>
                                  <PlusIcon size={11} />
                                  <span>Agregar</span>
                                </>
                              }
                            >
                              <span>↵ Proponer</span>
                            </Show>
                          </Show>
                        </Show>
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
