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

`.env.development` leaves `NEXT_PUBLIC_API_BASE_URL` empty (defaults to `http://localhost:8000`). Override in `.env.local` if your API runs elsewhere:

```bash
echo "NEXT_PUBLIC_API_BASE_URL=http://192.168.1.10:8000" > .env.local
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
docker run -e NEXT_PUBLIC_API_BASE_URL=http://<api-host>:8000 -p 3000:3000 songbirdweb:latest
```

The Dockerfile uses the Next.js standalone output and runs as a non-root user on port 3000.

## Environment Variables

| Variable | Required | Default (dev) | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | yes | `http://localhost:8000` | Full base URL of the `songbirdapi` instance (client-side fetches). |
| `API_BASE_URL` | yes | `http://localhost:8000` | Full base URL used by server components (SSR fetches). Usually the same as above. |
| `TEST_USERNAME` | e2e only | — | Username for Playwright e2e tests (`.env.local`) |
| `TEST_PASSWORD` | e2e only | — | Password for Playwright e2e tests (`.env.local`) |

`NEXT_PUBLIC_API_BASE_URL` is embedded at build time for client components. `API_BASE_URL` is used at runtime by server components. For production set both via Docker `-e` or CI build args.

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
| `/import` | Upload local audio files (.mp3/.m4a) directly to the library |
| `/settings` | Change password, view and clear offline cache |
| `/info` | App info and version |
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
make test-e2e-local        # CI-parity: spins up isolated Docker API + Postgres, runs dev suite
make e2e-down              # tear down containers when done

make test-e2e              # dev suite against your local API on :8000 (single worker required)
make test-e2e-mobile       # mobile viewport suite
```

`make test-e2e-local` is the canonical way to run e2e — it uses the same `cboin/songbirdapi:latest` Docker image as CI with seeded test data. Use `make test-e2e` only for quick iteration against your own dev API.

For manual debugging:
```bash
npx playwright test --project=dev --ui         # Playwright UI mode (recommended)
npx playwright test --project=dev --headed     # headed, no step-through
```

Download tests (`e2e/download.spec.ts`) are skipped in CI (require yt-dlp + network). Run locally with `CI=` prefix:
```bash
CI= make test-e2e
```

**Linting**:

```bash
npm run lint    # next lint (ESLint)
```

**Docker CI**: PRs build multi-arch images (`amd64` + `arm64`) without pushing. Merges to `main` and version tags push to `cboin/songbirdweb` on Docker Hub.
