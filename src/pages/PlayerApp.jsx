import { createSignal, createMemo, onMount, onCleanup, Show, For } from 'solid-js';
import { api, fmtMs, loadSession, saveSession } from '../lib/api.js';
import { createRoom } from '../lib/room.js';
import { Cover } from '../components/Cover.jsx';
import { Equalizer, MusicNoteIcon, SearchIcon, TvIcon } from '../components/Icons.jsx';

const MOODS = [
  'Bad Bunny', 'Daft Punk', 'The Weeknd', 'Karol G',
  'Feid', 'Tame Impala', 'Electronic', 'Rock',
];

export function PlayerApp() {
  const [session, setSession] = createSignal(loadSession());
  const [nameInput, setNameInput] = createSignal('');
  const [searchText, setSearchText] = createSignal('');
  const [activeMood, setActiveMood] = createSignal(MOODS[0]);
  const [results, setResults] = createSignal([]);
  const [searching, setSearching] = createSignal(false);
  const [pendingIds, setPendingIds] = createSignal(new Set());
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

  async function joinRoom(name) {
    try {
      const data = await api('/api/join', {
        method: 'POST',
        body: JSON.stringify({ name }),
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
      if (s?.name) joinRoom(s.name);
    },
  });

  const current = () => room.state()?.current || null;
  const queue = () => room.state()?.queue || [];
  const listeners = () => room.state()?.listeners || [];
  const dislikesToSkip = () => room.state()?.dislikesToSkip || 5;
  const dislikes = () => room.state()?.dislikes || 0;
  const likes = () => room.state()?.likes || 0;

  const isManualSearch = () => searchText().trim().length > 0;
  const queuedIds = createMemo(() => new Set(queue().map((q) => q.track.id)));

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
      return;
    }
    setPendingIds((prev) => new Set([...prev, track.id]));
    try {
      await api('/api/queue', {
        method: 'POST',
        body: JSON.stringify({ clientId: s.clientId, track }),
      });
      showToast(`«${track.name}» agregada a la cola`, true);
    } catch (err) {
      showToast(err.message);
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

  const skipDotIndexes = createMemo(() => Array.from({ length: dislikesToSkip() }, (_, i) => i));

  return (
    <>
      <div class="app-root">
        <div class="ambient-backdrop">
          <div class="ambient-fallback" />
          <div
            class="ambient-art"
            style={
              current()?.track?.imageUrl
                ? { 'background-image': `url("${current().track.imageUrl}")` }
                : undefined
            }
          />
        </div>

        <div class="workspace">
          <main class="main-pane">
            <header class="topbar">
              <a class="brand" href="/">
                <span class="brand-mark">
                  <MusicNoteIcon size={15} strokeWidth={2.4} />
                </span>
                <span class="brand-title">
                  Dev3pack <span class="brand-sub">Music</span>
                </span>
              </a>

              <div class="search-wrap">
                <span class="search-icon">
                  <SearchIcon />
                </span>
                <input
                  ref={searchRef}
                  class="search-input"
                  id="search-input"
                  value={searchText()}
                  onInput={(e) => handleSearchInput(e.currentTarget.value)}
                  placeholder="¿Qué quieres escuchar?"
                  autocomplete="off"
                />
                <Show when={isManualSearch()}>
                  <button
                    class="search-clear"
                    id="search-clear"
                    type="button"
                    aria-label="Limpiar búsqueda"
                    onClick={clearSearch}
                  >
                    ×
                  </button>
                </Show>
              </div>

              <div class="topbar-actions">
                <Show when={session()?.name}>
                  <button
                    class="user-btn"
                    id="who-btn"
                    type="button"
                    title="Cambiar nombre"
                    onClick={openJoinOverlay}
                  >
                    <span class="user-avatar">
                      {session().name.trim()[0]?.toUpperCase() || '?'}
                    </span>
                    <span>{session().name}</span>
                  </button>
                </Show>
                <a class="tv-link" href="/screen" target="_blank" rel="noopener">
                  <TvIcon />
                  <span>Modo TV</span>
                </a>
              </div>
            </header>

            <section class="hero-stage">
              <div class="stage-cover-wrap">
                <Cover
                  track={current()?.track}
                  class="stage-cover"
                  placeholder={!current()?.track?.imageUrl}
                  showIcon={!current()?.track?.imageUrl}
                  iconSize={44}
                />
              </div>

              <div class="stage-meta">
                <div class="stage-status">
                  <Show when={current()}>
                    <Equalizer />
                  </Show>
                  <span>{current() ? 'Sonando ahora' : 'Sala lista'}</span>
                  <Show when={current()}>
                    <span class="dot-sep">·</span>
                    <span class="requester">Pedida por {current().addedBy}</span>
                  </Show>
                </div>

                <h1 class="stage-title">
                  {current()?.track?.name || 'Pon la primera canción'}
                </h1>
                <div class="stage-artist">
                  {current()?.track?.artists || 'Busca cualquier artista o elige una sugerencia abajo'}
                </div>

                <div class="stage-actions">
                  <button
                    class={`react-pill like${room.myVote() === 1 ? ' active' : ''}`}
                    id="like-btn"
                    type="button"
                    onClick={() => sendVote(1)}
                  >
                    <span class="emoji">👍</span>
                    <span>Me gusta</span>
                    <span class="count">{likes()}</span>
                  </button>
                  <button
                    class={`react-pill dislike${room.myVote() === -1 ? ' active' : ''}`}
                    id="dislike-btn"
                    type="button"
                    onClick={() => sendVote(-1)}
                  >
                    <span class="emoji">👎</span>
                    <span>No me gusta</span>
                    <span class="count">{dislikes()}</span>
                  </button>
                  <div class="skip-status">
                    <span class="skip-dots">
                      <For each={skipDotIndexes()}>
                        {(i) => <i class={i < dislikes() ? 'on' : ''} />}
                      </For>
                    </span>
                    <span>
                      {dislikes()}/{dislikesToSkip()} para saltar
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section class="browser-section">
              <div class="section-header">
                <h2 class="section-title">
                  {isManualSearch()
                    ? `Resultados para "${searchText().trim()}"`
                    : `Explorar · ${activeMood()}`}
                </h2>
                <span class="section-sub">Máx. 3 canciones cada 10 min · 30 min para repetir</span>
              </div>

              <Show when={!isManualSearch()}>
                <div class="mood-pills" id="mood-pills">
                  <For each={MOODS}>
                    {(mood) => (
                      <button
                        class={`mood-pill${activeMood() === mood ? ' active' : ''}`}
                        type="button"
                        data-q={mood}
                        onClick={() => selectMood(mood)}
                      >
                        {mood}
                      </button>
                    )}
                  </For>
                </div>
              </Show>

              <div class="track-table-head">
                <span class="th-num">#</span>
                <span />
                <span>Título</span>
                <span class="th-album">Álbum</span>
                <span class="th-dur">Duración</span>
                <span />
              </div>

              <div class="track-list" id="results">
                <Show
                  when={results().length > 0}
                  fallback={
                    <div class="empty-copy">
                      {searching() ? 'Buscando…' : 'No encontramos canciones para esa búsqueda.'}
                    </div>
                  }
                >
                  <For each={results()}>
                    {(track, idx) => {
                      const isPlaying = () => current()?.track?.id === track.id;
                      const isQueued = () => queuedIds().has(track.id);
                      const isBusy = () => pendingIds().has(track.id);
                      const disabled = () => isPlaying() || isQueued() || isBusy();
                      const label = () =>
                        isPlaying() ? 'Sonando' : isQueued() ? '✓ En cola' : '+ Cola';

                      return (
                        <div class="track-row">
                          <span class="track-idx">{idx() + 1}</span>
                          <Cover track={track} class="track-art" />
                          <div class="track-main">
                            <div class="track-name">{track.name}</div>
                            <div class="track-artist">{track.artists}</div>
                          </div>
                          <div class="track-album">{track.album || ''}</div>
                          <div class="track-dur">{fmtMs(track.durationMs)}</div>
                          <button
                            class="add-btn"
                            type="button"
                            disabled={disabled()}
                            onClick={() => enqueueTrack(track)}
                          >
                            {label()}
                          </button>
                        </div>
                      );
                    }}
                  </For>
                </Show>
              </div>
            </section>
          </main>

          <aside class="queue-rail">
            <div class="rail-head">
              <h2 class="rail-title">A continuación</h2>
              <span class="rail-badge">{queue().length}</span>
            </div>

            <div class="rail-scroll">
              <Show
                when={queue().length > 0}
                fallback={
                  <div class="empty-copy">
                    La cola está vacía. Cuando termine la canción actual elegimos una aleatoria.
                  </div>
                }
              >
                <For each={queue()}>
                  {(item, i) => (
                    <div class={`q-item${i() === 0 ? ' next-up' : ''}`}>
                      <Cover track={item.track} class="q-art" />
                      <div class="q-info">
                        <Show when={i() === 0}>
                          <div class="next-tag">Siguiente</div>
                        </Show>
                        <div class="q-name">{item.track.name}</div>
                        <div class="q-sub">{item.track.artists}</div>
                        <div class="q-who">por {item.addedBy}</div>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </div>

            <div class="rail-listeners">
              <div class="rail-listeners-head">
                <span>
                  <i class="live-dot" /> En la sala
                </span>
                <span class="tabular">{room.state()?.listenerCount || 0}</span>
              </div>
              <div class="people-row">
                <For each={listeners()}>
                  {(c) => (
                    <span class={`person-chip${session()?.clientId === c.id ? ' me' : ''}`}>
                      {c.name}
                    </span>
                  )}
                </For>
              </div>
            </div>
          </aside>
        </div>

        <footer class="player-bar">
          <div class="pb-track">
            <Cover track={current()?.track} class="pb-art" />
            <div class="pb-meta">
              <div class="pb-title">{current()?.track?.name || 'Sin reproducción'}</div>
              <div class="pb-artist">
                {current()?.track?.artists || 'Agrega una canción para empezar'}
              </div>
            </div>
          </div>

          <div class="pb-center">
            <div class="pb-status">
              <Show when={current()}>
                <Equalizer />
              </Show>
              <span>
                {current() ? `Pedida por ${current().addedBy}` : 'Esperando música'}
              </span>
            </div>
            <div class="pb-progress-row">
              <span class="pb-time">{fmtMs(room.elapsedMs())}</span>
              <div class="progress-track">
                <i class="progress-fill" style={{ width: `${room.progressPct()}%` }} />
              </div>
              <span class="pb-time end">
                {current() ? fmtMs(room.totalMs()) : '0:00'}
              </span>
            </div>
          </div>

          <div class="pb-right">
            <button
              class={`pb-vote like${room.myVote() === 1 ? ' active' : ''}`}
              id="pb-like-btn"
              type="button"
              aria-label="Me gusta"
              onClick={() => sendVote(1)}
            >
              <span>👍</span>
              <span class="tabular">{likes()}</span>
            </button>
            <button
              class={`pb-vote dislike${room.myVote() === -1 ? ' active' : ''}`}
              id="pb-dislike-btn"
              type="button"
              aria-label="No me gusta"
              onClick={() => sendVote(-1)}
            >
              <span>👎</span>
              <span class="tabular">{dislikes()}</span>
            </button>
            <span class="provider-tag">
              {(room.state()?.provider || '').toUpperCase()}
            </span>
          </div>
        </footer>
      </div>

      <Show when={!session()?.clientId}>
        <div class="join-overlay" id="join-overlay">
          <div class="join-sheet">
            <div class="join-head">
              <div class="join-mark">
                <MusicNoteIcon size={22} strokeWidth={2.2} />
              </div>
              <h1>Dev3pack Music</h1>
              <p>Pon tu nombre para pedir canciones y votar lo que suena, o entra como anónimo.</p>
            </div>

            <Show when={current()}>
              <div class="join-live-pill">
                <Equalizer />
                <span>
                  Sonando <b>{current().track.name}</b> · {current().track.artists}
                </span>
              </div>
            </Show>

            <input
              ref={nameRef}
              class="join-input"
              id="name-input"
              maxLength={24}
              value={nameInput()}
              onInput={(e) => setNameInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') joinRoom(nameInput() || undefined);
              }}
              placeholder="Tu nombre o alias"
              autocomplete="off"
            />

            <div class="join-btns">
              <button
                class="btn-primary"
                id="join-btn"
                type="button"
                onClick={() => joinRoom(nameInput() || undefined)}
              >
                Entrar a escuchar
              </button>
              <button
                class="btn-subtle"
                id="anon-btn"
                type="button"
                onClick={() => joinRoom(undefined)}
              >
                Entrar como anónimo
              </button>
            </div>
          </div>
        </div>
      </Show>

      <div
        class={`toast${toast().visible ? ' show' : ''}${toast().ok ? ' ok' : ''}`}
        id="toast"
      >
        {toast().msg}
      </div>
    </>
  );
}
