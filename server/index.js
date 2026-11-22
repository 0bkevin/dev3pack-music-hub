import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT, TRUST_PROXY, HOST_ADMIN_SECRET } from './config.js';
import { spotifyEnabled } from './spotify.js';
import { Room } from './state.js';
import { auditLog, securityHeaders } from './security.js';
import { createWsHub } from './ws.js';
import { createRoomRouter } from './routes/roomRoutes.js';
import { createSpotifyRoutes } from './routes/spotifyRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'dist');

const app = express();
app.disable('x-powered-by');
if (TRUST_PROXY) app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use(securityHeaders);
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.static(DIST_DIR));

const server = createServer(app);
const wsHub = createWsHub(server);
const room = new Room(wsHub.broadcast);
wsHub.attachRoom(room);

const spotifyRoutes = createSpotifyRoutes(room);

app.get('/healthz', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    uptimeSec: Math.floor(process.uptime()),
    listeners: room.clients.size,
    queueLength: room.queue.length,
  });
});

app.use('/api', createRoomRouter(room, wsHub));
app.use('/api/spotify', spotifyRoutes.apiRouter);
app.get('/callback', ...spotifyRoutes.callbackMiddleware);
app.get('/screen', (_req, res) => res.sendFile(path.join(DIST_DIR, 'screen.html')));

const maintenanceTimer = setInterval(() => {
  wsHub.sweep();
  spotifyRoutes.prunePreAuth();
}, 15_000);
maintenanceTimer.unref();

function shutdown(signal) {
  auditLog('server.shutdown', { signal });
  clearInterval(maintenanceTimer);
  clearTimeout(room.endTimer);
  wsHub.closeAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, () => {
  auditLog('server.started', {
    port: PORT,
    spotifyConfigured: spotifyEnabled,
    trustProxy: TRUST_PROXY,
    hostAdminSecretSet: Boolean(HOST_ADMIN_SECRET),
  });
});
