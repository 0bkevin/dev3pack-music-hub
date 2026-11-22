import { createSignal, createMemo, onMount, onCleanup } from 'solid-js';
import { api, loadSession, saveSession, trackGradient } from '../lib/api.js';
import { createRoom } from '../lib/room.js';
import { NowPlayingHero } from '../components/player/NowPlayingHero.jsx';
import { TrackBrowser } from '../components/player/TrackBrowser.jsx';
import { QueueRail } from '../components/player/QueueRail.jsx';
import { PlayerBar } from '../components/player/PlayerBar.jsx';
import { JoinOverlay, USER_EMOJIS } from '../components/player/JoinOverlay.jsx';
import { CommandSearch } from '../components/CommandSearch.jsx';

const MOODS = [
  'Bad Bunny', 'Daft Punk', 'The Weeknd', 'Karol G',
  'Feid', 'Tame Impala', 'Electronic', 'Rock',
];

export function PlayerApp() {
  const [session, setSession] = createSignal(loadSession());
  const [nameInput, setNameInput] = createSignal('');
  const [selectedEmoji, setSelectedEmoji] = createSignal(
    USER_EMOJIS[Math.floor(Math.random() * USER_EMOJIS.length)]
  );
  const [searchText, setSearchText] = createSignal('');
  const [activeMood, setActiveMood] = createSignal(MOODS[0]);
  const [results, setResults] = createSignal([]);
  const [searching, setSearching] = createSignal(false);
  const [pendingIds, setPendingIds] = createSignal(new Set());
  const [queueOpen, setQueueOpen] = createSignal(false);
  const [toast, setToast] = createSignal({ msg: '', ok: false, visible: false });

  let toastTimer = null;
  let searchTimer = null;
  let nameRef;
  let searchRef;

  function showToast(msg, ok = false) {
    setToast({ msg, ok, visible: true });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast((t) => ({ ...t, visible: false })), 3200);
  }

  onCleanup(() => {
    clearTimeout(toastTimer);
    clearTimeout(searchTimer);
  });

  async function joinRoom(name, emoji) {
    try {
      const data = await api('/api/join', {
        method: 'POST',
        body: JSON.stringify({ name, emoji }),
      });
      saveSession(data);
      setSession(data);
    } catch (err) {
      showToast(err.message);
    }
  }

  function openJoinOverlay() {
    const prevId = session()?.clientId;
    saveSession(null);
    setSession(null);
    setNameInput('');
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
      const s = session();
      if (s?.name) joinRoom(s.name, s.emoji);
    },
  });

  const current = () => room.state()?.current || null;
  const queue = () => room.state()?.queue || [];
  const dislikesToSkip = () => room.state()?.dislikesToSkip || 5;
  const dislikes = () => room.state()?.dislikes || 0;
  const likes = () => room.state()?.likes || 0;

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
      showToast(err.message);
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
    setPendingIds((prev) => new Set([...prev, track.id]));
    try {
      await api('/api/queue', {
        method: 'POST',
        body: JSON.stringify({ clientId: s.clientId, track }),
      });
      showToast(`«${track.name}» agregada a la cola`, true);
      return true;
    } catch (err) {
      showToast(err.message);
      return false;
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
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
      showToast(err.message);
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
          provider={() => room.state()?.provider}
          onVote={sendVote}
        />
      </div>

      <CommandSearch
        queue={queue}
        currentTrackId={() => current()?.track?.id}
        onEnqueue={enqueueTrack}
        onNotify={showToast}
      />

      <JoinOverlay
        visible={() => !session()?.clientId}
        current={current}
        inputRef={(el) => { nameRef = el; }}
        nameInput={nameInput}
        onNameInput={setNameInput}
        selectedEmoji={selectedEmoji}
        onSelectEmoji={setSelectedEmoji}
        onJoin={joinRoom}
      />

      <div
        class={`toast${toast().visible ? ' show' : ''}${toast().ok ? ' ok' : ''}`}
        id="toast"
      >
        {toast().msg}
      </div>
    </>
  );
}
