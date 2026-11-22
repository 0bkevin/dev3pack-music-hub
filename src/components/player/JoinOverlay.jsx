import { Show } from 'solid-js';
import { Equalizer, MusicNoteIcon } from '../Icons.jsx';

export function JoinOverlay(props) {
  return (
    <Show when={props.visible()}>
      <div class="join-overlay" id="join-overlay">
        <div class="join-sheet">
          <div class="join-head">
            <div class="join-mark">
              <MusicNoteIcon size={22} strokeWidth={2.2} />
            </div>
            <h1>Dev3pack Music</h1>
            <p>Pon tu nombre para pedir canciones y votar lo que suena, o entra como anónimo.</p>
          </div>

          <Show when={props.current()}>
            <div class="join-live-pill">
              <Equalizer />
              <span>
                Sonando <b>{props.current().track.name}</b> · {props.current().track.artists}
              </span>
            </div>
          </Show>

          <input
            ref={props.inputRef}
            class="join-input"
            id="name-input"
            maxLength={24}
            value={props.nameInput()}
            onInput={(e) => props.onNameInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onJoin(props.nameInput() || undefined);
            }}
            placeholder="Tu nombre o alias"
            autocomplete="off"
          />

          <div class="join-btns">
            <button
              class="btn-primary"
              id="join-btn"
              type="button"
              onClick={() => props.onJoin(props.nameInput() || undefined)}
            >
              Entrar a escuchar
            </button>
            <button
              class="btn-subtle"
              id="anon-btn"
              type="button"
              onClick={() => props.onJoin(undefined)}
            >
              Entrar como anónimo
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
