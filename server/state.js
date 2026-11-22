import crypto from 'node:crypto';
import {
  DISLIKES_TO_SKIP,
  REPLAY_COOLDOWN_MS,
  ENQUEUE_MAX,
  ENQUEUE_WINDOW_MS,
  MAX_VOTES_PER_TRACK,
  MAX_QUEUE_SIZE,
  MAX_CLIENTS,
} from './config.js';
import { MIN_DURATION_MS, MAX_DURATION_MS, sanitizeTrack } from './sanitize.js';
import { randomTrack, providerMode, playTrackOnHost, getPublicHostStatus } from './spotify.js';

export { sanitizeTrack };

const ANON_NAMES = [
  'Anónimo Cósmico', 'Hacker Fantasma', 'Nómada Neon', 'Builder Incógnito',
  'Wanderer Solana', 'Shadow Validator', 'Miembro Misterioso', 'Agente 3030',
];

export class Room {
  constructor(broadcast) {
    this.broadcast = broadcast;
    this.clients = new Map();        // clientToken -> { id, publicId, name, anonymous, joinedAt }
    this.queue = [];                 // [{ qid, track, addedBy }]
    this.current = null;             // { track, addedBy, startedAt, endsAt }
    this.votes = new Map();          // clientToken -> 1 | -1
    this.voteActions = new Map();    // clientToken -> count of vote actions on current track
    this.lastPlayed = new Map();     // trackId -> timestamp when it last started
    this.enqueueLog = new Map();     // clientToken -> [timestamps]
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

  clientVoteState(clientToken) {
    return {
      type: 'you',
      myVote: this.votes.get(clientToken) || 0,
      votesUsed: this.voteActions.get(clientToken) || 0,
      maxVotesPerTrack: MAX_VOTES_PER_TRACK,
    };
  }

  pruneExpired() {
    const now = Date.now();
    for (const [trackId, ts] of this.lastPlayed) {
      if (now - ts >= REPLAY_COOLDOWN_MS) this.lastPlayed.delete(trackId);
    }
    for (const [clientId, log] of this.enqueueLog) {
      const fresh = log.filter((ts) => now - ts < ENQUEUE_WINDOW_MS);
      if (fresh.length === 0) this.enqueueLog.delete(clientId);
      else this.enqueueLog.set(clientId, fresh);
    }
  }

  join(name) {
    if (this.clients.size >= MAX_CLIENTS) {
      return { error: 'La sala alcanzó su capacidad máxima.' };
    }
    const id = crypto.randomBytes(24).toString('hex');
    const publicId = crypto.randomBytes(8).toString('hex');
    const clean = typeof name === 'string'
      ? name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 24)
      : '';
    const anon = !clean;
    const finalName = anon
      ? `${ANON_NAMES[Math.floor(Math.random() * ANON_NAMES.length)]} #${publicId.slice(0, 4)}`
      : clean;
    const client = { id, publicId, name: finalName, anonymous: anon, joinedAt: Date.now() };
    this.clients.set(id, client);
    this.emitState();
    return client;
  }

  leave(id) {
    if (!this.clients.delete(id)) return;
    const hadVote = this.votes.delete(id);
    this.voteActions.delete(id);
    this.enqueueLog.delete(id);
    if (hadVote && this.current && !this.advancing && this.voteStats().dislikes >= DISLIKES_TO_SKIP) {
      this.advance('skipped').catch((err) => console.error('advance error:', err));
    } else {
      this.emitState();
    }
  }

  enqueue(clientId, rawTrack) {
    if (typeof clientId !== 'string') return { error: 'Debes entrar primero.' };
    const client = this.clients.get(clientId);
    if (!client) return { error: 'Debes entrar primero.' };

    const track = sanitizeTrack(rawTrack);
    if (!track) return { error: 'Track inválido.' };
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      return { error: `La cola está llena (máx. ${MAX_QUEUE_SIZE} canciones).` };
    }

