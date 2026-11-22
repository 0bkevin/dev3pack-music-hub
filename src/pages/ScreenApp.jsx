import { createSignal, createEffect, createMemo, onMount, onCleanup, Show, For } from 'solid-js';
import { fmtMs, hashCode } from '../lib/api.js';
import { createRoom } from '../lib/room.js';
import { createSpotifyHostPlayer } from '../lib/spotifyPlayer.js';
import { Cover } from '../components/Cover.jsx';
import { Equalizer } from '../components/Icons.jsx';
import { WavesCanvas } from '../components/WavesCanvas.jsx';

const SPOTIFY_ERROR_MESSAGES = {
  auth_denied: 'Autenticación con Spotify cancelada.',
  invalid_callback: 'Respuesta de Spotify inválida.',
  state_invalid: 'Sesión OAuth expirada. Intenta conectar de nuevo.',
  exchange_failed: 'No se pudo completar la conexión con Spotify.',
};

export function ScreenApp() {
  const [reactions, setReactions] = createSignal([]);
  const [banner, setBanner] = createSignal({ text: '', visible: false });

  let bannerTimer = null;
  let lastSeenTrackId = null;
  let reactionSeq = 0;
  let wavePulse = 0;
  const reactionTimers = new Set();

  function showBanner(text, ms = 3200) {
    setBanner({ text, visible: true });
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => setBanner((b) => ({ ...b, visible: false })), ms);
  }

  function spawnReaction(msg) {
    if (!msg.vote) return;
    wavePulse = Math.min(1.4, wavePulse + 0.55);
    const id = ++reactionSeq;
    const item = {
      id,
      vote: msg.vote,
      left: `${14 + Math.random() * 64}%`,
      top: `${62 + Math.random() * 12}%`,
      driftX: `${(Math.random() - 0.5) * 44}px`,
    };
    setReactions((prev) => [...prev.slice(-15), item]);
    const t = setTimeout(() => {
      reactionTimers.delete(t);
      setReactions((prev) => prev.filter((r) => r.id !== id));
    }, 2650);
    reactionTimers.add(t);
  }

  const room = createRoom({ onReaction: spawnReaction });

  const current = () => room.state()?.current || null;
  const queue = () => room.state()?.queue || [];
  const host = () => room.state()?.spotifyHost || null;
  const dislikesToSkip = () => room.state()?.dislikesToSkip || 5;
  const dislikes = () => room.state()?.dislikes || 0;
  const likes = () => room.state()?.likes || 0;

  const spotify = createSpotifyHostPlayer({ host, onError: showBanner });

  const waveHue = createMemo(() => {
    const t = current()?.track;
    return t ? 334 + (hashCode(t.id) % 26) : 344;
  });

  const waveBpm = createMemo(() => {
    const t = current()?.track;
    return t ? 94 + (hashCode(t.id) % 38) : 112;
  });

  const waveEnergy = () => {
    if (!current()) return 0.34;
    return spotify.paused() ? 0.25 : 1.0;
  };

  function consumePulse() {
    const val = wavePulse;
    wavePulse *= 0.94;
    return val;
  }

  createEffect(() => {
    const cur = current();
    if (!cur) {
      lastSeenTrackId = null;
      return;
    }
    if (lastSeenTrackId && lastSeenTrackId !== cur.track.id && cur.reason === 'skipped') {
      showBanner(`⏭ «${cur.skippedTrack || 'Canción'}» fue saltada por votos`, 2800);
    }
    lastSeenTrackId = cur.track.id;
  });

  onMount(() => {
    const params = new URLSearchParams(location.search);
    const errCode = params.get('spotify_error');
    if (errCode) {
      showBanner(SPOTIFY_ERROR_MESSAGES[errCode] || 'No se pudo conectar Spotify.', 5500);
      history.replaceState({}, '', '/screen');
    }

    onCleanup(() => {
      clearTimeout(bannerTimer);
      for (const t of reactionTimers) clearTimeout(t);
      reactionTimers.clear();
    });
  });

  const skipDotIndexes = createMemo(() => Array.from({ length: dislikesToSkip() }, (_, i) => i));

  return (
    <div class={`tv-screen${current() ? ' playing' : ''}`} id="tv-screen">
      <div class="tv-svg-bg" aria-hidden="true" />
      <div class="tv-vignette" />
      <WavesCanvas
        targetEnergy={waveEnergy}
        hue={waveHue}
        bpm={waveBpm}
        consumePulse={consumePulse}
      />

      <Show when={!current()}>
        <div class="tv-idle" id="idle">
          <div class="tv-idle-bar">
            <i class="live-dot" />
            <span>Esperando música · Entra desde tu celular o laptop para agregar una canción</span>
            <Show when={host()?.configured && !host()?.connected}>
              <a class="tv-audio-btn" href="/api/spotify/login">
                Conectar Spotify
              </a>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={current()}>
        <div class="tv-layout" id="grid">
          <aside class="tv-queue">
            <div class="tv-queue-head">
              <h2>Siguiente</h2>
              <span>{queue().length}</span>
            </div>
            <Show
              when={queue().length > 0}
              fallback={<div class="tv-empty">Cola vacía — siguiente aleatoria</div>}
            >
              <div class="tv-queue-list">
                <For each={queue()}>
                  {(item) => (
                    <div class="tv-q-item">
                      <Cover track={item.track} />
                      <div class="tv-q-meta">
                        <div class="tv-q-name">{item.track.name}</div>
                        <div class="tv-q-artist">{item.track.artists}</div>
                        <div class="tv-q-by">por {item.addedBy}</div>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </aside>

          <footer class="tv-dock">
            <div class="tv-progress-wrap">
              <span class="tv-time">{fmtMs(room.elapsedMs())}</span>
              <div class="tv-progress">
                <i style={{ transform: `scaleX(${room.progressPct() / 100})` }} />
              </div>
              <span class="tv-time end">{fmtMs(room.totalMs())}</span>
            </div>

            <div class="tv-dock-row">
              <div class="tv-now">
                <Cover track={current().track} class="tv-cover-sm" />
                <div class="tv-now-meta">
                  <div class="tv-now-title">{current().track.name}</div>
                  <div class="tv-now-sub">
                    <Equalizer />
                    <span>{current().track.artists}</span>
                    <span>·</span>
                    <span class="tv-now-by">Pedida por {current().addedBy}</span>
                  </div>
                </div>
              </div>

              <div class="tv-dock-right">
                <div class="tv-votes">
                  <span class="tv-vote-pill like">👍 {likes()}</span>
                  <span class="tv-vote-pill dislike">👎 {dislikes()}</span>
                  <span class="tv-skip-note">
                    <span class="skip-dots">
                      <For each={skipDotIndexes()}>
                        {(i) => <i class={i < dislikes() ? 'on' : ''} />}
                      </For>
                    </span>
                    <span>
                      {dislikes()}/{dislikesToSkip()} para saltar
                    </span>
                  </span>
                </div>

                <Show when={host()?.configured}>
                  <button
                    class={`tv-audio-btn${spotify.isButtonSubtle() ? ' on' : ''}`}
                    type="button"
                    onClick={spotify.handleAction}
                  >
                    {spotify.buttonLabel()}
                  </button>
                </Show>
              </div>
            </div>
          </footer>
        </div>
      </Show>

      <div class={`tv-skip-banner${banner().visible ? ' show' : ''}`} id="skipped">
        {banner().text}
      </div>

      <div class="fx-layer" id="fx">
        <For each={reactions()}>
          {(rx) => (
            <div
              class={`fx-burst ${rx.vote === 1 ? 'like' : 'dislike'}`}
              style={{
                left: rx.left,
                top: rx.top,
                '--drift-x': rx.driftX,
              }}
            >
              {rx.vote === 1 ? '👍' : '👎'}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
