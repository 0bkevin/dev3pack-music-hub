import { WebSocketServer } from 'ws';
import { isIP } from 'node:net';
import { DISCONNECT_GRACE_MS, MAX_WS_PER_IP, TRUST_PROXY, ZOMBIE_TTL_MS } from './config.js';
import { auditLog, hashIp, isAllowedWsOrigin } from './security.js';

function clientIp(req) {
  const forwarded = TRUST_PROXY && req.headers['x-forwarded-for']?.split(',').at(-1).trim();
  const ip = forwarded && isIP(forwarded) ? forwarded : req.socket?.remoteAddress || 'unknown';
  return ip.replace(/^::ffff:(?=\d+\.)/i, '');
}

export function createWsHub(server) {
  const sockets = new Map();     // ws -> { clientId: string | null, ip: string }
  const leaveTimers = new Map(); // clientToken -> Timeout
  let room = null;

  function safeSend(ws, data) {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > 1024 * 1024) {
      ws.terminate();
      return;
    }
    try {
      ws.send(data);
    } catch {
      try { ws.terminate(); } catch { /* ignore */ }
    }
  }

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of sockets.keys()) safeSend(ws, data);
  }

  function sendToClient(clientId, msg) {
    const data = JSON.stringify(msg);
    for (const [ws, meta] of sockets.entries()) {
      if (meta.clientId === clientId) safeSend(ws, data);
    }
  }

  function hasOtherSocket(clientId, excludeWs = null) {
    for (const [ws, meta] of sockets.entries()) {
      if (ws !== excludeWs && meta.clientId === clientId && ws.readyState === ws.OPEN) return true;
    }
    return false;
  }

  function countSocketsForIp(ip) {
    let n = 0;
    for (const [ws, meta] of sockets.entries()) {
      if (meta.ip === ip && ws.readyState === ws.OPEN) n++;
    }
    return n;
  }

  function cancelLeave(clientId) {
    const t = leaveTimers.get(clientId);
    if (t) {
      clearTimeout(t);
      leaveTimers.delete(clientId);
    }
  }

  function kickClientSockets(clientId) {
    cancelLeave(clientId);
    for (const [ws, meta] of sockets.entries()) {
      if (meta.clientId === clientId) {
        meta.clientId = null;
        safeSend(ws, JSON.stringify({ type: 'session-expired' }));
      }
    }
  }

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 4 * 1024,
    verifyClient: ({ req }, cb) => {
      const ip = clientIp(req);
      if (!isAllowedWsOrigin(req)) {
        auditLog('ws.origin_rejected', { ipHash: hashIp(ip) });
        return cb(false, 403, 'Forbidden Origin');
      }
      if (countSocketsForIp(ip) >= MAX_WS_PER_IP) {
        auditLog('ws.ip_cap_exceeded', { ipHash: hashIp(ip) });
        return cb(false, 429, 'Too Many Connections');
      }
      return cb(true);
    },
  });

  wss.on('connection', (ws, req) => {
    const ip = clientIp(req);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {
      sockets.delete(ws);
      try { ws.terminate(); } catch { /* ignore */ }
    });

    const meta = { clientId: null, ip };
    sockets.set(ws, meta);
    if (room) safeSend(ws, JSON.stringify(room.snapshot()));

    ws.on('message', (raw) => {
      if (meta.clientId || !room) return;
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg?.type !== 'auth' || typeof msg.clientId !== 'string') return;
      if (room.clients.has(msg.clientId)) {
        cancelLeave(msg.clientId);
        meta.clientId = msg.clientId;
        safeSend(ws, JSON.stringify(room.clientVoteState(msg.clientId)));
      } else {
        safeSend(ws, JSON.stringify({ type: 'session-expired' }));
      }
    });

    ws.on('close', () => {
      const id = meta.clientId;
      sockets.delete(ws);
      if (!id || !room || hasOtherSocket(id, ws)) return;
      if (DISCONNECT_GRACE_MS === 0) {
        room.leave(id);
        return;
      }
      cancelLeave(id);
      leaveTimers.set(
        id,
        setTimeout(() => {
          leaveTimers.delete(id);
          if (!hasOtherSocket(id)) room.leave(id);
        }, DISCONNECT_GRACE_MS)
      );
    });
  });

  function sweep() {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        sockets.delete(ws);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }
    if (!room) return;
    const now = Date.now();
    for (const [id, client] of room.clients) {
      if (now - client.joinedAt > ZOMBIE_TTL_MS && !hasOtherSocket(id) && !leaveTimers.has(id)) {
        room.leave(id);
      }
    }
    room.pruneExpired();
  }

  function closeAll() {
    for (const t of leaveTimers.values()) clearTimeout(t);
    leaveTimers.clear();
    for (const ws of wss.clients) {
      try { ws.close(1001, 'Server restarting'); } catch { /* ignore */ }
    }
    wss.close();
  }

  return {
    attachRoom(r) { room = r; },
    broadcast,
    sendToClient,
    kickClientSockets,
    sweep,
    closeAll,
  };
}
