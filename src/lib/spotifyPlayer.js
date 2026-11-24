import { createSignal, createMemo, createEffect, onMount, onCleanup } from 'solid-js';
import { api } from './api.js';

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
  const [isHost, setIsHost] = createSignal(null);
  const [retry, setRetry] = createSignal(0);

  let player = null;
  let deviceGen = null;
  let regSeq = 0;
  const configured = createMemo(() => Boolean(host()?.configured));
  const connected = createMemo(() => Boolean(host()?.connected));

  createEffect(() => {
    if (connected() && host()?.deviceReady === false && unlocked()) {
      setUnlocked(false);
    }
  });

  createEffect(() => {
    retry();
    setIsHost(null);
    if (!connected()) return;
    const request = new AbortController();
    onCleanup(() => request.abort());
    api('/api/spotify/status', { signal: request.signal }).then(({ isHost }) => {
      if (!request.signal.aborted) setIsHost(Boolean(isHost));
    }).catch(() => {
      if (!request.signal.aborted) onError?.('No se pudo verificar la sesión de Spotify.', 5000);
    });
  });

  function registerDevice(id) {
    return api('/api/spotify/device', {
      method: 'POST',
      body: JSON.stringify({ deviceId: id }),
    });
  }

  createEffect(() => {
    if (!connected() || !isHost() || !sdkReady() || !window.Spotify) return;
    const activePlayer = new window.Spotify.Player({
      name: 'Dev3pack Music TV',
      getOAuthToken: async (cb) => {
        const token = await fetchHostToken().catch(() => null);
        if (player !== activePlayer) return;
        if (token) cb(token);
        else onError?.('Sesión de Spotify del host expirada. Reconecta desde este dispositivo.', 5000);
      },
      volume: 0.85,
    });

    player = activePlayer;
    player.addListener('ready', async ({ device_id }) => {
      const seq = ++regSeq;
      try {
        const res = await registerDevice(device_id);
        if (player === activePlayer && seq === regSeq) {
          deviceGen = res?.deviceGeneration ?? null;
          setDeviceId(device_id);
          if (res?.playback && !res.playback.ok && res.playback.status) {
            onError?.(`Spotify no pudo iniciar reproducción (${res.playback.status}). Haz clic en Activar sonido.`, 5000);
          }
        }
      } catch {
        if (player === activePlayer && seq === regSeq) {
          onError?.('No se pudo registrar el reproductor de Spotify.', 5000);
        }
      }
    });

    player.addListener('not_ready', ({ device_id } = {}) => {
      if (player !== activePlayer) return;
      const staleId = device_id || deviceId();
      const staleGen = deviceGen;
      if (!device_id || deviceId() === device_id) {
        ++regSeq;
        deviceGen = null;
        setDeviceId(null);
        setUnlocked(false);
      }
      const params = new URLSearchParams();
      if (staleId) params.set('deviceId', staleId);
      if (staleGen !== null && staleGen !== undefined) params.set('gen', String(staleGen));
      const qs = params.toString();
      fetch(qs ? `/api/spotify/device?${qs}` : '/api/spotify/device', { method: 'DELETE' }).catch(() => {});
      onError?.('Reproductor de Spotify desconectado temporalmente.', 4500);
    });
    player.addListener('player_state_changed', (s) => {
      if (s) setPaused(Boolean(s.paused));
    });
    player.addListener('initialization_error', ({ message }) => onError?.(`Spotify SDK: ${message}`, 4500));
    player.addListener('authentication_error', ({ message }) => onError?.(`Auth Spotify: ${message}`, 4500));
    player.addListener('account_error', () => onError?.('Se requiere Spotify Premium para reproducir audio', 5000));

    Promise.resolve(player.connect()).then((ok) => {
      if (ok === false && player === activePlayer) onError?.('No se pudo iniciar el reproductor de Spotify.', 5000);
    }).catch(() => {
      if (player === activePlayer) onError?.('No se pudo iniciar el reproductor de Spotify.', 5000);
    });
    onCleanup(() => {
      player = null;
      activePlayer.disconnect();
      setDeviceId(null);
      setUnlocked(false);
      setPaused(false);
    });
  });

  onMount(() => {
    const onSdk = () => setSdkReady(true);
    window.addEventListener('spotify-sdk-ready', onSdk);
    onCleanup(() => {
      window.removeEventListener('spotify-sdk-ready', onSdk);
    });
  });

  async function handleAction() {
    if (!configured()) return;
    if (!connected()) {
      location.href = '/api/spotify/login';
      return;
    }
    if (isHost() === false || unlocked()) return;
    if (!player || !deviceId()) {
      setRetry((count) => count + 1);
      return;
    }
    const activeId = deviceId();
    const seq = ++regSeq;
    try {
      await player.activateElement?.();
      const res = await registerDevice(activeId);
      if (seq !== regSeq || deviceId() !== activeId) return;
      deviceGen = res?.deviceGeneration ?? deviceGen;
      if (res?.playback && !res.playback.ok && res.playback.status) {
        onError?.(`No se pudo iniciar reproducción en Spotify (${res.playback.status}). Intenta de nuevo.`, 5000);
        return;
      }
      setUnlocked(true);
    } catch {
      if (seq === regSeq) {
        onError?.('No se pudo activar el sonido. Intenta de nuevo.', 5000);
      }
    }
  }

  const buttonLabel = () => {
    if (!connected()) return 'Conectar Spotify Premium';
    if (isHost() === false) return 'Spotify conectado en otra pantalla';
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
