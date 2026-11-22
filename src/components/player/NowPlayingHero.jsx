import { Show, For } from 'solid-js';
import { trackGradient } from '../../lib/api.js';
import { Cover } from '../Cover.jsx';
import { Equalizer } from '../Icons.jsx';

export function NowPlayingHero(props) {
  const glowStyle = () => {
    const t = props.current()?.track;
    if (!t) return undefined;
    return t.imageUrl
      ? { 'background-image': `url("${t.imageUrl}")` }
      : { background: trackGradient(t) };
  };

  return (
    <section class="hero-stage">
      <div class="stage-cover-wrap">
        <Show when={props.current()?.track}>
          <div class="stage-cover-glow" style={glowStyle()} aria-hidden="true" />
        </Show>
        <Cover
          track={props.current()?.track}
          class="stage-cover"
          placeholder={!props.current()?.track?.imageUrl}
          showIcon={!props.current()?.track?.imageUrl}
          iconSize={44}
        />
      </div>

      <div class="stage-meta">
        <div class="stage-status">
          <Show when={props.current()}>
            <Equalizer />
          </Show>
          <span>{props.current() ? 'Sonando ahora' : 'Sala lista'}</span>
          <Show when={props.current()}>
            <span class="dot-sep">·</span>
            <span class="requester">
              Pedida por {props.current().addedByEmoji ? `${props.current().addedByEmoji} ` : ''}
              {props.current().addedBy}
            </span>
          </Show>
        </div>

        <h1 class="stage-title">
          {props.current()?.track?.name || 'Pon la primera canción'}
        </h1>
        <div class="stage-artist">
          {props.current()?.track?.artists || 'Busca cualquier artista o elige una sugerencia abajo'}
        </div>

        <div class="stage-actions">
          <button
            class={`react-pill like${props.myVote() === 1 ? ' active' : ''}`}
            id="like-btn"
            type="button"
            onClick={() => props.onVote(1)}
          >
            <span class="emoji">👍</span>
            <span>Me gusta</span>
            <span class="count">{props.likes()}</span>
          </button>
          <button
            class={`react-pill dislike${props.myVote() === -1 ? ' active' : ''}`}
            id="dislike-btn"
            type="button"
            onClick={() => props.onVote(-1)}
          >
            <span class="emoji">👎</span>
            <span>No me gusta</span>
            <span class="count">{props.dislikes()}</span>
          </button>
          <div class="skip-status">
            <span class="skip-dots">
              <For each={props.skipDotIndexes()}>
                {(i) => <i class={i < props.dislikes() ? 'on' : ''} />}
              </For>
            </span>
            <span>
              {props.dislikes()}/{props.dislikesToSkip()} para saltar
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
