import { Router } from 'express';
import { searchTracks, providerMode } from '../spotify.js';
import { makeIpLimiter } from '../security.js';

export function createRoomRouter(room, wsHub) {
  const router = Router();
  const joinLimiter = makeIpLimiter(25, 10 * 60_000, 'join');
  const searchLimiter = makeIpLimiter(45, 60_000, 'search');
  const mutateLimiter = makeIpLimiter(60, 60_000, 'mutate');
  const leaveLimiter = makeIpLimiter(20, 60_000, 'leave');

  router.post('/join', joinLimiter, (req, res) => {
    const ip = req.ip || req.socket?.remoteAddress || '';
    const client = room.join(req.body?.name, req.body?.emoji, ip);
    if (client.error) return res.status(503).json(client);
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
      wsHub.kickClientSockets(clientId);
      room.leave(clientId);
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
