<img src="assets/icon.svg" width="64" height="64" alt="Dev3pack Music Hub">

# Dev3pack Music Hub

A real-time collaborative music queue built for **Dev3pack Global Hackathon** build stations. Participants join with a name or anonymously (no passwords, no Spotify account needed), search Spotify, queue tracks, and vote on what plays next. A dedicated fullscreen TV screen (`/screen`) displays the **Dev3pack Global Hackathon CCS 2026** vinotinto visual stage with animated audio waves, anonymous fade reactions, the upcoming queue, and full-length Spotify Premium playback.

---

## Features

- **Frictionless entry (`/`)** — Join with a display name or go anonymous. No passwords or accounts required for participants.
- **Spotify catalog search & auto-shuffle** — Search Spotify tracks in real time. When the queue empties, a random Spotify track is picked automatically (respecting the replay cooldown).
- **Bidirectional net voting** — Likes (`👍`) cancel out dislikes (`👎`) and vice versa (`score = likes - dislikes`). A song skips automatically when net dislikes reach the configured threshold (default: `5`).
- **Anti-spam guardrails** — Max `3` songs enqueued per person every `10` minutes, `30`-minute replay cooldown per song, max `2` vote actions per person per song, and reload grace windows.
- **Fullscreen TV Mode (`/screen`)** — Fluid Dev3pack CCS 2026 vinotinto backdrop, 60fps reactive `<canvas>` audio waves, unobtrusive distant queue rail, anonymous soft-fade emoji reactions, and full-track playback via the **Spotify Web Playback SDK**.
- **Lightweight SolidJS + Vite frontend** — Multi-page build (~11 KB gzipped per page), responsive across desktop, tablet, and mobile (with a slide-over queue drawer and `prefers-reduced-motion` support).
- **Production-hardened backend** — Strict track sanitization, opaque public listener IDs, `HttpOnly` host session cookies, per-IP rate limiting, WebSocket `Origin` validation + first-message auth frames, CSP/HSTS headers, `/healthz`, graceful `SIGTERM` shutdown, and pseudonymized JSON audit logs.

---

## Architecture

```
Browser (Participants on /  &  TV Display on /screen)
        │                          ▲
        │ REST API (/api/*)        │ WebSocket (/ws)
        │                          │  - state snapshots (publicId only)
        ▼                          │  - anonymous reactions (no voter PII)
┌──────────────────────────────────────────────────────────┐
│  Express + ws Server (server/index.js)                   │
│   ├── Room Engine (server/state.js)                      │
│   │    queue · cooldown · net voting · rate limits       │
│   └── Spotify Service (server/spotify.js)                │
│        Web API search/shuffle · Host OAuth · Playback    │
└──────────────────────────────────────────────────────────┘
        │
        ▼
  Spotify Web API & Web Playback SDK (Host Premium account)
```

- **Frontend (`src/`)**: SolidJS 1.9 + Vite 7 multi-page app (`index.html` → `/`, `screen.html` → `/screen`), compiled into `dist/` and served directly by Express in production.
- **Backend (`server/`)**: Single-process Node.js server holding live room state in memory and broadcasting updates over WebSockets.

---

## Quick Start

### Prerequisites

- **Node.js 20+** (tested on Node 24)
- **npm 10+**
- *(Optional for live Spotify)* A **Spotify Premium** account (Individual or Student) and a Spotify Developer app

### 1. Install & configure

```bash
git clone <your-repo-url>
cd dev3pack-hub-music
npm install
cp .env.example .env
```

> Without Spotify credentials in `.env`, the app automatically runs in **Demo Mode** with a built-in catalog so you can test the entire UI, queue, voting, and TV screen offline.

### 2. Build & run (production)

```bash
npm run build
npm start
```

Open:
- **Participant player:** `http://127.0.0.1:3000/`
- **TV / projector screen:** `http://127.0.0.1:3000/screen`
- **Health check:** `http://127.0.0.1:3000/healthz`

### 3. Local development (with HMR)

Run the API/WebSocket server and Vite dev server in two terminals:

