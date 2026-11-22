import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Room, sanitizeTrack } from '../server/state.js';

describe('Security hardening & adversarial input sanitization', () => {
  it('blocks forged track IDs, CSS-injection imageUrls, extreme durations, and invalid URIs', () => {
    // Non-string / object / injection IDs rejected
    assert.equal(sanitizeTrack({ id: { toString: () => 'x' }, name: 'Song' }), null);
    assert.equal(sanitizeTrack({ id: ['a'], name: 'Song' }), null);
    assert.equal(sanitizeTrack({ id: 'bad id with spaces', name: 'Song' }), null);
    assert.equal(sanitizeTrack({ id: '', name: 'Song' }), null);

    // Extreme durations clamped safely (prevents 24h freeze and 2^31 setTimeout overflow)
    const huge = sanitizeTrack({ id: 't-huge', name: 'Huge', durationMs: 999_999_999_999 });
    assert.equal(huge.durationMs, 10 * 60_000);
    const tiny = sanitizeTrack({ id: 't-tiny', name: 'Tiny', durationMs: -500 });
    assert.equal(tiny.durationMs, 15_000);
    const nanDur = sanitizeTrack({ id: 't-nan', name: 'NaN', durationMs: Number.NaN });
    assert.equal(nanDur.durationMs, 180_000);

    // CSS injection & untrusted image hosts stripped to null
    const cssInject = sanitizeTrack({
      id: 't-css',
      name: 'CSS',
      imageUrl: 'https://i.scdn.co/image/abc");background:url(https://evil.test/steal)',
    });
    assert.equal(cssInject.imageUrl, null);

    const evilHost = sanitizeTrack({
      id: 't-evil',
      name: 'Evil',
      imageUrl: 'https://evil.example/pixel.png',
    });
    assert.equal(evilHost.imageUrl, null);

    const jsUrl = sanitizeTrack({
      id: 't-js',
      name: 'JS',
      imageUrl: 'javascript:alert(1)',
    });
    assert.equal(jsUrl.imageUrl, null);

    // Legitimate Spotify CDN image allowed
    const goodImg = sanitizeTrack({
      id: 't-ok',
      name: 'OK',
      imageUrl: 'https://i.scdn.co/image/ab67616d0000b2731234567890abcdef',
    });
    assert.equal(goodImg.imageUrl, 'https://i.scdn.co/image/ab67616d0000b2731234567890abcdef');

    // Arbitrary Spotify URIs (episodes/playlists) rejected; valid track URI accepted
    const ep = sanitizeTrack({ id: 't-ep', name: 'Ep', uri: 'spotify:episode:1234567890123456789012' });
    assert.equal(ep.uri, null);
    const validUri = sanitizeTrack({ id: 't-tr', name: 'Tr', uri: 'spotify:track:1234567890123456789012' });
    assert.equal(validUri.uri, 'spotify:track:1234567890123456789012');

    // Unknown extra properties stripped (prevents broadcast amplification)
    const bloated = sanitizeTrack({ id: 't-bloat', name: 'Clean', evilBlob: 'x'.repeat(50_000) });
    assert.equal('evilBlob' in bloated, false);
  });

  it('never leaks private client tokens in public room snapshots and blocks impersonation', () => {
    const room = new Room(() => {});
    const alice = room.join('Alice');
    const bob = room.join('Bob');

    const snap = room.snapshot();
    assert.equal(snap.listeners.length, 2);

    const publicIds = snap.listeners.map((l) => l.id);
    assert.ok(publicIds.includes(alice.publicId));
    assert.ok(!publicIds.includes(alice.id), 'Private clientId must never appear in snapshot');
    assert.ok(!publicIds.includes(bob.id), 'Private clientId must never appear in snapshot');

    // Attacker trying to use Alice's publicId to enqueue, vote, or kick fails
    room.enqueue(alice.id, { id: 't1', name: 'Song 1', durationMs: 120_000 });
    assert.ok(room.enqueue(alice.publicId, { id: 't2', name: 'Spoof' }).error);
    assert.ok(room.vote(alice.publicId, -1).error);

    // Calling leave with publicId does NOT kick Alice
    room.leave(alice.publicId);
    assert.equal(room.clients.has(alice.id), true);

    clearTimeout(room.endTimer);
  });

  it('cleans up enqueueLog on leave and never leaks sensitive host details in snapshot', () => {
    const room = new Room(() => {});
    const u = room.join('Temp');
    room.enqueue(u.id, { id: 't1', name: 'Song 1', durationMs: 120_000 });
    assert.equal(room.enqueueLog.has(u.id), true);

    room.leave(u.id);
    assert.equal(room.enqueueLog.has(u.id), false);

    const snap = room.snapshot();
    assert.equal('redirectUri' in snap.spotifyHost, false);
    assert.equal('user' in snap.spotifyHost, false);
    assert.equal('accessToken' in snap.spotifyHost, false);
    assert.equal('refreshToken' in snap.spotifyHost, false);
    assert.equal('sessionToken' in snap.spotifyHost, false);
    clearTimeout(room.endTimer);
  });
});
