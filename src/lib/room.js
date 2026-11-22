import { createSignal, createEffect, onCleanup } from 'solid-js';

export function createRoom({ clientId = () => null, onSessionExpired, onReaction } = {}) {
  const [state, setState] = createSignal(null);
  const [myVote, setMyVote] = createSignal(0);
  const [votesUsed, setVotesUsed] = createSignal(0);
  const [now, setNow] = createSignal(Date.now());

  let lastTrackId = null;

  const ticker = setInterval(() => setNow(Date.now()), 500);
  onCleanup(() => clearInterval(ticker));

  createEffect(() => {
    const id = clientId();
    let ws = null;
    let reconnectTimer = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const query = id ? `?client=${encodeURIComponent(id)}` : '';
      ws = new WebSocket(`${proto}://${location.host}/ws${query}`);

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'session-expired') {
          onSessionExpired?.();
          return;
        }
        if (msg.type === 'you') {
          setMyVote(msg.myVote || 0);
          setVotesUsed(msg.votesUsed || 0);
          return;
        }
        if (msg.type === 'reaction') {
          onReaction?.(msg);
          return;
        }
        if (msg.type === 'state') {
          const nextId = msg.current?.track?.id || null;
          if (nextId !== lastTrackId) {
            setMyVote(0);
            setVotesUsed(0);
            lastTrackId = nextId;
          }
          setState(msg);
        }
      };

      ws.onclose = () => {
        if (!disposed) reconnectTimer = setTimeout(connect, 2500);
      };
    };

    connect();

    onCleanup(() => {
      disposed = true;
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    });
  });

  const elapsedMs = () => {
    const cur = state()?.current;
    if (!cur) return 0;
    return Math.max(0, now() - cur.startedAt);
  };

  const totalMs = () => {
    const cur = state()?.current;
    if (!cur) return 0;
    return Math.max(1, cur.endsAt - cur.startedAt);
  };

  const progressPct = () => {
    if (!state()?.current) return 0;
    return Math.min(100, (elapsedMs() / totalMs()) * 100);
  };

  return {
    state,
    myVote,
    setMyVote,
    votesUsed,
    setVotesUsed,
    elapsedMs,
    totalMs,
    progressPct,
  };
}
