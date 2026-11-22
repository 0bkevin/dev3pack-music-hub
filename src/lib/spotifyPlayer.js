import { createSignal, createEffect, onMount, onCleanup } from 'solid-js';

async function fetchHostToken() {
  const res = await fetch('/api/spotify/token');
  if (!res.ok) return null;
  const data = await res.json();
  return data.accessToken || null;
}

export function createSpotifyHostPlayer({ host, onError }) {
  const [deviceId, setDeviceId] = createSignal(null);
  const [unlocked, setUnlocked] = createSignal(false);
  const [paused, setPaused] = createSignal(false);
  const [sdkReady, setSdkReady] = createSignal(Boolean(window._spSdkReady));

  let player = null;
  let initialized = false;

  createEffect(() => {
    if (initialized || !sdkReady() || !window.Spotify || !host()?.connected) return;
    initialized = true;

    player = new window.Spotify.Player({
      name: 'Dev3pack Music TV',
      getOAuthToken: async (cb) => {
        const token = await fetchHostToken();
        if (token) cb(token);
      },
      volume: 0.85,
    });

    player.addListener('ready', async ({ device_id }) => {
      setDeviceId(device_id);
      await fetch('/api/spotify/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: device_id }),
      });
    });

    player.addListener('not_ready', () => setDeviceId(null));
    player.addListener('player_state_changed', (s) => {
      if (s) setPaused(Boolean(s.paused));
    });
    player.addListener('initialization_error', ({ message }) => onError?.(`Spotify SDK: ${message}`, 4500));
    player.addListener('authentication_error', ({ message }) => onError?.(`Auth Spotify: ${message}`, 4500));
    player.addListener('account_error', () => onError?.('Se requiere Spotify Premium para reproducir audio', 5000));

    player.connect();
  });

  onMount(() => {
    const onSdk = () => setSdkReady(true);
    window.addEventListener('spotify-sdk-ready', onSdk);
    onCleanup(() => {
      window.removeEventListener('spotify-sdk-ready', onSdk);
      player?.disconnect?.();
    });
  });

  async function handleAction() {
    const h = host();
    if (!h?.configured) return;
    if (!h.connected) {
      location.href = '/api/spotify/login';
      return;
    }
    if (player) {
      if (typeof player.activateElement === 'function') {
        await player.activateElement().catch(() => {});
      }
      setUnlocked(true);
      if (deviceId()) {
        await fetch('/api/spotify/device', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: deviceId() }),
        });
      }
    }
  }

  const buttonLabel = () => {
    const h = host();
    if (!h?.connected) return 'Conectar Spotify Premium';
    if (unlocked() && deviceId()) return '🔊 Spotify conectado';
    if (deviceId()) return '🔊 Activar sonido';
    return 'Conectando reproductor…';
  };

  const isButtonSubtle = () => {
    const h = host();
    return Boolean(h?.connected && (!deviceId() || unlocked()));
  };

  return { paused, handleAction, buttonLabel, isButtonSubtle };
}
