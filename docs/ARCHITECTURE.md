# songbirdweb — architecture

## Stack

- **Next.js 15** (App Router, server components, Turbopack dev)
- **React 19**
- **TypeScript** (`"strict": true`)
- **Tailwind v4** (PostCSS plugin)
- **WaveSurfer.js** (editor waveform)
- **Jest** + Testing Library (unit)
- **Playwright** (e2e, `e2e/`)

The web app is a **thin client**. It owns no domain data — every fetch goes to `songbirdapi`. Browser state is mostly cached library data (IndexedDB), audio (OPFS), and player state (also persisted server-side).

## Route map

| Route | Page file | Auth | Offline-supported | Notes |
|---|---|---|---|---|
| `/` | `app/page.tsx` | public | no | Login. Redirects to `/download` if already authenticated (handled in `middleware.ts`). |
| `/download` | `app/download/page.tsx` | cookie | no (`OfflineGuard`) | Hub: by URL, by song search, by album. Subroutes `/url`, `/song`, `/album`. |
| `/library` | `app/library/page.tsx` | cookie | yes | Personal library. Server-component fetch hydrated into `library-list.tsx`. |
| `/import` | `app/import/page.tsx` | cookie | no (`OfflineGuard`) | Multipart MP3/M4A upload + jobs table. |
| `/explore` | `app/explore/page.tsx` | cookie | no (`OfflineGuard`) | Most-played / most-downloaded / most-saved / recently-added. |
| `/admin` | `app/admin/page.tsx` | admin | no (`OfflineGuard`) | User table + system stats. |
| `/info` | `app/info/page.tsx` | cookie | no (`OfflineGuard`) | About / version page. |
| `/settings` | `app/settings/page.tsx` | cookie | yes | Change password, manage offline cache. |
| `/share/[token]` | `app/share/[token]/page.tsx` | public | no | Public share link. Bypassed by middleware. |
| `/songs/[id]/edit` | `app/songs/[id]/...` | cookie | no | Editor (WaveSurfer + ffmpeg jobs). |
| `/offline` | `app/offline/page.tsx` | public | yes | Service-worker fallback when navigation fails. |
| `/v1/[...path]` | `app/v1/[...path]/route.ts` | passthrough | n/a | **Dev-only proxy** to the API (see below). |

App routes that must be reachable while offline are listed in `OFFLINE_SUPPORTED` inside `app/components/nav-links.tsx` (currently `library` + `settings`). Anything else is wrapped in an `OfflineGuard` layout that swaps in a friendly "you're offline" pane when `navigator.onLine === false`.

## The `/v1/[...path]` proxy

In **dev** the browser hits same-origin `/v1/...`. The Next.js route handler at `app/v1/[...path]/route.ts` forwards every method (GET/POST/PUT/PATCH/DELETE) to `${API_BASE_URL}/v1/...` and:

- Forwards `cookie` and `authorization` headers verbatim.
- For `multipart/*`, parses via `formData()` so fetch can regenerate the boundary correctly.
- For everything else, buffers the body via `arrayBuffer()` to avoid stream races on parallel requests.
- Pipes back `set-cookie` and `content-type` so login still writes httpOnly cookies onto the dev origin.

In **prod** behind nginx (keebox), the proxy is bypassed — nginx routes `/v1/*` directly to the API on `127.0.0.1:9669` and routes `/*` to the web container on `127.0.0.1:6996`. The route handler still exists in the bundle but receives no traffic.

Why dev needs the proxy: when the browser fetches `localhost:8000/v1/...` directly, the response sets cookies for the API origin, not the app origin — so subsequent same-origin server-component fetches can't read the cookie. Routing through `/v1` keeps everything single-origin during development.

> **Image gotcha:** `next/image` cannot optimize URLs that are rewritten by the proxy. Cached-artwork images that resolve to a blob URL or a rewritten path use `unoptimized` to skip the optimizer. See the `useLocalArt` patterns in `app/library/library-list.tsx`.

## Deep-linking within views

Routes that show song lists (`/library`, `/explore`, `/songs`) support per-song deep-linking via query parameters:

