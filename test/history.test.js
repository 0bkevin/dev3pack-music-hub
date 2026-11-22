import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MusicDB } from '../server/db.js';
import { Room } from '../server/state.js';
import { ALLOWED_EMOJIS, sanitizeEmoji } from '../server/sanitize.js';

function makeTrack(id, name) {
  return { id, name, artists: 'Artist', album: 'Album', durationMs: 180_000 };
}

describe('SQLite history persistence, user emojis, and Top 5 leaderboard', () => {
  it('enforces emoji allowlist and assigns predefined random emoji for anonymous users', () => {
    assert.equal(sanitizeEmoji('🔥'), '🔥');
    assert.ok(ALLOWED_EMOJIS.includes(sanitizeEmoji('<script>alert(1)</script>')));
    assert.ok(ALLOWED_EMOJIS.includes(sanitizeEmoji('💩')));

    const db = new MusicDB(':memory:');
    const room = new Room(() => {}, db);

    const named = room.join('Kevin', '🚀', '203.0.113.10');
    assert.equal(named.emoji, '🚀');
    assert.equal(named.anonymous, false);

    const anon = room.join(undefined, '🚀', '203.0.113.11');
    assert.equal(anon.anonymous, true);
    assert.ok(ALLOWED_EMOJIS.includes(anon.emoji));

    // Verify IP is stored pseudonymized (never raw IP in DB or public APIs)
    const row = db.db.prepare('SELECT id, name, emoji, ip_hash FROM users WHERE id = ?').get(named.publicId);
    assert.equal(row.name, 'Kevin');
    assert.equal(row.emoji, '🚀');
    assert.ok(row.ip_hash && !row.ip_hash.includes('203.0.113.10'));

    clearTimeout(room.endTimer);
    db.close();
  });

  it('tracks Top 5 requesters, full history, per-person history, and skips without leaking IPs', async () => {
    const db = new MusicDB(':memory:');
    const room = new Room(() => {}, db);

    const users = [
      room.join('Ana', '🎧', '198.51.100.1'),
      room.join('Luis', '🔥', '198.51.100.2'),
      room.join('Sofía', '⚡', '198.51.100.3'),
      room.join('Mateo', '🎸', '198.51.100.4'),
      room.join('Valeria', '🚀', '198.51.100.5'),
      room.join('Diego', '🦊', '198.51.100.6'),
    ];

    // Ana: 3 songs, Luis: 2, Sofía: 2, Mateo: 1, Valeria: 1, Diego: 1 (6 people -> Top 5 cap)
    room.enqueue(users[0].id, makeTrack('t-1', 'Song 1'));
    room.enqueue(users[0].id, makeTrack('t-2', 'Song 2'));
    room.enqueue(users[0].id, makeTrack('t-3', 'Song 3'));
    room.enqueue(users[1].id, makeTrack('t-4', 'Song 4'));
    room.enqueue(users[1].id, makeTrack('t-5', 'Song 5'));
    room.enqueue(users[2].id, makeTrack('t-6', 'Song 6'));
    room.enqueue(users[2].id, makeTrack('t-7', 'Song 7'));
    room.enqueue(users[3].id, makeTrack('t-8', 'Song 8'));
    room.enqueue(users[4].id, makeTrack('t-9', 'Song 9'));
    room.enqueue(users[5].id, makeTrack('t-10', 'Song 10'));

    await new Promise((r) => setTimeout(r, 20));

    // Skip current song with 5 dislikes and verify status + votes recorded in DB
    for (let i = 0; i < 5; i++) {
      room.vote(users[i].id, -1, 't-1');
    }
    await new Promise((r) => setTimeout(r, 20));

    const top5 = db.getTopRequesters(5);
    assert.equal(top5.length, 5);
    assert.equal(top5[0].name, 'Ana');
    assert.equal(top5[0].emoji, '🎧');
    assert.equal(top5[0].songCount, 3);
    assert.equal('ip_hash' in top5[0], false);

    const full = db.getFullHistory(50);
    assert.equal(full.length, 10);
    const t1 = full.find((r) => r.track.id === 't-1');
    assert.equal(t1.status, 'skipped');
    assert.equal(t1.dislikes, 5);
    assert.equal(t1.addedByEmoji, '🎧');

    const anaHist = db.getHistoryByUser(users[0].publicId);
    assert.equal(anaHist.user.name, 'Ana');
    assert.equal(anaHist.user.songCount, 3);
    assert.equal(anaHist.history.length, 3);
    assert.equal('ip_hash' in anaHist.user, false);

    // Restoring cooldowns on a fresh Room instance from the same SQLite DB works
    clearTimeout(room.endTimer);
    const room2 = new Room(() => {}, db);
    const u2 = room2.join('RestartUser', '🎹', '198.51.100.9');
    const replay = room2.enqueue(u2.id, makeTrack('t-1', 'Song 1'));
    assert.match(replay.error, /ya sonó/i);

    clearTimeout(room2.endTimer);
    db.close();
  });
});