```bash
# Terminal 1 — Express + WebSocket on :3000
npm run dev:server

# Terminal 2 — Vite + SolidJS HMR on :5173 (proxies /api, /callback, /ws to :3000)
npm run dev
```

### 4. Run tests

```bash
npm test
```

Runs the built-in `node:test` suite (`test/voting.test.js` and `test/security.test.js`), covering bidirectional net voting, skip edge cases, track sanitization, anti-impersonation, and leak prevention.

---

## Spotify Setup

Only **one host account (Spotify Premium)** connects to Spotify — all participants join without a Spotify account.

1. Sign in to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) using your **Spotify Premium** (Individual or Student) account.
2. Click **Create app** and check both **Web API** and **Web Playback SDK**.
3. Under **Redirect URIs**, add:
   - Local: `http://127.0.0.1:3000/callback` *(Spotify requires `127.0.0.1` instead of `localhost` for local HTTP)*
   - Production: `https://your-domain.com/callback`
4. Copy **Client ID** and **Client Secret** into `.env`.
5. Rebuild if needed and start the server (`npm start`).
6. Open `/screen` on the TV/projector machine and connect Spotify:
   - **Locally (`127.0.0.1`)**: click **Conectar Spotify Premium** directly on `/screen`.
   - **Public deployment (`HOST_ADMIN_SECRET` set)**: first authorize the TV browser session by calling `POST /api/spotify/authorize` with header `X-Admin-Key: <HOST_ADMIN_SECRET>` (sets an `HttpOnly` pre-auth cookie for 5 minutes), then navigate to `/api/spotify/login`.
7. Once redirected back to `/screen`, click **🔊 Activar sonido** once to unlock browser audio playback. Full tracks will now play and advance automatically.

---

## Configuration (`.env`)

See [`.env.example`](.env.example) for the complete template.

| Variable | Default | Description |
| --- | --- | --- |
| `SPOTIFY_CLIENT_ID` | *(empty)* | Spotify app Client ID (blank = demo catalog) |
| `SPOTIFY_CLIENT_SECRET` | *(empty)* | Spotify app Client Secret |
| `SPOTIFY_REDIRECT_URI` | `http://127.0.0.1:3000/callback` | OAuth callback URL (must match Spotify Dashboard) |
| `SPOTIFY_MARKET` | `US` | ISO country code for Spotify search results |
| `HOST_ADMIN_SECRET` | *(empty)* | Secret required to authorize host Spotify login on public deployments |
| `TRUST_PROXY` | `0` | Set to `1` only when behind a trusted reverse proxy (for `X-Forwarded-For` & HTTPS detection) |
| `DISLIKES_TO_SKIP` | `5` | Net dislikes (`dislikes - likes`) required to skip the active song |
| `REPLAY_COOLDOWN_MINUTES` | `30` | Cooldown before the same track can play again |
| `ENQUEUE_MAX_PER_WINDOW` | `3` | Max songs a single participant can add per time window |
| `ENQUEUE_WINDOW_MINUTES` | `10` | Enqueue rate-limit window in minutes |
| `MAX_VOTES_PER_TRACK` | `2` | Max vote changes per participant per song |
| `MAX_QUEUE_SIZE` | `50` | Maximum number of tracks allowed in the queue |
| `MAX_CLIENTS` | `250` | Maximum concurrent connected participants |
| `DISCONNECT_GRACE_MS` | `8000` | Grace window before dropping a disconnected socket (preserves page reloads) |
| `PORT` | `3000` | HTTP/WebSocket listen port |

---

## How Voting & Queue Rules Work

- **Net voting (`likes - dislikes`)**:
  - Displayed likes = `max(0, rawLikes - rawDislikes)`
  - Displayed dislikes = `max(0, rawDislikes - rawLikes)`
  - A song is skipped when displayed dislikes reach `DISLIKES_TO_SKIP`.
  - If a participant who liked the song leaves or flips their vote to dislike, the skip threshold is immediately re-evaluated.
  - Votes include the active `trackId` so simultaneous clicks right at a skip boundary never accidentally hit the next song.
