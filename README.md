<img src="assets/icon.svg" width="56" height="56" alt="">

# dev3pack-hub-music

Real-time collaborative music queue for Dev3pack build stations. Built with **SolidJS + Vite** and **Express + WebSocket**, integrated with **Spotify** (Web API + Web Playback SDK).

- **`/`** — Participant player: join with a name or anonymously, search Spotify, enqueue tracks, and vote (`👍` / `👎`).
- **`/screen`** — Fullscreen TV display: Dev3pack CCS 2026 vinotinto stage, reactive audio waves, upcoming queue, anonymous fade reactions, and full-track Spotify Premium playback.

## Quick Start

Requires **Node.js 20+**.

```bash
npm install
cp .env.example .env
npm run build
npm start
```

Open `http://127.0.0.1:3000/` (participants) and `http://127.0.0.1:3000/screen` (TV).
Without Spotify credentials in `.env`, the server runs with a built-in demo catalog.

### Development & Tests

```bash
npm run dev:server   # Express + WebSocket on :3000
npm run dev          # Vite + SolidJS HMR on :5173 (proxies to :3000)
npm test             # Unit & security tests
```

## Spotify Setup

Only the TV/host machine connects a **Spotify Premium** account (Individual or Student). Participants do not need Spotify.

1. Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and enable **Web API** and **Web Playback SDK**.
2. Add your Redirect URI: `http://127.0.0.1:3000/callback` locally, or `https://<your-domain>/callback` in production.
3. Set `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `SPOTIFY_REDIRECT_URI` in `.env`.
4. Connect the host from `/screen`:
   - **Local (`127.0.0.1`)**: click **Conectar Spotify Premium**.
   - **Public deployment**: set `HOST_ADMIN_SECRET` in `.env`, authorize the TV browser via `POST /api/spotify/authorize` (`X-Admin-Key: <secret>`), then open `/api/spotify/login`.
5. Click **🔊 Activar sonido** on `/screen` once to unlock browser audio.

## Rules & Environment

All tunables live in [`.env.example`](.env.example). Defaults:

- **Net voting**: `👍` cancels `👎` and vice versa (`score = likes - dislikes`). Tracks skip at `DISLIKES_TO_SKIP=5` net dislikes.
- **Vote limit**: `MAX_VOTES_PER_TRACK=2` actions per person per song.
- **Fair queue**: round-robin interleaving per participant; participants can cancel their own queued tracks and recover their slot.
- **Queue limits**: `ENQUEUE_MAX_PER_WINDOW=3` songs per `ENQUEUE_WINDOW_MINUTES=10`, `MAX_TRACK_MINUTES=7`, `REPLAY_COOLDOWN_MINUTES=30`.
- **Auto-shuffle**: empty queue picks a random Spotify track outside the replay cooldown.
- **History & SQLite**: `/history` shows the Top 3 podium, full playback history, and per-participant accordion backed by `node:sqlite` (`DB_PATH`).
- **Health check**: `GET /healthz`.

## Deployment

Room state and WebSockets live in memory — deploy as a **single always-on Node.js instance** with HTTPS (Railway, Render, Fly.io, VPS + Caddy, or local + Cloudflare Tunnel). Do not use serverless hosts (Vercel/Netlify).

Required production env vars:
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI=https://<domain>/callback`
- `HOST_ADMIN_SECRET=<random-secret>`
- `TRUST_PROXY=1` (only when behind a reverse proxy)
