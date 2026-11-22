import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MusicDB } from '../server/db.js';
import { Room } from '../server/state.js';

function makeTrack(id, name, durationMs = 180_000) {
  return { id, name, artists: 'Artist', album: 'Album', durationMs };
}

describe('Fair round-robin queue, max duration rejection, unlimited queue, and cancel/refund', () => {
  it('rejects tracks longer than 7 minutes with a clear error message', () => {
    const room = new Room(() => {});
    const u = room.join('Kevin', '🚀');

    const tooLong = room.enqueue(u.id, makeTrack('long-1', '10 Min Mix', 10 * 60_000));
    assert.match(tooLong.error, /7 min/i);
    assert.equal(room.queue.length, 0);
    assert.equal(room.current, null);

    // Exactly 7 minutes is allowed
    const ok7 = room.enqueue(u.id, makeTrack('ok-7', 'Seven Min', 7 * 60_000));
    assert.equal(ok7.ok, true);

    clearTimeout(room.endTimer);
  });

  it('interleaves queued tracks fairly by participant (round-robin)', async () => {
    const room = new Room(() => {});
    const kevin = room.join('Kevin', '🚀');
    const sofia = room.join('Sofía', '🎧');
    const mateo = room.join('Mateo', '🔥');

    // Kevin enqueues 3 tracks: K1 plays immediately, K2 & K3 wait
    room.enqueue(kevin.id, makeTrack('k1', 'K1'));
    await new Promise((r) => setTimeout(r, 15));
    room.enqueue(kevin.id, makeTrack('k2', 'K2'));
    room.enqueue(kevin.id, makeTrack('k3', 'K3'));

    // Sofía adds S1, S2 -> Sofía goes BEFORE Kevin's second track because Kevin is playing now
    room.enqueue(sofia.id, makeTrack('s1', 'S1'));
    room.enqueue(sofia.id, makeTrack('s2', 'S2'));

    // Mateo adds M1 -> Queue should be [S1, M1, K2, S2, K3]
    room.enqueue(mateo.id, makeTrack('m1', 'M1'));

    assert.deepEqual(
      room.queue.map((q) => q.track.id),
      ['s1', 'm1', 'k2', 's2', 'k3']
    );

    clearTimeout(room.endTimer);
  });

  it('allows canceling own queued song, refunds quota slot, removes SQLite queued row, and blocks canceling others', async () => {
    const db = new MusicDB(':memory:');
    const room = new Room(() => {}, db);
    const kevin = room.join('Kevin', '🚀');
    const sofia = room.join('Sofía', '🎧');

    // Kevin uses all 3 slots (k1 plays, k2 & k3 queued)
    room.enqueue(kevin.id, makeTrack('k1', 'K1'));
    await new Promise((r) => setTimeout(r, 15));
    room.enqueue(kevin.id, makeTrack('k2', 'K2'));
    room.enqueue(kevin.id, makeTrack('k3', 'K3'));

    // 4th song rejected by 3/10min limit
    assert.match(room.enqueue(kevin.id, makeTrack('k4', 'K4')).error, /3 canciones/);

    const k3Item = room.queue.find((q) => q.track.id === 'k3');
    assert.ok(k3Item);

    // Sofía cannot cancel Kevin's song
    const hijack = room.cancelQueued(sofia.id, k3Item.qid);
    assert.match(hijack.error, /propias canciones/i);
    assert.equal(room.queue.length, 2);

    // Kevin cancels his own k3 -> removed from queue, deleted from SQLite history, quota refunded!
    const canceled = room.cancelQueued(kevin.id, k3Item.qid);
    assert.equal(canceled.ok, true);
    assert.equal(room.queue.length, 1);

    const histIds = db.getFullHistory(20).map((r) => r.track.id);
    assert.equal(histIds.includes('k3'), false, 'Canceled queued track should be removed from history');

    // Because quota was refunded, Kevin can immediately enqueue K4!
    assert.equal(room.enqueue(kevin.id, makeTrack('k4', 'K4')).ok, true);
    assert.equal(room.queue.some((q) => q.track.id === 'k4'), true);

    clearTimeout(room.endTimer);
    db.close();
  });

  it('has no artificial 50-song global queue cap', async () => {
    const room = new Room(() => {});
    for (let i = 0; i < 20; i++) {
      const u = room.join(`User${i}`, '🎵');
      for (let j = 0; j < 3; j++) {
        const res = room.enqueue(u.id, makeTrack(`t-${i}-${j}`, `Track ${i}-${j}`));
        assert.equal(res.ok, true);
      }
    }
    await new Promise((r) => setTimeout(r, 15));
    // 60 tracks total: 1 playing + 59 queued (> 50!)
    assert.equal(room.queue.length, 59);
    clearTimeout(room.endTimer);
  });
});
