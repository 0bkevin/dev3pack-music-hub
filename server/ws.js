import { WebSocketServer } from 'ws';
import { DISCONNECT_GRACE_MS, MAX_WS_CONNECTIONS, MAX_WS_PER_IP, ZOMBIE_TTL_MS } from './config.js';
import { auditLog, getClientIp, hashIp, isAllowedWsOrigin } from './security.js';

const STATE_COALESCE_MS = 25;

export function createWsHub(server) {
  const sockets = new Map();       // ws -> { clientId: string | null, ip: string }
  const socketsPerIp = new Map();  // ip -> active count
  const pendingPerIp = new Map();  // ip -> in-flight upgrade count
  let pendingTotal = 0;
  const leaveTimers = new Map();   // clientToken -> Timeout
  let room = null;
  let statePending = false;
  let stateFlushTimer = null;
  let lastStateBroadcastAt = 0;

  function adjustCount(map, key, delta) {
    const next = (map.get(key) || 0) + delta;
    if (next <= 0) map.delete(key);
    else map.set(key, next);
  }

  function removeSocket(ws) {
    const meta = sockets.get(ws);
    if (!meta) return null;
    sockets.delete(ws);
    adjustCount(socketsPerIp, meta.ip, -1);
    return meta;
  }

  function safeSend(ws, data) {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > 1024 * 1024) {
      removeSocket(ws);
      ws.terminate();
      return;
    }
    try {
      ws.send(data);
    } catch {
      removeSocket(ws);
      try { ws.terminate(); } catch { /* ignore */ }
    }
  }

  function sendAll(msg) {
    const data = JSON.stringify(msg);
    for (const ws of [...sockets.keys()]) safeSend(ws, data);
  }

  function flushPendingState() {
    if (stateFlushTimer) {
      clearTimeout(stateFlushTimer);
      stateFlushTimer = null;
    }
    if (!statePending) return;
    statePending = false;
    if (!room) return;
    lastStateBroadcastAt = Date.now();
    sendAll(room.snapshot());
  }

  function broadcast(msg, opts = {}) {
    if (msg?.type !== 'state') {
      flushPendingState();
      sendAll(msg);
      return;
    }
    const now = Date.now();
    if (opts.immediate || (!stateFlushTimer && now - lastStateBroadcastAt >= STATE_COALESCE_MS)) {
      if (stateFlushTimer) {
        clearTimeout(stateFlushTimer);
        stateFlushTimer = null;
      }
      statePending = false;
      lastStateBroadcastAt = now;
      sendAll(room ? room.snapshot() : msg);
      return;
    }
    statePending = true;
    if (!stateFlushTimer) {
      const delay = Math.max(1, STATE_COALESCE_MS - (now - lastStateBroadcastAt));
      stateFlushTimer = setTimeout(() => {
        stateFlushTimer = null;
        if (statePending && room) {
          statePending = false;
          lastStateBroadcastAt = Date.now();
          sendAll(room.snapshot());
        }
      }, delay);
    }
  }

  function sendToClient(clientId, msg) {
    flushPendingState();
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
    noServer: true,
    maxPayload: 4 * 1024,
  });

  function rejectUpgrade(socket, statusCode, statusText) {
    try {
      socket.write(
        `HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(statusText)}\r\n\r\n${statusText}`
      );
    } catch { /* ignore */ }
    socket.destroy();
  }

  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
    } catch {
      return rejectUpgrade(socket, 400, 'Bad Request');
    }
    if (pathname !== '/ws') {
      return rejectUpgrade(socket, 404, 'Not Found');
    }

    const ip = getClientIp(req);
    if (!isAllowedWsOrigin(req)) {
      auditLog('ws.origin_rejected', { ipHash: hashIp(ip) });
      return rejectUpgrade(socket, 403, 'Forbidden Origin');
    }
    if (sockets.size + pendingTotal >= MAX_WS_CONNECTIONS) {
      auditLog('ws.global_cap_exceeded', { ipHash: hashIp(ip) });
      return rejectUpgrade(socket, 503, 'Server Busy');
    }
    if ((socketsPerIp.get(ip) || 0) + (pendingPerIp.get(ip) || 0) >= MAX_WS_PER_IP) {
      auditLog('ws.ip_cap_exceeded', { ipHash: hashIp(ip) });
      return rejectUpgrade(socket, 429, 'Too Many Connections');
    }

    let released = false;
    const releasePending = () => {
      if (released) return;
      released = true;
      pendingTotal = Math.max(0, pendingTotal - 1);
      adjustCount(pendingPerIp, ip, -1);
    };

    pendingTotal++;
    adjustCount(pendingPerIp, ip, 1);
    socket.once('close', releasePending);
    socket.once('error', releasePending);

    wss.handleUpgrade(req, socket, head, (ws) => {
      socket.off('close', releasePending);
      socket.off('error', releasePending);
      releasePending();
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    const ip = getClientIp(req);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {
      removeSocket(ws);
      try { ws.terminate(); } catch { /* ignore */ }
    });

    const meta = { clientId: null, ip };
    sockets.set(ws, meta);
    adjustCount(socketsPerIp, ip, 1);
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
      removeSocket(ws);
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
        removeSocket(ws);
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
    clearTimeout(stateFlushTimer);
    stateFlushTimer = null;
    statePending = false;
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
