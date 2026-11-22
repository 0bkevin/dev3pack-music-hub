import crypto from 'node:crypto';
import {
  DISLIKES_TO_SKIP,
  REPLAY_COOLDOWN_MS,
  ENQUEUE_MAX,
  ENQUEUE_WINDOW_MS,
  MAX_TRACK_MINUTES,
  MAX_TRACK_DURATION_MS,
  MAX_VOTES_PER_TRACK,
  MAX_CLIENTS,
} from './config.js';
import {
  MIN_DURATION_MS,
  MAX_DURATION_MS,
  sanitizeTrack,
  sanitizeEmoji,
  randomEmoji,
  validateDisplayName,
} from './sanitize.js';
import { randomTrack, providerMode, playTrackOnHost, getPublicHostStatus } from './spotify.js';

export { sanitizeTrack };

const ANON_NAMES = [
  'Anónimo Cósmico', 'Hacker Fantasma', 'Nómada Neon', 'Builder Incógnito',
  'Wanderer Solana', 'Shadow Validator', 'Miembro Misterioso', 'Agente 3030',
];

export class Room {
  constructor(broadcast, db = null) {
    this.broadcast = broadcast;
    this.db = db;
    this.clients = new Map();        // clientToken -> { id, publicId, name, emoji, anonymous, joinedAt }
    this.queue = [];                 // [{ qid, track, addedBy, addedByEmoji, userId, historyId }]
    this.current = null;             // { track, addedBy, addedByEmoji, userId, historyId, startedAt, endsAt }
    this.votes = new Map();          // clientToken -> 1 | -1
    this.voteActions = new Map();    // clientToken -> count of vote actions on current track
    this.lastPlayed = db ? db.getRecentPlayedCooldowns(REPLAY_COOLDOWN_MS) : new Map();
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

  join(name, rawEmoji = null, ip = '') {
    if (this.clients.size >= MAX_CLIENTS) {
      return { error: 'La sala alcanzó su capacidad máxima.', status: 503 };
    }
    const checked = validateDisplayName(name);
    if (checked.error) {
      return { error: checked.error, code: 'invalid_name', status: 400 };
    }
    const anon = checked.anonymous;
    const clean = checked.name;

    if (!anon) {
      const lower = clean.toLowerCase();
      const takenActive = [...this.clients.values()].some(
        (c) => !c.anonymous && c.name.toLowerCase() === lower
      );
      if (takenActive || this.db?.isNameTaken(clean)) {
        return {
          error: `El nombre «${clean}» ya está en uso. Elige otro nombre o agrega tu apellido.`,
          code: 'name_taken',
          status: 409,
        };
      }
    }

    const id = crypto.randomBytes(24).toString('hex');
    const publicId = crypto.randomBytes(8).toString('hex');
    const finalName = anon
      ? `${ANON_NAMES[Math.floor(Math.random() * ANON_NAMES.length)]} #${publicId.slice(0, 4)}`
      : clean;
    const emoji = anon ? randomEmoji() : sanitizeEmoji(rawEmoji);
    const client = { id, publicId, name: finalName, emoji, anonymous: anon, joinedAt: Date.now() };
    this.clients.set(id, client);
    this.db?.recordUser({ publicId, name: finalName, emoji, anonymous: anon, ip });
    this.emitState();
    return client;
  }

  leave(id) {
    if (!this.clients.delete(id)) return;
    const hadVote = this.votes.delete(id);
    this.voteActions.delete(id);
    this.enqueueLog.delete(id);
    if (hadVote && this.current) {
      const stats = this.voteStats();
      if (this.current.historyId) this.db?.updateTrackVotes(this.current.historyId, stats);
      if (!this.advancing && stats.dislikes >= DISLIKES_TO_SKIP) {
        this.advance('skipped').catch((err) => console.error('advance error:', err));
        return;
      }
    }
    this.emitState();
  }

  reorderFairQueue() {
    if (this.queue.length <= 1) return;
    // Sort chronologically first so each person's songs keep their exact request order
    const ordered = [...this.queue].sort((a, b) => (a.seq || 0) - (b.seq || 0));
    const buckets = new Map(); // userId -> [items]
    for (const item of ordered) {
      const key = item.userId || item.qid;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    }

    // If the currently playing song's requester also has songs waiting, move them behind
    // other waiting users for the first round so nobody plays twice in a row.
    const activeUserId = this.current?.userId;
    const keys = [...buckets.keys()];
    if (activeUserId && buckets.has(activeUserId) && keys.length > 1) {
      const idx = keys.indexOf(activeUserId);
      keys.splice(idx, 1);
      keys.push(activeUserId);
    }

    const interleaved = [];
    let round = 0;
    while (interleaved.length < ordered.length) {
      for (const k of keys) {
        const list = buckets.get(k);
        if (round < list.length) interleaved.push(list[round]);
      }
      round++;
    }
    this.queue = interleaved;
  }

  enqueue(clientId, rawTrack) {
    if (typeof clientId !== 'string') return { error: 'Debes entrar primero.' };
    const client = this.clients.get(clientId);
    if (!client) return { error: 'Debes entrar primero.' };

    if (
      rawTrack &&
      typeof rawTrack === 'object' &&
      typeof rawTrack.durationMs === 'number' &&
      Number.isFinite(rawTrack.durationMs) &&
      rawTrack.durationMs > MAX_TRACK_DURATION_MS
    ) {
      return { error: `Esta canción dura más de ${MAX_TRACK_MINUTES} min. Elige una más corta.` };
    }

    const track = sanitizeTrack(rawTrack);
    if (!track) return { error: 'Track inválido.' };

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

    const historyId = this.db
      ? this.db.recordTrackRequest({
          userId: client.publicId,
          addedBy: client.name,
          addedByEmoji: client.emoji,
          track,
          status: 'queued',
        })
      : null;

    this.queueSeq = (this.queueSeq || 0) + 1;
    this.queue.push({
      qid: crypto.randomUUID(),
      seq: this.queueSeq,
      track,
      addedBy: client.name,
      addedByEmoji: client.emoji,
      userId: client.publicId,
      historyId,
    });
    this.reorderFairQueue();

    if (!this.current && !this.advancing) {
      this.advance().catch((err) => console.error('advance error:', err));
    } else {
      this.emitState();
    }
    return { ok: true };
  }

  cancelQueued(clientId, qid) {
    if (typeof clientId !== 'string') return { error: 'Debes entrar primero.' };
    const client = this.clients.get(clientId);
    if (!client) return { error: 'Debes entrar primero.' };
    if (typeof qid !== 'string' || !qid) return { error: 'Canción inválida.' };

    const idx = this.queue.findIndex((q) => q.qid === qid);
    if (idx === -1) return { error: 'Esta canción ya no está en la cola.' };

    const item = this.queue[idx];
    if (item.userId !== client.publicId) {
      return { error: 'Solo puedes quitar tus propias canciones de la cola.' };
    }

    this.queue.splice(idx, 1);
    this.reorderFairQueue();

    // Refund 1 enqueue slot so the participant can pick another song
    const now = Date.now();
    const log = (this.enqueueLog.get(clientId) || []).filter((ts) => now - ts < ENQUEUE_WINDOW_MS);
    if (log.length > 0) {
      log.pop();
      if (log.length === 0) this.enqueueLog.delete(clientId);
      else this.enqueueLog.set(clientId, log);
    }

    if (item.historyId) this.db?.deleteQueuedHistory(item.historyId);
    this.emitState();
    return { ok: true, removed: item.track.name };
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
    if (this.current.historyId) this.db?.updateTrackVotes(this.current.historyId, stats);
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
    const prevCurrent = this.current;
    const prevStats = this.voteStats();
    const skippedTrack = prevCurrent?.track;

    if (prevCurrent?.historyId && this.db) {
      this.db.finalizeTrack(prevCurrent.historyId, {
        status: reason === 'skipped' ? 'skipped' : 'played',
        likes: prevStats.likes,
        dislikes: prevStats.dislikes,
      });
    }

    this.votes.clear();
    this.voteActions.clear();
    this.pruneExpired();

    try {
      let next = this.queue.shift();
      let track = next?.track || null;
      let addedBy = next?.addedBy || null;
      let addedByEmoji = next?.addedByEmoji || '🎵';
      let userId = next?.userId || null;
      let historyId = next?.historyId || null;

      if (!track) {
        try {
          const picked = await randomTrack(this.cooldownIds());
          track = picked ? sanitizeTrack(picked) : null;
          addedBy = 'Shuffle';
          addedByEmoji = '🎲';
          userId = null;
        } catch (err) {
          console.error('randomTrack error:', err.message);
          track = null;
        }
        if (this.queue.length > 0) {
          const queued = this.queue.shift();
          track = queued.track;
          addedBy = queued.addedBy;
          addedByEmoji = queued.addedByEmoji || '🎵';
          userId = queued.userId || null;
          historyId = queued.historyId || null;
        }
      }

      if (!track) {
        this.current = null;
        this.emitState();
        return;
      }

      if (historyId) {
        this.db?.markTrackPlaying(historyId);
      } else if (this.db) {
        historyId = this.db.recordTrackRequest({
          userId: null,
          addedBy,
          addedByEmoji,
          track,
          status: 'playing',
        });
      }

      const durationMs = Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, track.durationMs || 180_000));
      this.current = {
        track,
        addedBy,
        addedByEmoji,
        userId,
        historyId,
        startedAt: Date.now(),
        endsAt: Date.now() + durationMs,
        reason,
        skippedTrack: skippedTrack?.name || null,
      };
      this.reorderFairQueue();
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
      listeners: [...this.clients.values()].map((c) => ({ id: c.publicId, name: c.name, emoji: c.emoji })),
      listenerCount: this.clients.size,
    };
  }

  emitState() {
    this.broadcast(this.snapshot());
  }
}
