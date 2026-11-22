import { createSignal, createMemo, onMount, onCleanup, Show, For } from 'solid-js';
import { api, fmtMs, loadSession, saveSession, trackGradient } from '../lib/api.js';
import { Cover } from '../components/Cover.jsx';
import { SearchIcon } from '../components/Icons.jsx';
import { CommandSearch } from '../components/CommandSearch.jsx';

const STATUS_LABELS = {
  playing: 'Sonando',
  queued: 'En cola',
  played: 'Reproducida',
  skipped: 'Saltada',
};

function fmtTime(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString('es-VE', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

export function HistoryApp() {
  const [data, setData] = createSignal(null);
  const [loading, setLoading] = createSignal(true);
  const [activeTab, setActiveTab] = createSignal('tracks'); // 'tracks' | 'people'
  const [searchText, setSearchText] = createSignal('');
  const [openUserId, setOpenUserId] = createSignal(null); // single-open accordion
  const [userTracks, setUserTracks] = createSignal({}); // userId -> TrackHistory[]
  const [loadingUserId, setLoadingUserId] = createSignal(null);
  const [toast, setToast] = createSignal({ msg: '', ok: false, visible: false });

  let toastTimer = null;

  function showToast(msg, ok = false) {
    setToast({ msg, ok, visible: true });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast((t) => ({ ...t, visible: false })), 3000);
  }

  async function loadAll() {
    setLoading(true);
    try {
      const res = await api('/api/history');
      setData(res);
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchUserHistory(userId) {
    setLoadingUserId(userId);
    try {
      const res = await api(`/api/history/user/${encodeURIComponent(userId)}`);
      setUserTracks((prev) => ({ ...prev, [userId]: res.history || [] }));
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoadingUserId((cur) => (cur === userId ? null : cur));
    }
  }

  function toggleParticipant(userId) {
    if (openUserId() === userId) {
      setOpenUserId(null);
      return;
    }
    // Single-open accordion: opening a new participant automatically closes the previous one
    setOpenUserId(userId);
    fetchUserHistory(userId);
  }

  function jumpToParticipant(userId) {
    if (!userId) return;
    setActiveTab('people');
    setSearchText('');
    setOpenUserId(userId);
    fetchUserHistory(userId);
  }

  async function enqueueFromHistory(track) {
    try {
      let s = loadSession();
      if (!s?.clientId) {
        s = await api('/api/join', { method: 'POST', body: JSON.stringify({}) });
        saveSession(s);
      }
      await api('/api/queue', {
        method: 'POST',
        body: JSON.stringify({ clientId: s.clientId, track }),
      });
      showToast(`«${track.name}» agregada a la cola`, true);
      loadAll();
      return true;
    } catch (err) {
      showToast(err.message);
      return false;
    }
  }

  onMount(() => {
    loadAll();
    const timer = setInterval(loadAll, 15_000);
    onCleanup(() => {
      clearInterval(timer);
      clearTimeout(toastTimer);
    });
  });

  const top3 = () => data()?.topRequesters || [];
  // Visual Olympic podium order: #2 (left), #1 (center), #3 (right)
  const podiumSlots = createMemo(() => {
    const list = top3();
    if (list.length === 0) return [];
    if (list.length === 1) return [{ rank: 1, person: list[0] }];
    if (list.length === 2) {
      return [
        { rank: 2, person: list[1] },
        { rank: 1, person: list[0] },
      ];
    }
    return [
      { rank: 2, person: list[1] },
      { rank: 1, person: list[0] },
      { rank: 3, person: list[2] },
    ];
  });

  const people = () => data()?.people || [];
  const fullHistory = () => data()?.history || [];
  const totals = () => data()?.totals || { totalTracks: 0, totalRequesters: 0 };

  const filteredHistory = createMemo(() => {
    const q = searchText().trim().toLowerCase();
    if (!q) return fullHistory();
    return fullHistory().filter(
      (r) =>
        r.track.name.toLowerCase().includes(q) ||
        r.track.artists.toLowerCase().includes(q) ||
        r.addedBy.toLowerCase().includes(q)
    );
  });

  const filteredPeople = createMemo(() => {
    const q = searchText().trim().toLowerCase();
    if (!q) return people();
    return people().filter(
      (p) => p.name.toLowerCase().includes(q) || p.emoji.includes(q)
    );
  });

  return (
    <div class="hist-root">
      <div class="hist-ambient" aria-hidden="true" />

      <div class="hist-container">
        <header class="hist-header">
          <div class="hist-header-left">
            <a class="hist-back" href="/">← Volver a la sala</a>
            <h1 class="hist-title">Historial de la sala</h1>
          </div>
          <div class="hist-stats">
            <div class="hist-stat">
              <span class="hist-stat-val tabular">{totals().totalTracks}</span>
              <span class="hist-stat-lbl">canciones</span>
            </div>
            <div class="hist-stat">
              <span class="hist-stat-val tabular">{totals().totalRequesters}</span>
              <span class="hist-stat-lbl">participantes</span>
            </div>
          </div>
        </header>

        <section class="hist-section">
          <div class="hist-section-head">
            <h2>Podio · Top 3</h2>
            <span class="hist-hint">Toca un avatar para abrir su historial</span>
          </div>

          <Show
            when={podiumSlots().length > 0}
            fallback={
              <div class="hist-empty">
                {loading() ? 'Cargando podio…' : 'Todavía nadie ha pedido canciones.'}
              </div>
            }
          >
            <div class="podium" id="podium">
              <For each={podiumSlots()}>
                {(slot) => (
                  <button
                    type="button"
                    class={`podium-slot rank-${slot.rank}${
                      activeTab() === 'people' && openUserId() === slot.person.id ? ' active' : ''
                    }`}
                    onClick={() => jumpToParticipant(slot.person.id)}
                  >
                    <span class="podium-avatar-ring">
                      <span
                        class="podium-avatar"
                        style={{ background: trackGradient({ id: slot.person.id }) }}
                      >
                        <span class="podium-emoji">{slot.person.emoji}</span>
                      </span>
                    </span>
                    <span class="podium-name">{slot.person.name}</span>
                    <span class="podium-meta tabular">
                      {slot.person.songCount} {slot.person.songCount === 1 ? 'canción' : 'canciones'}
                    </span>
                    <span class="podium-step">
                      <span class="podium-num tabular">{slot.rank}</span>
                      <span class="podium-votes tabular">
                        👍 {slot.person.totalLikes} · 👎 {slot.person.totalDislikes}
                      </span>
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </section>

        <section class="hist-section">
          <div class="hist-toolbar">
            <div class="hist-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                id="tab-tracks"
                aria-selected={activeTab() === 'tracks'}
                class={`hist-tab${activeTab() === 'tracks' ? ' active' : ''}`}
                onClick={() => {
                  setActiveTab('tracks');
                  setSearchText('');
                }}
              >
                <span>Todos</span>
                <span class="hist-tab-count tabular">{fullHistory().length}</span>
              </button>
              <button
                type="button"
                role="tab"
                id="tab-people"
                aria-selected={activeTab() === 'people'}
                class={`hist-tab${activeTab() === 'people' ? ' active' : ''}`}
                onClick={() => {
                  setActiveTab('people');
                  setSearchText('');
                }}
              >
                <span>Participantes</span>
                <span class="hist-tab-count tabular">{people().length}</span>
              </button>
            </div>

            <div class="hist-search-wrap">
              <span class="hist-search-icon">
                <SearchIcon />
              </span>
              <input
                class="hist-search"
                id="hist-search"
                value={searchText()}
                onInput={(e) => setSearchText(e.currentTarget.value)}
                placeholder={
                  activeTab() === 'people'
                    ? 'Buscar participante…'
                    : 'Buscar canción, artista o persona…'
                }
                autocomplete="off"
              />
              <Show when={searchText().trim().length > 0}>
                <button
                  type="button"
                  class="hist-search-clear"
                  aria-label="Limpiar búsqueda"
                  onClick={() => setSearchText('')}
                >
                  ×
                </button>
              </Show>
            </div>
          </div>

          <Show when={activeTab() === 'tracks'}>
            <div class="hist-table-head">
              <span>Hora</span>
              <span />
              <span>Canción</span>
              <span class="ht-user">Pedida por</span>
              <span class="ht-votes">Votos</span>
              <span class="ht-status">Estado</span>
            </div>

            <div class="hist-list" id="hist-list">
              <Show
                when={filteredHistory().length > 0}
                fallback={
                  <div class="hist-empty">
                    {loading() ? 'Cargando historial…' : 'No hay canciones que coincidan.'}
                  </div>
                }
              >
                <For each={filteredHistory()}>
                  {(row) => (
                    <div class="hist-row">
                      <span class="hist-time tabular">{fmtTime(row.requestedAt)}</span>
                      <Cover track={row.track} class="hist-art" />
                      <div class="hist-track">
                        <div class="hist-track-name">{row.track.name}</div>
                        <div class="hist-track-artist">
                          {row.track.artists} · {fmtMs(row.track.durationMs)}
                        </div>
                      </div>
                      <div class="hist-who">
                        <Show
                          when={row.userId}
                          fallback={
                            <span class="hist-who-static">
                              <span class="mini-avatar sm">{row.addedByEmoji}</span>
                              <span class="hist-who-name">{row.addedBy}</span>
                            </span>
                          }
                        >
                          <button
                            type="button"
                            class="hist-who-btn"
                            onClick={() => jumpToParticipant(row.userId)}
                          >
                            <span
                              class="mini-avatar sm"
                              style={{ background: trackGradient({ id: row.userId }) }}
                            >
                              {row.addedByEmoji}
                            </span>
                            <span class="hist-who-name">{row.addedBy}</span>
                          </button>
                        </Show>
                      </div>
                      <div class="hist-votes tabular">
                        <span class="vote-pos">👍 {row.likes}</span>
                        <span class="vote-neg">👎 {row.dislikes}</span>
                      </div>
                      <span class={`hist-status ${row.status}`}>
                        {STATUS_LABELS[row.status] || row.status}
                      </span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </Show>

          <Show when={activeTab() === 'people'}>
            <div class="acc-list" id="people-accordion">
              <Show
                when={filteredPeople().length > 0}
                fallback={
                  <div class="hist-empty">
                    {loading() ? 'Cargando participantes…' : 'No encontramos ese participante.'}
                  </div>
                }
              >
                <For each={filteredPeople()}>
                  {(person, idx) => {
                    const isOpen = () => openUserId() === person.id;
                    const tracks = () => userTracks()[person.id] || [];
                    const isBusy = () => loadingUserId() === person.id;

                    return (
                      <div class={`acc-item${isOpen() ? ' open' : ''}`}>
                        <button
                          type="button"
                          class="acc-trigger"
                          aria-expanded={isOpen()}
                          onClick={() => toggleParticipant(person.id)}
                        >
                          <span class="acc-rank tabular">#{idx() + 1}</span>
                          <span
                            class="acc-avatar"
                            style={{ background: trackGradient({ id: person.id }) }}
                          >
                            {person.emoji}
                          </span>
                          <span class="acc-identity">
                            <span class="acc-name">{person.name}</span>
                            <span class="acc-sub tabular">
                              {person.songCount} {person.songCount === 1 ? 'canción' : 'canciones'}
                            </span>
                          </span>
                          <span class="acc-votes tabular">
                            <span class="vote-pill pos">👍 {person.totalLikes}</span>
                            <span class="vote-pill neg">👎 {person.totalDislikes}</span>
                          </span>
                          <span class="acc-chevron" aria-hidden="true">▾</span>
                        </button>

                        <div class="acc-panel">
                          <div class="acc-panel-inner">
                            <Show
                              when={!isBusy() && tracks().length > 0}
                              fallback={
                                <div class="acc-empty">
                                  {isBusy() ? 'Cargando canciones…' : 'Sin canciones registradas.'}
                                </div>
                              }
                            >
                              <For each={tracks()}>
                                {(row) => (
                                  <div class="acc-track-row">
                                    <span class="hist-time tabular">{fmtTime(row.requestedAt)}</span>
                                    <Cover track={row.track} class="acc-track-art" />
                                    <div class="hist-track">
                                      <div class="hist-track-name">{row.track.name}</div>
                                      <div class="hist-track-artist">
                                        {row.track.artists} · {fmtMs(row.track.durationMs)}
                                      </div>
                                    </div>
                                    <div class="hist-votes tabular">
                                      <span class="vote-pos">👍 {row.likes}</span>
                                      <span class="vote-neg">👎 {row.dislikes}</span>
                                    </div>
                                    <span class={`hist-status ${row.status}`}>
                                      {STATUS_LABELS[row.status] || row.status}
                                    </span>
                                  </div>
                                )}
                              </For>
                            </Show>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </div>
          </Show>
        </section>
      </div>

      <CommandSearch
        queue={() => []}
        currentTrackId={() => null}
        onEnqueue={enqueueFromHistory}
        onNotify={showToast}
      />

      <div class={`toast${toast().visible ? ' show' : ''}${toast().ok ? ' ok' : ''}`} id="toast">
        {toast().msg}
      </div>
    </div>
  );
}
