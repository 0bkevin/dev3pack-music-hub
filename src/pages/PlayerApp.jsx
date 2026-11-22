import { createSignal, createMemo, createEffect, onMount, onCleanup } from 'solid-js';
import { api, loadSession, saveSession, trackGradient } from '../lib/api.js';
import { createRoom } from '../lib/room.js';
import { toast } from '../lib/sonner.js';
import { NowPlayingHero } from '../components/player/NowPlayingHero.jsx';
import { TrackBrowser } from '../components/player/TrackBrowser.jsx';
import { QueueRail } from '../components/player/QueueRail.jsx';
import { PlayerBar } from '../components/player/PlayerBar.jsx';
import { JoinOverlay, USER_EMOJIS } from '../components/player/JoinOverlay.jsx';
import { CommandSearch } from '../components/CommandSearch.jsx';
import { Toaster } from '../components/Toaster.jsx';

const MOODS = [
  'Bad Bunny', 'Daft Punk', 'The Weeknd', 'Karol G',
  'Feid', 'Tame Impala', 'Electronic', 'Rock',
];

export function PlayerApp() {
  const [session, setSession] = createSignal(loadSession());
  const [nameInput, setNameInput] = createSignal('');
  const [joinError, setJoinError] = createSignal('');
  const [selectedEmoji, setSelectedEmoji] = createSignal(
    USER_EMOJIS[Math.floor(Math.random() * USER_EMOJIS.length)]
  );
  const [searchText, setSearchText] = createSignal('');
  const [activeMood, setActiveMood] = createSignal(MOODS[0]);
  const [results, setResults] = createSignal([]);
  const [searching, setSearching] = createSignal(false);
  const [pendingIds, setPendingIds] = createSignal(new Set());
  const [queueOpen, setQueueOpen] = createSignal(false);

  let searchTimer = null;
  let lastSeenTrackId = null;
  let nameRef;
  let searchRef;

  onCleanup(() => {
    clearTimeout(searchTimer);
  });

  async function joinRoom(name, emoji, silent = false) {
    setJoinError('');
    try {
      const data = await api('/api/join', {
        method: 'POST',
        body: JSON.stringify({ name, emoji }),
      });
      saveSession(data);
      setSession(data);
      if (!silent) {
        toast.success(
          `¡Bienvenido, ${data.emoji} ${data.name}!`,
          'Ya puedes pedir canciones y votar lo que suena.'
        );
      }
    } catch (err) {
      setJoinError(err.message);
      if (!silent) toast.error('Nombre no disponible', err.message);
    }
  }

  function openJoinOverlay() {
    const prevId = session()?.clientId;
    saveSession(null);
    setSession(null);
    setNameInput('');
    setJoinError('');
    setQueueOpen(false);
    room.setMyVote(0);
    if (prevId) {
      api('/api/leave', { method: 'POST', body: JSON.stringify({ clientId: prevId }) }).catch(() => {});
    }
    setTimeout(() => nameRef?.focus(), 40);
  }

  const room = createRoom({
    clientId: () => session()?.clientId || null,
    onSessionExpired: () => {
      saveSession(null);
      setSession(null);
    },
  });

  const current = () => room.state()?.current || null;
  const queue = () => room.state()?.queue || [];
  const dislikesToSkip = () => room.state()?.dislikesToSkip || 5;
  const dislikes = () => room.state()?.dislikes || 0;
  const likes = () => room.state()?.likes || 0;

  createEffect(() => {
    const cur = current();
    if (!cur) {
      lastSeenTrackId = null;
      return;
    }
    if (lastSeenTrackId && lastSeenTrackId !== cur.track.id && cur.reason === 'skipped') {
      toast.info(
        'Canción saltada por la sala',
        `«${cur.skippedTrack || 'La pista anterior'}» alcanzó el límite de no me gusta.`
      );
    }
    lastSeenTrackId = cur.track.id;
  });

  const isManualSearch = () => searchText().trim().length > 0;
  const queuedIds = createMemo(() => new Set(queue().map((q) => q.track.id)));
  const skipDotIndexes = createMemo(() => Array.from({ length: dislikesToSkip() }, (_, i) => i));

  async function fetchTracks(query) {
    const clean = query.trim();
    if (!clean) return;
    setSearching(true);
    try {
      const { tracks } = await api(`/api/search?q=${encodeURIComponent(clean)}`);
      setResults(tracks || []);
    } catch (err) {
      toast.error('Error al buscar canciones', err.message);
    } finally {
      setSearching(false);
    }
  }

  onMount(() => fetchTracks(activeMood()));

  function handleSearchInput(val) {
    setSearchText(val);
    clearTimeout(searchTimer);
    if (!val.trim()) {
      fetchTracks(activeMood());
      return;
    }
    searchTimer = setTimeout(() => fetchTracks(val), 280);
  }

  function clearSearch() {
    setSearchText('');
    clearTimeout(searchTimer);
    searchRef?.focus();
    fetchTracks(activeMood());
  }

  function selectMood(mood) {
    setActiveMood(mood);
    setSearchText('');
    fetchTracks(mood);
  }

  async function enqueueTrack(track) {
    const s = session();
    if (!s?.clientId) {
      openJoinOverlay();
      return false;
    }
    const hadCurrent = Boolean(current());
    setPendingIds((prev) => new Set([...prev, track.id]));
    try {
      await api('/api/queue', {
        method: 'POST',
        body: JSON.stringify({ clientId: s.clientId, track }),
      });
      toast.success(
        `«${track.name}» agregada`,
        hadCurrent
          ? 'Entró en la cola con turno intercalado.'
          : 'Empieza a sonar ahora mismo.'
      );
      return true;
    } catch (err) {
      toast.error('No se pudo agregar a la cola', err.message);
      return false;
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
    }
  }

  async function cancelQueuedTrack(item) {
    const s = session();
    if (!s?.clientId || !item?.qid) return;
    try {
      await api('/api/queue/cancel', {
        method: 'POST',
        body: JSON.stringify({ clientId: s.clientId, qid: item.qid }),
      });
      toast.success(
        `«${item.track.name}» quitada de la cola`,
        'Recuperaste tu cupo para pedir otra canción.'
      );
    } catch (err) {
      toast.error('No se pudo quitar la canción', err.message);
    }
  }

  async function sendVote(value) {
    const s = session();
    if (!s?.clientId) {
      openJoinOverlay();
      return;
    }
    const next = room.myVote() === value ? 0 : value;
    try {
      const res = await api('/api/vote', {
        method: 'POST',
        body: JSON.stringify({
          clientId: s.clientId,
          vote: next,
          trackId: current()?.track?.id || null,
        }),
      });
      room.setMyVote(res.myVote ?? next);
    } catch (err) {
      toast.error('No se pudo registrar tu voto', err.message);
    }
  }

  const ambientBg = () => {
    const t = current()?.track;
    if (!t) return undefined;
    return t.imageUrl
      ? { 'background-image': `url("${t.imageUrl}")` }
      : { background: trackGradient(t) };
  };

  return (
    <>
      <div class="app-root">
        <div class="ambient-backdrop">
          <div class="ambient-fallback" />
          <div
            class={`ambient-art${current() ? ' active' : ''}`}
            style={ambientBg()}
          />
        </div>

        <div class="workspace">
          <main class="main-pane">
            <NowPlayingHero
              current={current}
              myVote={room.myVote}
              likes={likes}
              dislikes={dislikes}
              dislikesToSkip={dislikesToSkip}
              skipDotIndexes={skipDotIndexes}
              onVote={sendVote}
            />

            <TrackBrowser
              searchRef={(el) => { searchRef = el; }}
              moods={MOODS}
              activeMood={activeMood}
              searchText={searchText}
              isManualSearch={isManualSearch}
              onSearchInput={handleSearchInput}
              onClearSearch={clearSearch}
              results={results}
              searching={searching}
              currentTrackId={() => current()?.track?.id}
              queuedIds={queuedIds}
              pendingIds={pendingIds}
              onSelectMood={selectMood}
              onEnqueue={enqueueTrack}
            />
          </main>

          <QueueRail
            open={queueOpen}
            onClose={() => setQueueOpen(false)}
            queue={queue}
            selfPublicId={() => session()?.publicId}
            onCancel={cancelQueuedTrack}
          />
        </div>

        <PlayerBar
          current={current}
          elapsedMs={room.elapsedMs}
          totalMs={room.totalMs}
          progressPct={room.progressPct}
          myVote={room.myVote}
          likes={likes}
          dislikes={dislikes}
          queueCount={() => queue().length}
          onToggleQueue={() => setQueueOpen((v) => !v)}
          onVote={sendVote}
        />
      </div>

      <CommandSearch
        queue={queue}
        currentTrackId={() => current()?.track?.id}
        onEnqueue={enqueueTrack}
        onNotify={(msg) => toast.error('Error de búsqueda', msg)}
      />

      <JoinOverlay
        visible={() => !session()?.clientId}
        current={current}
        inputRef={(el) => { nameRef = el; }}
        nameInput={nameInput}
        onNameInput={(v) => {
          setNameInput(v);
          if (joinError()) setJoinError('');
        }}
        error={joinError}
        selectedEmoji={selectedEmoji}
        onSelectEmoji={setSelectedEmoji}
        onJoin={joinRoom}
      />

      <Toaster offsetPlayer />
    </>
  );
}
