import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/state.js';

function makeTrack(id, name = `Track ${id}`, durationMs = 180_000) {
  return { id, uri: null, name, artists: 'Artist', album: 'Album', durationMs, imageUrl: null, source: 'demo' };
}

function createTestRoom() {
  const events = [];
  const room = new Room((msg) => events.push(msg));
  return { room, events };
}

describe('Room net voting, limits, and adversarial edge cases', () => {
  it('cancels likes and dislikes bidirectionally', () => {
    const { room } = createTestRoom();
    const host = room.join('Host').id;
    room.enqueue(host, makeTrack('t1'));

    const u = Array.from({ length: 8 }, (_, i) => room.join(`U${i}`).id);
    room.vote(u[0], 1);
    room.vote(u[1], 1);
    assert.equal(room.snapshot().likes, 2);
    assert.equal(room.snapshot().dislikes, 0);

    room.vote(u[2], -1);
    assert.equal(room.snapshot().likes, 1);
    assert.equal(room.snapshot().dislikes, 0);

    room.vote(u[3], -1);
    assert.equal(room.snapshot().likes, 0);
    assert.equal(room.snapshot().dislikes, 0);

    room.vote(u[4], -1);
    room.vote(u[5], -1);
    room.vote(u[6], -1);
    assert.equal(room.snapshot().dislikes, 3);

    room.vote(u[7], 1);
    assert.equal(room.snapshot().dislikes, 2);
    clearTimeout(room.endTimer);
  });

  it('shields against skip with likes and skips at exact net-5 dislikes', () => {
    const { room } = createTestRoom();
    const host = room.join('Host').id;
    room.enqueue(host, makeTrack('t1'));
    room.enqueue(host, makeTrack('t2'));

    const likers = [room.join('L1').id, room.join('L2').id];
    const dislikers = Array.from({ length: 7 }, (_, i) => room.join(`D${i}`).id);

    for (const id of likers) room.vote(id, 1);
    for (let i = 0; i < 6; i++) room.vote(dislikers[i], -1);
    // 6 raw dislikes - 2 likes = 4 net dislikes -> must NOT skip
    assert.equal(room.current.track.id, 't1');
    assert.equal(room.snapshot().dislikes, 4);

    // 7th dislike -> 5 net dislikes -> skips to t2
    const res = room.vote(dislikers[6], -1);
    assert.equal(res.skipped, true);
    assert.equal(room.current.track.id, 't2');
    assert.equal(room.snapshot().likes, 0);
    assert.equal(room.snapshot().dislikes, 0);
    clearTimeout(room.endTimer);
  });

  it('triggers skip on -2 swing when a liker flips to dislike', () => {
    const { room } = createTestRoom();
    const host = room.join('Host').id;
    room.enqueue(host, makeTrack('t1'));
    room.enqueue(host, makeTrack('t2'));

    const flipper = room.join('Flip').id;
    room.vote(flipper, 1);
    for (let i = 0; i < 4; i++) room.vote(room.join(`D${i}`).id, -1);
    assert.equal(room.snapshot().dislikes, 3);
    assert.equal(room.current.track.id, 't1');

    room.vote(flipper, -1);
    assert.equal(room.current.track.id, 't2');
    clearTimeout(room.endTimer);
  });

  it('re-evaluates skip threshold when a liker leaves the room', () => {
    const { room } = createTestRoom();
    const host = room.join('Host').id;
    room.enqueue(host, makeTrack('t1'));
    room.enqueue(host, makeTrack('t2'));

    const liker = room.join('Liker').id;
    room.vote(liker, 1);
    for (let i = 0; i < 5; i++) room.vote(room.join(`D${i}`).id, -1);
    assert.equal(room.snapshot().dislikes, 4);
    assert.equal(room.current.track.id, 't1');

    room.leave(liker);
    assert.equal(room.current.track.id, 't2');
    clearTimeout(room.endTimer);
  });

  it('blocks stale votes targeting an already-skipped track via trackId guard', () => {
    const { room } = createTestRoom();
    const host = room.join('Host').id;
    room.enqueue(host, makeTrack('t1'));
    room.enqueue(host, makeTrack('t2'));

    for (let i = 0; i < 4; i++) room.vote(room.join(`D${i}`).id, -1, 't1');
    const r1 = room.join('R1').id;
    const r2 = room.join('R2').id;

    assert.equal(room.vote(r1, -1, 't1').skipped, true);
    const late = room.vote(r2, -1, 't1');
    assert.ok(late.error);
    assert.equal(room.current.track.id, 't2');
    assert.equal(room.snapshot().dislikes, 0);
    clearTimeout(room.endTimer);
  });

  it('enforces max vote actions per song, idempotency, and anonymous reactions', () => {
    const { room, events } = createTestRoom();
    const u = room.join('Kevin').id;
    room.enqueue(u, makeTrack('t1'));

    assert.equal(room.vote(u, 1).ok, true);
    assert.equal(room.vote(u, 1).ok, true); // idempotent no-op
    assert.equal(room.vote(u, -1).ok, true);
    assert.ok(room.vote(u, 1).error); // 3rd action blocked

    const rx = events.filter((e) => e.type === 'reaction');
    assert.equal(rx.length, 2);
    for (const e of rx) {
      assert.equal('name' in e, false);
      assert.equal('clientId' in e, false);
    }
    clearTimeout(room.endTimer);
  });

  it('enforces 3-songs-per-10-min limit and 30-min replay cooldown', () => {
    const { room } = createTestRoom();
    const u = room.join('Kevin').id;
    assert.equal(room.enqueue(u, makeTrack('t1')).ok, true);
    assert.equal(room.enqueue(u, makeTrack('t2')).ok, true);
    assert.equal(room.enqueue(u, makeTrack('t3')).ok, true);
    assert.ok(room.enqueue(u, makeTrack('t4')).error);

    // Another user can still enqueue t4
    const u2 = room.join('Ana').id;
    assert.equal(room.enqueue(u2, makeTrack('t4')).ok, true);
    // Re-enqueueing t1 (already played) is blocked by 30m cooldown
    room.advance('ended');
    assert.ok(room.enqueue(u2, makeTrack('t1')).error);
    clearTimeout(room.endTimer);
  });

  it('rejects malformed vote payloads', () => {
    const { room } = createTestRoom();
    const u = room.join('U').id;
    assert.ok(room.vote(u, 1).error); // nothing playing
    room.enqueue(u, makeTrack('t1'));

    for (const bad of ['1', 2, -2, null, undefined, {}, [], 0.5, NaN]) {
      assert.ok(room.vote(u, bad).error);
    }
    clearTimeout(room.endTimer);
  });
});
