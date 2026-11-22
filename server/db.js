import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { IP_HASH_SALT } from './config.js';

export class MusicDB {
  constructor(dbPath = './data/music-hub.sqlite') {
    if (dbPath !== ':memory:') {
      const resolved = path.resolve(dbPath);
      const dir = path.dirname(resolved);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      try { fs.chmodSync(dir, 0o700); } catch { /* ignore on non-POSIX */ }
    }
    this.db = new DatabaseSync(dbPath);
    if (dbPath !== ':memory:') {
      try { fs.chmodSync(path.resolve(dbPath), 0o600); } catch { /* ignore */ }
    }
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 3000;');
    this.initSchema();
    this.ipSalt = IP_HASH_SALT || this.ensureSalt();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL,
        anonymous INTEGER NOT NULL DEFAULT 0,
        ip_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS track_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        added_by TEXT NOT NULL,
        added_by_emoji TEXT NOT NULL,
        track_id TEXT NOT NULL,
        track_name TEXT NOT NULL,
        artists TEXT NOT NULL,
        album TEXT NOT NULL,
        image_url TEXT,
        duration_ms INTEGER NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        likes INTEGER NOT NULL DEFAULT 0,
        dislikes INTEGER NOT NULL DEFAULT 0,
        requested_at INTEGER NOT NULL,
        played_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_history_requested ON track_history(requested_at DESC);
      CREATE INDEX IF NOT EXISTS idx_history_user ON track_history(user_id, requested_at DESC);
      CREATE INDEX IF NOT EXISTS idx_history_track ON track_history(track_id, played_at DESC);
      CREATE INDEX IF NOT EXISTS idx_users_ip ON users(ip_hash);
    `);
  }

  ensureSalt() {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('ip_salt');
    if (row?.value) return row.value;
    const salt = crypto.randomBytes(24).toString('hex');
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('ip_salt', salt);
    return salt;
  }

  pseudonymizeIp(ip) {
    return crypto
      .createHash('sha256')
      .update(`${this.ipSalt}:${ip || 'unknown'}`)
      .digest('hex')
      .slice(0, 24);
  }

  recordUser({ publicId, name, emoji, anonymous, ip }) {
    const now = Date.now();
    const ipHash = this.pseudonymizeIp(ip);
    this.db
      .prepare(`
        INSERT INTO users (id, name, emoji, anonymous, ip_hash, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          emoji = excluded.emoji,
          last_seen_at = excluded.last_seen_at
      `)
      .run(publicId, name, emoji, anonymous ? 1 : 0, ipHash, now, now);
    return ipHash;
  }

  recordTrackRequest({ userId, addedBy, addedByEmoji, track, status = 'queued' }) {
    const now = Date.now();
    const playedAt = status === 'playing' ? now : null;
    const info = this.db
      .prepare(`
        INSERT INTO track_history (
          user_id, added_by, added_by_emoji,
          track_id, track_name, artists, album, image_url, duration_ms, source,
          status, requested_at, played_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        userId || null,
        addedBy,
        addedByEmoji || '🎵',
        track.id,
        track.name,
        track.artists || '',
        track.album || '',
        track.imageUrl || null,
        track.durationMs || 180_000,
        track.source || 'demo',
        status,
        now,
        playedAt
      );
    return Number(info.lastInsertRowid);
  }

  markTrackPlaying(historyId) {
    if (!historyId) return;
    this.db
      .prepare('UPDATE track_history SET status = ?, played_at = ? WHERE id = ?')
      .run('playing', Date.now(), historyId);
  }

  updateTrackVotes(historyId, { likes, dislikes }) {
    if (!historyId) return;
    this.db
      .prepare('UPDATE track_history SET likes = ?, dislikes = ? WHERE id = ?')
      .run(likes || 0, dislikes || 0, historyId);
  }

  finalizeTrack(historyId, { status, likes, dislikes }) {
    if (!historyId) return;
    this.db
      .prepare('UPDATE track_history SET status = ?, likes = ?, dislikes = ? WHERE id = ?')
      .run(status, likes || 0, dislikes || 0, historyId);
  }

  deleteQueuedHistory(historyId) {
    if (!historyId) return;
    this.db
      .prepare("DELETE FROM track_history WHERE id = ? AND status = 'queued'")
      .run(historyId);
  }

  getRecentPlayedCooldowns(windowMs) {
    const cutoff = Date.now() - windowMs;
    const rows = this.db
      .prepare(`
        SELECT track_id, MAX(played_at) AS last_played
        FROM track_history
        WHERE played_at IS NOT NULL AND played_at > ?
        GROUP BY track_id
      `)
      .all(cutoff);
    const map = new Map();
    for (const r of rows) map.set(r.track_id, Number(r.last_played));
    return map;
  }

  getTopRequesters(limit = 3) {
    return this.db
      .prepare(`
        SELECT
          u.id,
          u.name,
          u.emoji,
          u.anonymous,
          COUNT(h.id) AS songCount,
          COALESCE(SUM(h.likes), 0) AS totalLikes,
          COALESCE(SUM(h.dislikes), 0) AS totalDislikes,
          MAX(h.requested_at) AS lastRequestedAt
        FROM users u
        JOIN track_history h ON h.user_id = u.id
        GROUP BY u.id
        ORDER BY songCount DESC, totalLikes DESC, lastRequestedAt DESC
        LIMIT ?
      `)
      .all(limit)
      .map((r) => ({
        id: r.id,
        name: r.name,
        emoji: r.emoji,
        anonymous: Boolean(r.anonymous),
        songCount: Number(r.songCount),
        totalLikes: Number(r.totalLikes),
        totalDislikes: Number(r.totalDislikes),
        lastRequestedAt: Number(r.lastRequestedAt),
      }));
  }

  getAllRequesters(limit = 100) {
    return this.getTopRequesters(limit);
  }

  formatHistoryRow(r) {
    return {
      id: Number(r.id),
      userId: r.user_id || null,
      addedBy: r.added_by,
      addedByEmoji: r.added_by_emoji,
      track: {
        id: r.track_id,
        name: r.track_name,
        artists: r.artists,
        album: r.album,
        imageUrl: r.image_url || null,
        durationMs: Number(r.duration_ms),
        source: r.source,
      },
      status: r.status,
      likes: Number(r.likes),
      dislikes: Number(r.dislikes),
      requestedAt: Number(r.requested_at),
      playedAt: r.played_at ? Number(r.played_at) : null,
    };
  }

  getFullHistory(limit = 150) {
    return this.db
      .prepare(`
        SELECT *
        FROM track_history
        ORDER BY requested_at DESC, id DESC
        LIMIT ?
      `)
      .all(limit)
      .map((r) => this.formatHistoryRow(r));
  }

  getHistoryByUser(userId, limit = 150) {
    const user = this.db
      .prepare(`
        SELECT
          u.id,
          u.name,
          u.emoji,
          u.anonymous,
          u.created_at,
          COUNT(h.id) AS songCount,
          COALESCE(SUM(h.likes), 0) AS totalLikes,
          COALESCE(SUM(h.dislikes), 0) AS totalDislikes
        FROM users u
        LEFT JOIN track_history h ON h.user_id = u.id
        WHERE u.id = ?
        GROUP BY u.id
      `)
      .get(userId);
    if (!user) return null;

    const history = this.db
      .prepare(`
        SELECT *
        FROM track_history
        WHERE user_id = ?
        ORDER BY requested_at DESC, id DESC
        LIMIT ?
      `)
      .all(userId, limit)
      .map((r) => this.formatHistoryRow(r));

    return {
      user: {
        id: user.id,
        name: user.name,
        emoji: user.emoji,
        anonymous: Boolean(user.anonymous),
        createdAt: Number(user.created_at),
        songCount: Number(user.songCount),
        totalLikes: Number(user.totalLikes),
        totalDislikes: Number(user.totalDislikes),
      },
      history,
    };
  }

  getTotals() {
    const row = this.db
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM track_history) AS totalTracks,
          (SELECT COUNT(DISTINCT user_id) FROM track_history WHERE user_id IS NOT NULL) AS totalRequesters
      `)
      .get();
    return {
      totalTracks: Number(row?.totalTracks || 0),
      totalRequesters: Number(row?.totalRequesters || 0),
    };
  }

  pruneRetention(retentionMs) {
    const cutoff = Date.now() - retentionMs;
    const h = this.db.prepare('DELETE FROM track_history WHERE requested_at < ?').run(cutoff);
    const u = this.db
      .prepare(`
        DELETE FROM users
        WHERE last_seen_at < ?
          AND id NOT IN (SELECT DISTINCT user_id FROM track_history WHERE user_id IS NOT NULL)
      `)
      .run(cutoff);
    try {
      this.db.exec('PRAGMA wal_checkpoint(PASSIVE);');
    } catch { /* ignore */ }
    return { deletedHistory: Number(h.changes || 0), deletedUsers: Number(u.changes || 0) };
  }

  close() {
    this.db.close();
  }
}
