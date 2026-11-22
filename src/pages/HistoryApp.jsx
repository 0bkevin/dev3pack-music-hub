import { createSignal, onMount, onCleanup, Show, For } from 'solid-js';
import { api, fmtMs, loadSession, saveSession, trackGradient } from '../lib/api.js';
import { Cover } from '../components/Cover.jsx';
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
  const [selectedUserId, setSelectedUserId] = createSignal(null);
  const [userDetail, setUserDetail] = createSignal(null);
  const [loadingUser, setLoadingUser] = createSignal(false);
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

  async function selectUser(userId) {
    if (!userId) {
      setSelectedUserId(null);
      setUserDetail(null);
      return;
    }
    setSelectedUserId(userId);
    setLoadingUser(true);
    try {
      const res = await api(`/api/history/user/${encodeURIComponent(userId)}`);
      setUserDetail(res);
    } catch (err) {
      showToast(err.message);
    } finally {
      setLoadingUser(false);
    }
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

  const topRequesters = () => data()?.topRequesters || [];
  const people = () => data()?.people || [];
  const fullHistory = () => data()?.history || [];
  const totals = () => data()?.totals || { totalTracks: 0, totalRequesters: 0 };
  const displayedTracks = () =>
    selectedUserId() ? userDetail()?.history || [] : fullHistory();

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
            <h2>Top 5 · Los que más piden música</h2>
            <span class="hist-hint">Toca un avatar para ver su historial completo</span>
          </div>

          <Show
            when={topRequesters().length > 0}
            fallback={
              <div class="hist-empty">
                {loading() ? 'Cargando ranking…' : 'Todavía nadie ha pedido canciones.'}
              </div>
            }
          >
            <div class="top5-avatars" id="top5-list">
              <For each={topRequesters()}>
                {(person, idx) => (
                  <button
                    type="button"
                    class={`avatar-card${selectedUserId() === person.id ? ' active' : ''}`}
                    onClick={() =>
                      selectUser(selectedUserId() === person.id ? null : person.id)
                    }
                  >
                    <span class="avatar-ring">
                      <span
                        class="avatar-circle"
                        style={{ background: trackGradient({ id: person.id }) }}
                      >
                        <span class="avatar-emoji">{person.emoji}</span>
                      </span>
                      <span class="avatar-rank tabular">#{idx() + 1}</span>
                    </span>
                    <span class="avatar-name">{person.name}</span>
                    <span class="avatar-count tabular">
                      {person.songCount} {person.songCount === 1 ? 'canción' : 'canciones'}
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </section>

        <section class="hist-section">
          <div class="hist-section-head">
            <h2 class="hist-selected-heading">
              <Show
                when={selectedUserId() && userDetail()?.user}
                fallback="Historial completo"
              >
                <span
                  class="mini-avatar"
                  style={{ background: trackGradient({ id: userDetail().user.id }) }}
                >
                  {userDetail().user.emoji}
                </span>
                <span>Historial de {userDetail().user.name}</span>
              </Show>
            </h2>
            <Show when={selectedUserId()}>
              <button
                type="button"
                class="hist-clear-filter"
                onClick={() => selectUser(null)}
              >
                Ver todo el historial
              </button>
            </Show>
          </div>

          <Show when={people().length > 0}>
            <div class="people-filter" id="people-filter">
              <button
                type="button"
                class={`person-filter-btn${!selectedUserId() ? ' active' : ''}`}
                onClick={() => selectUser(null)}
              >
                Todos <span class="tabular">{fullHistory().length}</span>
              </button>
              <For each={people()}>
                {(p) => (
                  <button
                    type="button"
                    class={`person-filter-btn${selectedUserId() === p.id ? ' active' : ''}`}
                    onClick={() => selectUser(p.id)}
                  >
                    <span
                      class="mini-avatar sm"
                      style={{ background: trackGradient({ id: p.id }) }}
                    >
                      {p.emoji}
                    </span>
                    <span>{p.name}</span>
                    <span class="tabular">{p.songCount}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>

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
              when={!loadingUser() && displayedTracks().length > 0}
              fallback={
                <div class="hist-empty">
                  {loading() || loadingUser()
                    ? 'Cargando historial…'
                    : 'No hay canciones registradas todavía.'}
                </div>
              }
            >
              <For each={displayedTracks()}>
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
                          onClick={() => selectUser(row.userId)}
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
                      <span>👍 {row.likes}</span>
                      <span>👎 {row.dislikes}</span>
                    </div>
                    <span class={`hist-status ${row.status}`}>
                      {STATUS_LABELS[row.status] || row.status}
                    </span>
                  </div>
                )}
              </For>
            </Show>
          </div>
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
