<img src="assets/icon.svg" width="64" height="64" alt="">

# dev3pack-hub-music

Cola de música colaborativa para **Dev3pack Global Hackathon Caracas 2026**, construida con **SolidJS + Vite** en el frontend y **Express + WebSocket** en el backend, integrada con **Spotify** (Web API + Web Playback SDK).

## Correr

```bash
npm install
cp .env.example .env   # agrega SPOTIFY_CLIENT_ID y SPOTIFY_CLIENT_SECRET
npm run build          # compila la app SolidJS en dist/
npm start              # http://127.0.0.1:3000
```

- **Participantes:** `http://127.0.0.1:3000/` — entrar con nombre o anónimo, buscar en Spotify, agregar a la cola y votar
- **Pantalla (TV/proyector):** `http://127.0.0.1:3000/screen` — fondo oficial CCS 2026 en vinotinto, waves animadas, reacciones anónimas con fade suave, cola discreta a la derecha y reproducción completa con Spotify Premium

### Desarrollo con HMR

En dos terminales:

```bash
npm run dev:server     # Express + WS en :3000
npm run dev            # Vite + SolidJS en :5173 (con proxy a :3000)
```

### Tests

```bash
npm test
```

## Configurar Spotify

1. Entra al [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) con tu cuenta **Spotify Premium** (Individual o Student).
2. Crea una app y marca **Web API** y **Web Playback SDK**.
3. En **Redirect URIs** agrega `http://127.0.0.1:3000/callback`.
4. Copia el **Client ID** y **Client Secret** a `.env`.
5. Abre `http://127.0.0.1:3000/screen` y haz clic en **Conectar Spotify**. Solo el host inicia sesión; los participantes entran sin cuenta.

> Sin credenciales en `.env`, el servidor corre con un catálogo demo offline para pruebas de interfaz.

## Reglas

- **Voto neto bidireccional:** cada 👍 resta 1 a los 👎 y viceversa; la canción salta al llegar a `DISLIKES_TO_SKIP` (default 5) dislikes netos.
- `MAX_VOTES_PER_TRACK` (default 2): acciones de voto por persona por canción (protegido contra recargas `F5`).
- `REPLAY_COOLDOWN_MINUTES` (default 30): tiempo mínimo antes de repetir una canción.
- `ENQUEUE_MAX_PER_WINDOW` / `ENQUEUE_WINDOW_MINUTES` (default 3 por 10 min): límite de canciones por persona.
- Cola vacía → canción aleatoria de Spotify.
- Reacciones anónimas con fade suave en `/screen`.

Created in [T3 Code](https://t3.codes).
