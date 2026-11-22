import { Show } from 'solid-js';
import { DEFAULT_EMOJIS } from '../../lib/emojis.js';
import { Equalizer } from '../Icons.jsx';
import { EmojiPickerDropdown } from './EmojiPickerDropdown.jsx';

export const USER_EMOJIS = DEFAULT_EMOJIS;

export function JoinOverlay(props) {
  return (
    <Show when={props.visible()}>
      <div class="join-overlay" id="join-overlay">
        <div class="join-sheet">
          <div class="join-head">
            <img
              class="join-logo"
              src="/dev3pack-backpack.png"
              alt="Dev3pack"
              width="96"
              height="96"
            />
            <h1>Dev3pack Music</h1>
          </div>

          <Show when={props.current()}>
            <div class="join-live-pill">
              <Equalizer />
              <span>
                Sonando <b>{props.current().track.name}</b> · {props.current().track.artists}
              </span>
            </div>
          </Show>

          <div class="join-identity-row">
            <EmojiPickerDropdown
              value={props.selectedEmoji}
              onSelect={props.onSelectEmoji}
            />
            <input
              ref={props.inputRef}
              class={`join-input${props.error?.() ? ' has-error' : ''}`}
              id="name-input"
              maxLength={20}
              value={props.nameInput()}
              onInput={(e) => props.onNameInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  props.onJoin(props.nameInput() || undefined, props.selectedEmoji());
                }
              }}
              placeholder="Ej. Kevin Bravo"
              autocomplete="off"
              aria-invalid={Boolean(props.error?.())}
            />
          </div>

          <Show when={props.error?.()}>
            <p class="join-error" id="join-error" role="alert">
              {props.error()}
            </p>
          </Show>

          <div class="join-btns">
            <button
              class="btn-primary"
              id="join-btn"
              type="button"
              disabled={props.joining?.()}
              onClick={() => props.onJoin(props.nameInput() || undefined, props.selectedEmoji())}
            >
              Entrar
            </button>
            <button
              class="btn-subtle"
              id="anon-btn"
              type="button"
              disabled={props.joining?.()}
              onClick={() => props.onJoin(undefined, undefined)}
            >
              Entrar como anónimo
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
