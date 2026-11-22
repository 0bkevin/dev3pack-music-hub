import { Router } from 'express';
import { JOIN_RATE_MAX, SEARCH_RATE_MAX, MUTATE_RATE_MAX } from '../config.js';
import { searchTracks, providerMode } from '../spotify.js';
import { auditLog, hashIp, makeIpLimiter } from '../security.js';

export function createRoomRouter(room, wsHub) {
  const router = Router();
  const joinLimiter = makeIpLimiter(JOIN_RATE_MAX, 10 * 60_000, 'join');
  const searchLimiter = makeIpLimiter(SEARCH_RATE_MAX, 60_000, 'search');
  const mutateLimiter = makeIpLimiter(MUTATE_RATE_MAX, 60_000, 'mutate');
  const leaveLimiter = makeIpLimiter(60, 60_000, 'leave');

  router.post('/join', joinLimiter, (req, res) => {
    const ip = req.ip || req.socket?.remoteAddress || '';
    const client = room.join(req.body?.name, req.body?.emoji, ip);
    if (client.error) return res.status(client.status || 400).json({ error: client.error, code: client.code });
    auditLog('room.join', { ipHash: hashIp(ip), publicId: client.publicId, anonymous: client.anonymous });
    res.json({
      clientId: client.id,
      publicId: client.publicId,
      name: client.name,
      emoji: client.emoji,
      anonymous: client.anonymous,
    });
  });

  router.post('/leave', leaveLimiter, (req, res) => {
    const { clientId } = req.body || {};
    if (typeof clientId === 'string' && room.clients.has(clientId)) {
      const publicId = room.clients.get(clientId)?.publicId;
      wsHub.kickClientSockets(clientId);
      room.leave(clientId);
      auditLog('room.leave', { ipHash: hashIp(req.ip), publicId });
    }
    res.json({ ok: true });
  });

  router.get('/search', searchLimiter, async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    if (!q) return res.json({ tracks: [] });
    try {
      const tracks = await searchTracks(q);
      res.json({ tracks, mode: providerMode() });
    } catch {
      res.status(502).json({ error: 'No se pudo consultar el catálogo en este momento.' });
    }
  });

  router.post('/queue', mutateLimiter, (req, res) => {
    const { clientId, track } = req.body || {};
    const result = room.enqueue(clientId, track);
    if (result.error) return res.status(400).json(result);
    auditLog('queue.enqueue', {
      ipHash: hashIp(req.ip),
      publicId: room.clients.get(clientId)?.publicId,
      trackId: track?.id,
    });
    res.json(result);
  });

  router.post('/queue/cancel', mutateLimiter, (req, res) => {
    const { clientId, qid } = req.body || {};
    const result = room.cancelQueued(clientId, qid);
    if (result.error) return res.status(400).json(result);
    auditLog('queue.cancel', {
      ipHash: hashIp(req.ip),
      publicId: room.clients.get(clientId)?.publicId,
      qid,
    });
    res.json(result);
  });

  router.post('/vote', mutateLimiter, (req, res) => {
    const { clientId, vote, trackId } = req.body || {};
    const result = room.vote(clientId, vote, typeof trackId === 'string' ? trackId : null);
    if (result.error) return res.status(400).json(result);
    if (typeof clientId === 'string') wsHub.sendToClient(clientId, room.clientVoteState(clientId));
    res.json(result);
  });

  router.get('/state', (_req, res) => res.json(room.snapshot()));

  return router;
}
