# songbirdweb

Next.js 15 browser UI for the Songbird music streaming ecosystem. Lets authenticated users download songs by URL, tag them with iTunes metadata, manage a personal library, stream audio with a persistent queue player, edit audio clips via async ffmpeg jobs, and cache songs offline for playback without a network connection. Communicates exclusively with `songbirdapi` over HTTP; all state and files live server-side.

## Ecosystem

Songbird has four repos:

| Repo | Role |
|---|---|
| `songbirdcore` | Shared Python library — yt-dlp wrapper, iTunes API client, ID3 tagging |
| `songbirdcli` | CLI tool — downloads songs using `songbirdcore` |
| `songbirdapi` | FastAPI backend — serves songs, manages users, persists state |
| **`songbirdweb`** | **This repo — browser UI** |

The web app is a thin client. It calls `songbirdapi` for all data and media; there is no separate database or file storage here.

## Prerequisites

- Node.js 22+
- npm (or yarn / pnpm — a lockfile is present for npm)
- A running `songbirdapi` instance

## Setup & Running Locally

**1. Install dependencies**

```bash
npm install
```

**2. Configure the API host**

`.env.development` already sets `NEXT_PUBLIC_API_HOST=localhost`. If your API runs elsewhere, override it:

```bash
echo "NEXT_PUBLIC_API_HOST=192.168.1.10" > .env.local
```

**3. Run the dev server**

```bash
npm run dev        # starts on http://localhost:3000 with Turbopack
```

**Build for production**

```bash
npm run build
npm run start
```

**Docker**

```bash
docker build -t songbirdweb:latest .
docker run -e NEXT_PUBLIC_API_HOST=<api-host> -p 3000:3000 songbirdweb:latest
```

The Dockerfile uses the Next.js standalone output and runs as a non-root user on port 3000.

## Environment Variables

| Variable | Required | Default (dev) | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_HOST` | yes | `localhost` | Hostname of the `songbirdapi` instance. The app constructs `http://<host>:8000` as the base URL. |
| `TEST_USERNAME` | e2e only | — | Username for Playwright e2e tests (`.env.local`) |
| `TEST_PASSWORD` | e2e only | — | Password for Playwright e2e tests (`.env.local`) |

`NEXT_PUBLIC_API_HOST` is embedded at build time for client components and forwarded as a cookie header for server components. For production, set it to the public hostname of the API (e.g. via Docker `-e` or a CI build arg).

## Key Concepts

**Auth**: Login posts credentials to `POST /auth/login`, which sets httpOnly `access_token` and `refresh_token` cookies. All subsequent fetches include those cookies — browser fetches via `credentials: 'include'`, server component fetches by forwarding the `Cookie` header from `next/headers`. The root page redirects authenticated users to `/download` and unauthenticated users back to `/`.

**Player**: A React context (`PlayerProvider`) wraps the entire app and owns a single `<audio>` element. The persistent player bar is fixed to the bottom of the screen. On load it restores queue and playback position from `GET /player/state`. Position is saved to the API every 10 seconds during playback and on pause. A play event is recorded after 30 seconds of continuous play. Keyboard shortcuts: `Space` play/pause, `←`/`→` skip.

**Offline / OPFS**: Songs can be cached to the browser's Origin Private File System via the File System Access API. `app/lib/offline.ts` streams audio from `GET /download/{id}` and writes it to `audio/<id>.mp3` in OPFS. On playback, the player checks OPFS first and creates a blob URL if a cached file exists, avoiding a network request entirely. The `/settings` page shows storage usage and lets users clear the cache. The service worker (`public/sw.js`) is registered for PWA support.

**Audio editing**: The editor modal uses WaveSurfer.js to render a waveform and exposes trim, volume, and fade controls. Submitting creates an async job via `POST /edit/songs/{id}`; the UI polls `GET /edit/jobs/{job_id}` until the job completes. Draft parameters are auto-saved to the API so they survive page reloads.

**Explore**: The `/explore` page fetches aggregated stats (`GET /songs/explore`) and lets users browse most-played, most-downloaded, most-saved, and recently-added songs across configurable time windows (today / this week / all time).

**Share links**: Any song can generate a time-limited share token. The recipient visits `/share/<token>` — a public page that shows track info and offers a direct download without requiring login.

**Admin**: `/admin` is accessible only to users with `role=admin`. It lists all users and allows changing roles, toggling active status, and deleting accounts.

## Further docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — stack, route map, the `/v1` dev proxy, middleware, service worker, offline strategy.
- [`docs/STATE.md`](docs/STATE.md) — `PlayerProvider` API, library / editor / import state shapes, SW lifecycle.
- [`docs/ENV.md`](docs/ENV.md) — exhaustive env var reference (build-time vs runtime).
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — branch + commit policy, how to add a page or component, pre-PR checklist.

## App Routes

| Route | Description |
|---|---|
| `/` | Login (redirects to `/download` if already authenticated) |
| `/download` | Download hub (by URL, song search, or album) |
| `/library` | Personal library list with play, edit, and remove actions |
| `/explore` | Global and personal play/download stats |
| `/settings` | Change password, view and clear offline cache |
| `/admin` | User management (admin only) |
| `/share/[token]` | Public share page — no login required |
| `/offline` | Fallback page served by the service worker when offline |

## Development Notes

**Branches**: never commit to `main`; use feature branches.

**Unit tests**:

```bash
npm test        # Jest + React Testing Library
```

**End-to-end tests**:

```bash
npm run test:e2e    # Playwright
```

E2e tests require a running API and valid credentials in `.env.local` (`TEST_USERNAME`, `TEST_PASSWORD`). They should not run in CI without a live API.

**Linting**:

```bash
npm run lint    # next lint (ESLint)
```

**Docker CI**: PRs build multi-arch images (`amd64` + `arm64`) without pushing. Merges to `main` and version tags push to `cboin/songbirdweb` on Docker Hub.
