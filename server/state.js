import { randomTrack, providerMode, playTrackOnHost, getHostStatus } from './spotify.js';
import crypto from 'node:crypto';

const DISLIKES_TO_SKIP = Math.max(1, parseInt(process.env.DISLIKES_TO_SKIP || '5', 10));
const REPLAY_COOLDOWN_MS = Math.max(1, parseInt(process.env.REPLAY_COOLDOWN_MINUTES || '30', 10)) * 60_000;
const ENQUEUE_MAX = Math.max(1, parseInt(process.env.ENQUEUE_MAX_PER_WINDOW || '3', 10));
const ENQUEUE_WINDOW_MS = Math.max(1, parseInt(process.env.ENQUEUE_WINDOW_MINUTES || '10', 10)) * 60_000;
const MAX_VOTES_PER_TRACK = Math.max(1, parseInt(process.env.MAX_VOTES_PER_TRACK || '2', 10));

const ANON_NAMES = [
  'Anónimo Cósmico', 'Hacker Fantasma', 'Nómada Neon', 'Builder Incógnito',
  'Wanderer Solana', 'Shadow Validator', 'Miembro Misterioso', 'Agente 3030',
];

export class Room {
  constructor(broadcast) {
    this.broadcast = broadcast;
    this.clients = new Map();        // clientId -> { id, name, anonymous }
    this.queue = [];                 // [{ qid, track, addedBy }]
    this.current = null;             // { track, addedBy, startedAt, endsAt }
    this.votes = new Map();          // clientId -> 1 | -1  (for current track)
    this.voteActions = new Map();    // clientId -> count of vote actions on current track
    this.lastPlayed = new Map();     // trackId -> timestamp when it last started
    this.enqueueLog = new Map();     // clientId -> [timestamps] (rate limit por persona)
    this.endTimer = null;
    this.advancing = false;
  }

  voteStats() {
    let rawLikes = 0;
    let rawDislikes = 0;
    for (const v of this.votes.values()) {
      if (v === 1) rawLikes++;
      else if (v === -1) rawDislikes++;
    }
    const score = rawLikes - rawDislikes;
    return {
      rawLikes,
      rawDislikes,
      score,
      likes: Math.max(0, score),
      dislikes: Math.max(0, -score),
    };
  }

  clientVoteState(clientId) {
    return {
      type: 'you',
      clientId,
      myVote: this.votes.get(clientId) || 0,
      votesUsed: this.voteActions.get(clientId) || 0,
      maxVotesPerTrack: MAX_VOTES_PER_TRACK,
    };
  }

  join(name) {
    const id = crypto.randomUUID();
    const clean = (name || '').trim().slice(0, 24);
    const anon = !clean;
    const finalName = anon
      ? `${ANON_NAMES[Math.floor(Math.random() * ANON_NAMES.length)]} #${id.slice(0, 4)}`
      : clean;
    this.clients.set(id, { id, name: finalName, anonymous: anon });
    this.emitState();
    return this.clients.get(id);
  }

  leave(id) {
    if (!this.clients.delete(id)) return;
    const hadVote = this.votes.delete(id);
    this.voteActions.delete(id);
    if (hadVote && this.current && !this.advancing && this.voteStats().dislikes >= DISLIKES_TO_SKIP) {
      this.advance('skipped');
    } else {
      this.emitState();
    }
  }

  enqueue(clientId, track) {
    const client = this.clients.get(clientId);
    if (!client) return { error: 'Debes entrar primero.' };
    if (!track?.id || !track?.name) return { error: 'Track inválido.' };

    const last = this.lastPlayed.get(track.id);
    if (last && Date.now() - last < REPLAY_COOLDOWN_MS) {
      const mins = Math.ceil((REPLAY_COOLDOWN_MS - (Date.now() - last)) / 60000);
      return { error: `Esta canción ya sonó. Disponible de nuevo en ~${mins} min.` };
    }
    if (this.current?.track.id === track.id) {
      return { error: 'Esta canción está sonando ahora mismo.' };
    }
    if (this.queue.some((q) => q.track.id === track.id)) {
      return { error: 'Ya está en la cola.' };
    }

    const now = Date.now();
    const log = (this.enqueueLog.get(clientId) || []).filter((ts) => now - ts < ENQUEUE_WINDOW_MS);
    if (log.length >= ENQUEUE_MAX) {
      const waitMin = Math.ceil((ENQUEUE_WINDOW_MS - (now - log[0])) / 60000);
      return {
        error: `Ya agregaste ${ENQUEUE_MAX} canciones en ${ENQUEUE_WINDOW_MS / 60000} min. Espera ~${waitMin} min para agregar otra.`,
      };
    }
    log.push(now);
    this.enqueueLog.set(clientId, log);

    const item = { qid: crypto.randomUUID(), track, addedBy: client.name };
    this.queue.push(item);
    if (!this.current && !this.advancing) this.advance();
    else this.emitState();
    return { ok: true };
  }

