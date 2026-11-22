import { Show, For } from 'solid-js';
import { Equalizer, MusicNoteIcon } from '../Icons.jsx';

export const USER_EMOJIS = [
  '🎧', '🔥', '⚡', '🎸', '🎹', '🚀', '👾', '🦊',
  '🪩', '🌊', '💜', '🎵', '🥁', '🌙', '🎤', '✨',
];

export function JoinOverlay(props) {
  return (
    <Show when={props.visible()}>
      <div class="join-overlay" id="join-overlay">
        <div class="join-sheet">
          <div class="join-head">
            <div class="join-mark">
              <Show
                when={props.selectedEmoji()}
                fallback={<MusicNoteIcon size={22} strokeWidth={2.2} />}
              >
                <span class="join-mark-emoji">{props.selectedEmoji()}</span>
              </Show>
            </div>
            <h1>Dev3pack Music</h1>
            <p>Elige un emoji y tu nombre para pedir canciones, o entra como anónimo.</p>
          </div>

          <Show when={props.current()}>
            <div class="join-live-pill">
              <Equalizer />
              <span>
                Sonando <b>{props.current().track.name}</b> · {props.current().track.artists}
              </span>
            </div>
          </Show>

          <div class="emoji-picker" role="radiogroup" aria-label="Elige tu emoji">
            <For each={USER_EMOJIS}>
              {(em) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={props.selectedEmoji() === em}
                  class={`emoji-opt${props.selectedEmoji() === em ? ' active' : ''}`}
                  onClick={() => props.onSelectEmoji(em)}
                >
                  {em}
                </button>
              )}
            </For>
          </div>

          <input
            ref={props.inputRef}
            class="join-input"
            id="name-input"
            maxLength={24}
            value={props.nameInput()}
            onInput={(e) => props.onNameInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                props.onJoin(props.nameInput() || undefined, props.selectedEmoji());
              }
            }}
            placeholder="Tu nombre o alias"
            autocomplete="off"
          />

          <div class="join-btns">
            <button
              class="btn-primary"
              id="join-btn"
              type="button"
              onClick={() => props.onJoin(props.nameInput() || undefined, props.selectedEmoji())}
            >
              Entrar a escuchar
            </button>
            <button
              class="btn-subtle"
              id="anon-btn"
              type="button"
              onClick={() => props.onJoin(undefined, undefined)}
            >
              Entrar como anónimo (emoji aleatorio)
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