- **Anonymous reactions**: Reaction events broadcast to `/screen` only contain `{ type: "reaction", vote, ts }` — never the voter's name or ID.
- **Auto-shuffle**: When the queue is empty and the current song finishes or is skipped, the server selects a random Spotify track that is not in the 30-minute cooldown set.

---

## API & WebSocket Reference

### HTTP Endpoints

| Method & Path | Access | Description |
| --- | --- | --- |
| `GET /healthz` | Public | Server liveness/readiness metrics |
| `POST /api/join` | Public (rate-limited) | Join room (`{ name? }`) → returns private `clientId` + opaque `publicId` |
| `POST /api/leave` | Participant token | Leave room and erase session (`{ clientId }`) |
| `GET /api/search?q=...` | Public (rate-limited) | Search tracks (Spotify Web API `limit=10` or demo catalog) |
| `POST /api/queue` | Participant token | Enqueue a track (`{ clientId, track }`) |
| `POST /api/vote` | Participant token | Cast/toggle vote (`{ clientId, vote: 1 \| -1 \| 0, trackId? }`) |
| `GET /api/state` | Public | Current sanitized room snapshot |
| `GET /api/spotify/status` | Public / Host | Connection status (`user` only included for authenticated host) |
| `POST /api/spotify/authorize` | `HOST_ADMIN_SECRET` | Sets short-lived `HttpOnly` pre-auth cookie for host OAuth |
| `GET /api/spotify/login` | Host / Loopback | Starts Spotify OAuth flow |
| `GET /callback` | Spotify OAuth | Exchanges auth code and sets `HttpOnly` host session cookie |
| `GET /api/spotify/token` | Host cookie only | Returns fresh host Spotify access token for Web Playback SDK |
| `POST /api/spotify/device` | Host cookie only | Registers active Web Playback SDK `deviceId` and syncs playback |
| `POST /api/spotify/disconnect` | Host cookie only | Revokes server-held host tokens and clears host cookie |

### WebSocket (`/ws`)

- Same-origin verified (`Origin` must match `Host`), capped at 12 concurrent sockets per IP, 4 KB max payload, 15s ping/pong heartbeat.
- Participants authenticate via a first-message JSON frame `{ "type": "auth", "clientId": "..." }` (tokens are never placed in URL query strings).
- Server messages: `state`, `you`, `reaction`, `session-expired`.

---

## Security & Privacy Highlights

- **No secrets in URLs or client bundles** — Spotify credentials stay server-side; host access tokens are gated behind an `HttpOnly; SameSite=Lax` cookie (`Secure` under HTTPS) and never exposed to participants.
- **Anti-impersonation** — Private session tokens (`clientId`) are never broadcast; public snapshots expose only opaque `publicId` values.
- **Strict input sanitization** — Track IDs, titles, durations (`15s–10m`), Spotify URIs (`spotify:track:*`), and album art URLs (HTTPS Spotify CDN allowlist only) are validated server-side.
- **Browser & transport headers** — Strict `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cache-Control: no-store` on `/api/*`, and `Strict-Transport-Security` under HTTPS.
- **Privacy (ISO 27701 aligned)** — Minimal Spotify OAuth scopes (no `user-read-email`), client sessions stored in `sessionStorage` with a 12-hour TTL, pseudonymized IP hashes in structured JSON audit logs, and anonymous TV reactions.

---

## Deployment

Because room state and WebSockets live in memory, deploy as a **single always-on Node.js instance** with HTTPS (do **not** use serverless hosts like Vercel/Netlify):

- **Railway / Render / Fly.io**:
  - Build command: `npm install && npm run build`
  - Start command: `npm start`
  - Env vars: set `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REDIRECT_URI=https://<your-domain>/callback`, `HOST_ADMIN_SECRET=<strong-random-secret>`, and `TRUST_PROXY=1`.
  - Keep replicas/instances set to **1**.
- **On-site event with Cloudflare Tunnel (zero hosting cost)**:
  - Run `npm run build && npm start` on the TV/projector laptop and expose via `cloudflared tunnel --url http://127.0.0.1:3000` (with `TRUST_PROXY=1`).

---

## License

MIT
