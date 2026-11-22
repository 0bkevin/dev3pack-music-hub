import { Router } from 'express';
import { makeIpLimiter } from '../security.js';

export function createHistoryRouter(db) {
  const router = Router();
  const historyLimiter = makeIpLimiter(60, 60_000, 'history');

  router.get('/', historyLimiter, (_req, res) => {
    res.json({
      topRequesters: db.getTopRequesters(3),
      people: db.getAllRequesters(100),
      history: db.getFullHistory(200),
      totals: db.getTotals(),
    });
  });

  router.get('/user/:id', historyLimiter, (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!/^[a-f0-9]{16}$/i.test(id)) {
      return res.status(400).json({ error: 'Usuario inválido.' });
    }
    const data = db.getHistoryByUser(id, 200);
    if (!data) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json(data);
  });

  return router;
}
