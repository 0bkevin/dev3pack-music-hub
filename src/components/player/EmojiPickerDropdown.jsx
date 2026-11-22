import { createSignal, createMemo, onMount, onCleanup, Show, For } from 'solid-js';
import { searchEmojis, extractSingleEmoji } from '../../lib/emojis.js';
import { ChevronDownIcon, SearchIcon } from '../Icons.jsx';

export function EmojiPickerDropdown(props) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');

  let wrapRef;
  let searchRef;

  const filtered = createMemo(() => searchEmojis(query()));
  const customEmoji = createMemo(() => extractSingleEmoji(query()));

  function toggle() {
    const next = !open();
    setOpen(next);
    if (next) {
      setQuery('');
      queueMicrotask(() => searchRef?.focus());
    }
  }

  function pick(emoji) {
    props.onSelect(emoji);
    setOpen(false);
    setQuery('');
  }

  onMount(() => {
    const onDocPointerDown = (e) => {
      if (open() && wrapRef && !wrapRef.contains(e.target)) {
        setOpen(false);
      }
    };
    const onDocKeyDown = (e) => {
      if (open() && e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onDocKeyDown);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onDocKeyDown);
    });
  });

  return (
    <div class="emoji-dd-wrap" ref={(el) => { wrapRef = el; }}>
      <button
        type="button"
        class={`emoji-dd-trigger${open() ? ' open' : ''}`}
        id="emoji-trigger"
        aria-haspopup="listbox"
        aria-expanded={open()}
        title="Elegir emoji"
        onClick={toggle}
      >
        <span class="emoji-dd-val">{props.value()}</span>
        <span class="emoji-dd-caret" aria-hidden="true">
          <ChevronDownIcon size={13} strokeWidth={2.2} />
        </span>
      </button>

      <Show when={open()}>
        <div class="emoji-dd-menu" id="emoji-dd-menu" role="dialog" aria-label="Selector de emojis">
          <div class="emoji-dd-search-row">
            <span class="emoji-dd-search-icon">
              <SearchIcon />
            </span>
            <input
              ref={(el) => { searchRef = el; }}
              class="emoji-dd-search"
              id="emoji-search"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && filtered().length > 0) {
                  e.preventDefault();
                  pick(filtered()[0]);
                }
              }}
              placeholder="Buscar emoji…"
              autocomplete="off"
            />
          </div>

          <Show when={customEmoji()}>
            <button
              type="button"
              class="emoji-dd-custom"
              onClick={() => pick(customEmoji())}
            >
              <span>Usar {customEmoji()}</span>
              <span class="emoji-dd-custom-hint">↵</span>
            </button>
          </Show>

          <div class="emoji-dd-grid" role="listbox">
            <Show
              when={filtered().length > 0}
              fallback={<div class="emoji-dd-empty">Sin resultados</div>}
            >
              <For each={filtered()}>
                {(em) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={props.value() === em}
                    class={`emoji-dd-item${props.value() === em ? ' active' : ''}`}
                    onClick={() => pick(em)}
                  >
                    {em}
                  </button>
                )}
              </For>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
