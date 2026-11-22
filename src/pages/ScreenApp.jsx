import { createSignal, createEffect, createMemo, onMount, onCleanup, Show, For } from 'solid-js';
import { fmtMs, hashCode } from '../lib/api.js';
import { createRoom } from '../lib/room.js';
import { Cover } from '../components/Cover.jsx';
import { Equalizer } from '../components/Icons.jsx';
import { WavesCanvas } from '../components/WavesCanvas.jsx';

export function ScreenApp() {
  const [reactions, setReactions] = createSignal([]);
  const [banner, setBanner] = createSignal({ text: '', visible: false });
  const [spDeviceId, setSpDeviceId] = createSignal(null);
  const [spUnlocked, setSpUnlocked] = createSignal(false);
  const [spPaused, setSpPaused] = createSignal(false);
  const [sdkReady, setSdkReady] = createSignal(Boolean(window._spSdkReady));

  let spPlayer = null;
  let spInitialized = false;
  let bannerTimer = null;
  let lastSeenTrackId = null;
  let reactionSeq = 0;
  let wavePulse = 0;

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
    setReactions((prev) => [...prev, item]);
    setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== id));
    }, 2650);
  }

  const room = createRoom({
    onReaction: spawnReaction,
  });

  const current = () => room.state()?.current || null;
  const queue = () => room.state()?.queue || [];
  const host = () => room.state()?.spotifyHost || null;
  const dislikesToSkip = () => room.state()?.dislikesToSkip || 5;
  const dislikes = () => room.state()?.dislikes || 0;
  const likes = () => room.state()?.likes || 0;

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
    return spPaused() ? 0.25 : 1.0;
  };

  function consumePulse() {
    const val = wavePulse;
    wavePulse *= 0.94;
    return val;
  }

  // Skip notification when a track changes due to votes
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

  // Spotify Web Playback SDK initialization
  async function fetchHostToken() {
    const res = await fetch('/api/spotify/token');
    if (!res.ok) return null;
    const data = await res.json();
    return data.accessToken || null;
  }

  createEffect(() => {
    if (spInitialized || !sdkReady() || !window.Spotify || !host()?.connected) return;
    spInitialized = true;

    spPlayer = new window.Spotify.Player({
      name: 'Dev3pack Music TV',
      getOAuthToken: async (cb) => {
        const token = await fetchHostToken();
        if (token) cb(token);
      },
      volume: 0.85,
    });

    spPlayer.addListener('ready', async ({ device_id }) => {
      setSpDeviceId(device_id);
      await fetch('/api/spotify/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: device_id }),
      });
    });

    spPlayer.addListener('not_ready', () => setSpDeviceId(null));
    spPlayer.addListener('player_state_changed', (s) => {
      if (s) setSpPaused(Boolean(s.paused));
    });
    spPlayer.addListener('initialization_error', ({ message }) => showBanner(`Spotify SDK: ${message}`, 4500));
    spPlayer.addListener('authentication_error', ({ message }) => showBanner(`Auth Spotify: ${message}`, 4500));
    spPlayer.addListener('account_error', () => showBanner('Se requiere Spotify Premium para reproducir audio', 5000));

    spPlayer.connect();
  });

  onMount(() => {
    const onSdk = () => setSdkReady(true);
    window.addEventListener('spotify-sdk-ready', onSdk);

    const params = new URLSearchParams(location.search);
    if (params.get('spotify_error')) {
      showBanner(`Spotify: ${params.get('spotify_error')}`, 5500);
      history.replaceState({}, '', '/screen');
    }

    onCleanup(() => {
      window.removeEventListener('spotify-sdk-ready', onSdk);
      clearTimeout(bannerTimer);
      spPlayer?.disconnect?.();
    });
  });

  async function handleSpotifyButton() {
    const h = host();
    if (!h?.configured) return;
    if (!h.connected) {
      location.href = '/api/spotify/login';
      return;
    }
    if (spPlayer) {
      if (typeof spPlayer.activateElement === 'function') {
        await spPlayer.activateElement().catch(() => {});
      }
      setSpUnlocked(true);
      if (spDeviceId()) {
        await fetch('/api/spotify/device', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: spDeviceId() }),
        });
      }
    }
  }

  const spotifyBtnLabel = () => {
    const h = host();
    if (!h?.connected) return 'Conectar Spotify Premium';
    if (spUnlocked() && spDeviceId()) return `🔊 Spotify · ${h.user || 'Conectado'}`;
    if (spDeviceId()) return '🔊 Activar sonido';
    return 'Conectando reproductor…';
  };

  const spotifyBtnSubtle = () => {
    const h = host();
    return Boolean(h?.connected && (!spDeviceId() || spUnlocked()));
  };

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
                      <Cover track={item.track} class="q-art" />
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
                <i style={{ width: `${room.progressPct()}%` }} />
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
                    class={`tv-audio-btn${spotifyBtnSubtle() ? ' on' : ''}`}
                    type="button"
                    onClick={handleSpotifyButton}
                  >
                    {spotifyBtnLabel()}
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
