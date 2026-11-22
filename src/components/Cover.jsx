import { Show } from 'solid-js';
import { trackGradient } from '../lib/api.js';
import { MusicNoteIcon } from './Icons.jsx';

export function Cover(props) {
  return (
    <Show
      when={props.track?.imageUrl}
      fallback={
        <div
          class={`${props.class || 'track-art'} cover-ph${props.placeholder ? ' placeholder' : ''}`}
          style={props.track ? { background: trackGradient(props.track) } : undefined}
        >
          <Show when={props.showIcon}>
            <MusicNoteIcon size={props.iconSize || 44} strokeWidth={1.5} />
          </Show>
        </div>
      }
    >
      <img
        class={props.class || 'track-art'}
        src={props.track.imageUrl}
        alt=""
        loading="lazy"
      />
    </Show>
  );
}