- **Songs/Artists/Genres/Playlists views:** `?song=<uuid>` scrolls to and highlights the song on page load. Scroll position is restored on back-button.
- **Albums view:** `?album=<id>` scrolls to and highlights the album.
- **Explore view:** `?window=day|week|all&sort=<field>&view=<layout>&song=<uuid>` restores the full explore state + scroll position.

Handlers in `library-list.tsx` and `explore-client.tsx` watch the URL and call `scrollTo()` after render. Scroll positions are restored from `sessionStorage` keyed by view name to survive back/forward but clear on page reload.

Active letter rail (desktop only) is computed from scroll position, not URL.

## `middleware.ts`

The Next middleware runs on every request that isn't in the negative matcher (`_next/static`, `_next/image`, `favicon.ico`, `sw.js`, `manifest.json`, app icons). Logic:

1. If `access_token` cookie is present and not expired → forward as-is.
2. If on `/`, `/share/*`, `/offline`, or `/v1/auth/*` → forward as-is (auth is allowed to call refresh / login pages render unauthenticated).
3. Otherwise, if a `refresh_token` cookie exists, hit `${API_BASE}/v1/auth/refresh` and:
   - On success: rewrite the request with the new `access_token` and set the new cookie on the response so subsequent client fetches pick it up.
   - On API unreachable: redirect to `/offline` (catches the "lost connection mid-session" case).
4. Otherwise → redirect to `/`.

This is the only place token refresh happens at the SSR boundary — the client also does its own refresh-on-401 in `app/lib/data.ts` (`tryRefresh`), deduplicated via `refreshPromise`.

## Surface variables + theming

All UI surfaces (navbar, library toolbar, explore header, player, download panel) use `bg-[var(--background)]/90 backdrop-blur` for consistency. The CSS variable `--background` is set to `rgb(3 7 18)` (gray-950) in `app/globals.css`. This creates a shared visual identity across the app.

Mobile UI has been compacted: larger card sizes, artwork, and player transport buttons for easier touch targeting.

## Media Session API

The player integrates with the OS-level media session for lock-screen controls on iOS/Android. Artwork is provided in multiple sizes via `navigator.mediaSession.metadata` to accommodate different platform requirements.

iOS-specific quirks the player works around:

- **Audio session release after pause.** iOS Safari releases the audio session ~10s after `audio.pause()` in the background, leaving the lock-screen play button unresponsive. Worked around by looping `public/silence.mp3` while "paused" instead of actually pausing the element.
- **Lock-screen position drift.** iOS polls `audio.currentTime`/`audio.duration` continuously for the lock-screen scrubber, so the silent file would show 0:00 / 0:01. Worked around by setting `mediaSession.playbackState = 'paused'` and re-asserting `setPositionState({ playbackRate: 1, position, duration })` on every silent-loop tick (must use non-zero playbackRate per spec).
- **Action handler loss after suspension.** iOS forgets registered `setActionHandler` bindings after backgrounded suspension and falls back to default ±10s seek markers. Re-bound on `visibilitychange` when the page becomes visible.
- **Stuck-spinner recovery.** When the silent loop dies during suspension, the same `visibilitychange` handler resets the UI to "ready to play" so the user sees a tappable play button instead of a stuck spinner.

See `docs/STATE.md` (PlayerProvider section) for the implementation details.

## Service worker — `public/sw.js`

Registered by `app/components/sw-register.tsx` only in `process.env.NODE_ENV === 'production'`. In dev, the registrar **unregisters** any prior SW so stale chunks don't break HMR.

Caches:

- `songbird-shell-v7` — `/offline`, `/`, `/library` precached on install. Fetch handler:
  - Static `_next/static/*` → cache-first (chunks are content-addressed, safe to cache forever).
  - RSC payloads (`?_rsc=`) → network-first, cache by pathname for offline RSC fetches.
  - Page navigations → network-first; cache 200s; on network failure fall back to cached page or `/offline`.
- `songbird-artwork-v1` — separate cache for two patterns:
  - `/_next/image*` requests (Next image optimizer): cache-first; falls back to checking the raw `?url=` parameter if the optimized URL isn't cached. This makes the same artwork accessible whether the request hits `Image` or a raw `<img>`.
  - `/v1/songs/{id}/artwork/*` (raw API artwork URL): cache-first.