  vote(clientId, value, expectedTrackId = null) {
    const client = this.clients.get(clientId);
    if (!client) return { error: 'Debes entrar primero.' };
    if (this.advancing) return { error: 'Cambiando de canción, intenta en un segundo.' };
    if (!this.current) return { error: 'Nada está sonando.' };
    if (expectedTrackId && this.current.track.id !== expectedTrackId) {
      return { error: 'La canción ya cambió.' };
    }
    if (value !== 1 && value !== -1 && value !== 0) return { error: 'Voto inválido.' };

    const prev = this.votes.get(clientId) || 0;
    if (prev === value) {
      return { ok: true, ...this.clientVoteState(clientId) };
    }

    const used = this.voteActions.get(clientId) || 0;
    if (used >= MAX_VOTES_PER_TRACK) {
      return {
        error: `Solo puedes votar hasta ${MAX_VOTES_PER_TRACK} veces por canción.`,
      };
    }
    this.voteActions.set(clientId, used + 1);

    if (value === 0) this.votes.delete(clientId);
    else this.votes.set(clientId, value);

    if (value !== 0) {
      this.broadcast({
        type: 'reaction',
        vote: value,
        ts: Date.now(),
      });
    }

    const stats = this.voteStats();
    const voteState = this.clientVoteState(clientId);
    if (stats.dislikes >= DISLIKES_TO_SKIP) {
      this.advance('skipped');
      return { ok: true, skipped: true, myVote: 0, votesUsed: 0, maxVotesPerTrack: MAX_VOTES_PER_TRACK };
    }
    this.emitState();
    return { ok: true, ...voteState };
  }

  cooldownIds() {
    const now = Date.now();
    const ids = new Set();
    for (const [id, ts] of this.lastPlayed) {
      if (now - ts < REPLAY_COOLDOWN_MS) ids.add(id);
    }
    for (const q of this.queue) ids.add(q.track.id);
    if (this.current) ids.add(this.current.track.id);
    return ids;
  }

  async syncCurrentPlayback() {
    if (!this.current?.track?.uri) return;
    const elapsed = Math.max(0, Date.now() - this.current.startedAt);
    const res = await playTrackOnHost(this.current.track, elapsed).catch((e) => ({
      ok: false,
      detail: e.message,
    }));
    if (!res.ok && res.reason !== 'host-not-connected') {
      console.warn('Spotify playback warning:', res);
    }
  }

  async advance(reason = 'ended') {
    if (this.advancing) return;
    this.advancing = true;
    clearTimeout(this.endTimer);
    const skippedTrack = this.current?.track;
    this.votes.clear();
    this.voteActions.clear();

    try {
      let next = this.queue.shift();
      let track = next?.track || null;
      let addedBy = next?.addedBy || null;

      if (!track) {
        track = await randomTrack(this.cooldownIds());
        addedBy = '🎲 Shuffle';
        // If someone enqueued a track while randomTrack was fetching, play their track first
        if (this.queue.length > 0) {
          const queued = this.queue.shift();
          track = queued.track;
          addedBy = queued.addedBy;
        }
      }

      if (!track) {
        this.current = null;
        this.emitState();
        return;
      }

      const durationMs = Math.max(15_000, track.durationMs || 180_000);
      this.current = {
        track,
        addedBy,
        startedAt: Date.now(),
        endsAt: Date.now() + durationMs,
        reason,
        skippedTrack: skippedTrack?.name || null,
      };
      this.lastPlayed.set(track.id, Date.now());
      this.endTimer = setTimeout(() => this.advance('ended'), durationMs);
      this.emitState();

      // Trigger full playback on connected Spotify Premium host
      this.syncCurrentPlayback();
    } finally {
      this.advancing = false;
    }
  }

  snapshot() {
    const stats = this.voteStats();
    return {
      type: 'state',
      now: Date.now(),
      provider: providerMode(),
      spotifyHost: getHostStatus(),
      dislikesToSkip: DISLIKES_TO_SKIP,
      cooldownMinutes: REPLAY_COOLDOWN_MS / 60000,
      maxVotesPerTrack: MAX_VOTES_PER_TRACK,
      current: this.current,
      likes: stats.likes,
      dislikes: stats.dislikes,
      score: stats.score,
      rawLikes: stats.rawLikes,
      rawDislikes: stats.rawDislikes,
      queue: this.queue,
      listeners: [...this.clients.values()].map((c) => ({ id: c.id, name: c.name })),
      listenerCount: this.clients.size,
    };
  }

  emitState() {
    this.broadcast(this.snapshot());
  }
}
