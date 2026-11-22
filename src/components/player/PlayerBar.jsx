import { Show } from 'solid-js';
import { fmtMs } from '../../lib/api.js';
import { Cover } from '../Cover.jsx';
import { Equalizer } from '../Icons.jsx';

export function PlayerBar(props) {
  return (
    <footer class="player-bar">
      <div class="pb-track">
        <Cover track={props.current()?.track} class="pb-art" />
        <div class="pb-meta">
          <div class="pb-title">{props.current()?.track?.name || 'Sin reproducción'}</div>
          <div class="pb-artist">
            {props.current()?.track?.artists || 'Agrega una canción para empezar'}
          </div>
        </div>
      </div>

      <div class="pb-center">
        <div class="pb-status">
          <Show when={props.current()}>
            <Equalizer />
          </Show>
          <span>
            {props.current() ? `Pedida por ${props.current().addedBy}` : 'Esperando música'}
          </span>
        </div>
        <div class="pb-progress-row">
          <span class="pb-time">{fmtMs(props.elapsedMs())}</span>
          <div class="progress-track">
            <i
              class="progress-fill"
              style={{ transform: `scaleX(${props.progressPct() / 100})` }}
            />
          </div>
          <span class="pb-time end">
            {props.current() ? fmtMs(props.totalMs()) : '0:00'}
          </span>
        </div>
      </div>

      <div class="pb-right">
        <button
          class={`pb-vote like${props.myVote() === 1 ? ' active' : ''}`}
          id="pb-like-btn"
          type="button"
          aria-label="Me gusta"
          onClick={() => props.onVote(1)}
        >
          <span>👍</span>
          <span class="tabular">{props.likes()}</span>
        </button>
        <button
          class={`pb-vote dislike${props.myVote() === -1 ? ' active' : ''}`}
          id="pb-dislike-btn"
          type="button"
          aria-label="No me gusta"
          onClick={() => props.onVote(-1)}
        >
          <span>👎</span>
          <span class="tabular">{props.dislikes()}</span>
        </button>
        <span class="provider-tag">{(props.provider() || '').toUpperCase()}</span>
      </div>
    </footer>
  );
}