Cache versioning: bumping the suffix (`-v6` → `-v7`) triggers the activate handler to delete stale caches. Always do this when SW logic changes shape.

## Offline strategy

Three layers cooperate:

1. **Service worker** — caches the app shell, JS chunks, RSC payloads, and artwork. Lets offline navigations to `/library` and `/settings` actually load HTML + JS.
2. **OPFS audio** — `app/lib/offline.ts` streams audio bytes from `/v1/download/{id}` and writes to `audio/<id>.<ext>` in the Origin Private File System. On playback, `loadSong` in `player.tsx` checks OPFS first via `getSongFile()` and creates a blob URL when present, skipping the network entirely. Falls back to IndexedDB (`songbird-audio` db, `files` store) when OPFS is unavailable (older browsers).
3. **Library snapshot** — `app/lib/offline-db.ts` (`songbird-offline` IndexedDB, `library-cache` store). The library page caches its `LibrarySong[]` so the offline UX still has data to render.
4. **Artwork warm** — `cacheArtworkUrls()` in `offline.ts` pre-fetches the artwork URLs for every cached song so the SW's `songbird-artwork-v1` cache is populated before the user goes offline.

The client tells the server which songs the user wants offline via `/v1/library/offline/*`. This is a cross-device hint — if you mark song X offline on phone, when you load library on laptop the UI knows to prompt you to download X locally.

## `OfflineGuard`

For routes that aren't useful offline (`/admin`, `/explore`, `/import`, `/download`, `/info`), the page-level `layout.tsx` wraps `{children}` in `<OfflineGuard feature="...">`. The guard reads `navigator.onLine` (via `use-online.ts`) and renders a friendly fallback with a "go to library" link instead of children. Library + settings are not wrapped because they work offline.

## Image optimization

`next.config.ts` enables `output: 'standalone'` (Docker), `experimental.middlewareClientMaxBodySize: '100mb'` (so import multipart uploads don't 413), and a single rewrite for `/v1/songs/:id/artwork/:size` so the optimizer can fetch raw bytes. `images.localPatterns` allows any `/v1/**` pathname; `images.remotePatterns` allows `**.mzstatic.com` (iTunes CDN) and `localhost`.

Cached artwork (e.g. served from the SW) cannot be re-optimized by `next/image` because the URL pattern is locally rewritten. Components that render cached artwork use the `unoptimized` prop to bypass the optimizer.

## Component map (the hairy ones)

| File | Role |
|---|---|
| `app/components/player.tsx` | `PlayerProvider`, persistent footer player, single `<audio>` element, queue, OPFS blob swap |
| `app/components/editor-modal.tsx` | WaveSurfer waveform, cuts/fades/trim/volume/speed, draft autosave, job submit + poll |
| `app/components/import-jobs-table.tsx` | Single shared poller for in-flight import jobs, paginated list, lifetime status counts |
| `app/library/library-list.tsx` | Library views (songs/artists/albums/genres/playlists), bulk select, save-all-offline, alpha scrubber |
| `app/components/song.tsx` | `Song` row component (memoized; data-only comparison) |
| `app/components/navbar.tsx` + `nav-links.tsx` | Top nav; dims links not supported offline |
| `app/components/offline-guard.tsx` | "you're offline" pane for non-supported routes |
| `app/components/offline-banner.tsx` | Sticky banner when `navigator.onLine === false` |
| `app/components/sw-register.tsx` | Registers `/sw.js` in prod; unregisters in dev |
| `app/lib/data.ts` | All API fetch helpers; SSR uses `cookies()`, client uses `credentials: 'include'`; refresh-on-401 dedupe |
| `app/lib/offline.ts` | OPFS + IndexedDB fallback for audio; `cacheArtworkUrls`; `getStorageEstimate` |
| `app/lib/use-virtual-list.ts` | Lightweight windowed list for the queue panel |
| `app/lib/use-multi-select.ts` | Range / shift-click selection used by the library bulk toolbar |

For deeper state-shape details, see [`STATE.md`](STATE.md).