    const now = Date.now();
    const last = this.lastPlayed.get(track.id);
    if (last && now - last < REPLAY_COOLDOWN_MS) {
      const mins = Math.ceil((REPLAY_COOLDOWN_MS - (now - last)) / 60000);
      return { error: `Esta canción ya sonó. Disponible de nuevo en ~${mins} min.` };
    }
    if (this.current?.track.id === track.id) return { error: 'Esta canción está sonando ahora mismo.' };
    if (this.queue.some((q) => q.track.id === track.id)) return { error: 'Ya está en la cola.' };

    const log = (this.enqueueLog.get(clientId) || []).filter((ts) => now - ts < ENQUEUE_WINDOW_MS);
    if (log.length >= ENQUEUE_MAX) {
      const waitMin = Math.ceil((ENQUEUE_WINDOW_MS - (now - log[0])) / 60000);
      return {
        error: `Ya agregaste ${ENQUEUE_MAX} canciones en ${ENQUEUE_WINDOW_MS / 60000} min. Espera ~${waitMin} min para agregar otra.`,
      };
    }
    log.push(now);
    this.enqueueLog.set(clientId, log);

    this.queue.push({ qid: crypto.randomUUID(), track, addedBy: client.name });
    if (!this.current && !this.advancing) {
      this.advance().catch((err) => console.error('advance error:', err));
    } else {
      this.emitState();
    }
    return { ok: true };
  }

  vote(clientId, value, expectedTrackId = null) {
    if (typeof clientId !== 'string') return { error: 'Debes entrar primero.' };
    const client = this.clients.get(clientId);
    if (!client) return { error: 'Debes entrar primero.' };
    if (this.advancing) return { error: 'Cambiando de canción, intenta en un segundo.' };
    if (!this.current) return { error: 'Nada está sonando.' };
    if (expectedTrackId && this.current.track.id !== expectedTrackId) {
      return { error: 'La canción ya cambió.' };
    }
    if (value !== 1 && value !== -1 && value !== 0) return { error: 'Voto inválido.' };

    const prev = this.votes.get(clientId) || 0;
    if (prev === value) return { ok: true, ...this.clientVoteState(clientId) };

    const used = this.voteActions.get(clientId) || 0;
    if (used >= MAX_VOTES_PER_TRACK) {
      return { error: `Solo puedes votar hasta ${MAX_VOTES_PER_TRACK} veces por canción.` };
    }
    this.voteActions.set(clientId, used + 1);

    if (value === 0) this.votes.delete(clientId);
    else this.votes.set(clientId, value);

    if (value !== 0) this.broadcast({ type: 'reaction', vote: value, ts: Date.now() });

    const stats = this.voteStats();
    const voteState = this.clientVoteState(clientId);
    if (stats.dislikes >= DISLIKES_TO_SKIP) {
      this.advance('skipped').catch((err) => console.error('advance error:', err));
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
    this.pruneExpired();

    try {
      let next = this.queue.shift();
      let track = next?.track || null;
      let addedBy = next?.addedBy || null;

      if (!track) {
        try {
          const picked = await randomTrack(this.cooldownIds());
          track = picked ? sanitizeTrack(picked) : null;
          addedBy = '🎲 Shuffle';
        } catch (err) {
          console.error('randomTrack error:', err.message);
          track = null;
        }
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

      const durationMs = Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, track.durationMs || 180_000));
      this.current = {
        track,
        addedBy,
        startedAt: Date.now(),
        endsAt: Date.now() + durationMs,
        reason,
        skippedTrack: skippedTrack?.name || null,
      };
      this.lastPlayed.set(track.id, Date.now());
      this.endTimer = setTimeout(() => {
        this.advance('ended').catch((err) => console.error('advance timer error:', err));
      }, durationMs);
      this.emitState();
      this.syncCurrentPlayback();
    } finally {
      this.advancing = false;
    }
  }

  snapshot() {
    const stats = this.voteStats();
    return {
      type: 'state',
      provider: providerMode(),
      spotifyHost: getPublicHostStatus(),
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
      listeners: [...this.clients.values()].map((c) => ({ id: c.publicId, name: c.name })),
      listenerCount: this.clients.size,
    };
  }

  emitState() {
    this.broadcast(this.snapshot());
  }
}
