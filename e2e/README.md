# Playwright E2E Suite

End-to-end coverage for songbirdweb. Three Playwright projects share configuration but
target different concerns:

| Project  | Test dir       | Viewport         | Server                | What it covers                              |
|----------|----------------|------------------|-----------------------|---------------------------------------------|
| `dev`    | `e2e/`         | Desktop Chrome   | Next dev (`:3000`)    | Business logic, navigation, auth            |
| `prod`   | `e2e-prod/`    | Desktop Chrome   | Next prod (`:6996`)   | Service worker lifecycle, offline cache, PWA |
| `mobile` | `e2e-mobile/`  | iPhone 13        | Next dev (`:3000`)    | Mobile-only layout/UX (long-press, etc.)    |

The mobile and prod projects exist because dev-server SW is disabled (`sw-register.tsx`)
and mobile-specific behavior (long-press, sticky-header) only manifests at the right
viewport.

## Running tests

The recommended path is the **CI-parity Docker harness** — same image, same ports, same
seed data as CI:

```bash
make test-e2e-local         # project=dev (default)
make test-e2e-local-mobile  # project=mobile
```

The harness brings up an isolated API on `:8001` and a Next prod build on `:3001` and
runs Playwright with `--workers=4`. Bring it down with `make e2e-next-down` /
`make e2e-api-down` between code changes (otherwise the harness reuses the prior
build).

For non-Docker iteration:

```bash
# Direct playwright (assumes local dev server on :3000 + API on :8000)
npx playwright test --project=dev e2e/library.spec.ts
npx playwright test --headed e2e/player.spec.ts
npx playwright show-report
```

The `prod` project has its own `webServer` block in `playwright.config.ts` that builds
and starts a prod server automatically; just run `npx playwright test --project=prod`.

## Spec inventory

### `e2e/` (dev project)

| File                   | Coverage                                                         |
|------------------------|------------------------------------------------------------------|
| `smoke.spec.ts`        | Login + library load + nav top-level                              |
| `login.spec.ts`        | Auth happy path + bad creds                                      |
| `navigation.spec.ts`   | Every authed page loads without console errors                   |
| `library.spec.ts`      | View tabs, search, letter rail, scrub bar                        |
| `bulk-select.spec.ts`  | Select mode, bulk action bar, bulk add to playlist               |
| `player.spec.ts`       | Play/pause, skip, shuffle, repeat (a repeat-all lap plays every song once), queue drag, source links |
| `player-sync.spec.ts`  | Server-state restore, cross-device resync on tab return (what it adopts, what it must not clobber, a toggle the server never heard is kept and sent again), a stored copy of the state is not taken for the server's, token refresh on return |
| `error-states.spec.ts` | API failures per page, and playback failure: one silent retry, bounded error cascade, stop on the last song, expired session sends the user to sign in |
| `search.spec.ts`       | Library search and queue-panel search                            |
| `queue.spec.ts`        | Queue panel, skip-next, manual-next; the order queue changes reach the server in, a write that times out, a dead zone that ends on its own |
| `playlist.spec.ts`     | Create / add / rename / delete                                    |
| `editor.spec.ts`       | Modal open, properties, cuts/fades, draft save                    |
| `import.spec.ts`       | Drop file, dove banner, status counts, history                    |
| `download.spec.ts`     | Song / album / URL modes                                         |
| `explore.spec.ts`      | Window/sort/view filters, search                                 |
| `settings.spec.ts`     | Password change, clear cache                                     |
| `share.spec.ts`        | Share kebab + `/share/[token]` page                              |
| `offline.spec.ts`      | OfflineGuard pages, banner, cached-only library                   |
| `info.spec.ts`         | Info page renders, no console errors                             |
| `admin.spec.ts`        | Admin gating, system stats, user table                           |
| `investigate-401.spec.ts` | Auth-failure repro (kept as a debugging aid)                  |

### `e2e-prod/` (prod project — SW-gated)

| File              | Coverage                                                              |
|-------------------|-----------------------------------------------------------------------|
| `sw.spec.ts`      | SW registers, becomes controller, version bumps purge old caches, an install while signed out does not store the sign-in page as the library, a library visit made online is stored and opens on the next offline launch |
| `offline.spec.ts` | `/library` from cache when offline, `/offline` fallback, manifest, cache audit — read-only, main test user |
| `offline-songs.spec.ts` | Saving songs and playing them offline: saved song plays, offline advance steps over unsaved songs (also in a dead zone, where the browser still says online), taps and skip-back that cannot play change nothing, a launch offline on an empty file plays on with one press, the queue marks unsaved songs and counts the saved ones, shuffle and repeat-all laps, end of queue, first play in airplane mode, the 401-on-download retry, save-all's refresh (before each song, dead refresh, refused downloads). Serial, own `E2E_OFFLINE` user — these write the user's server-side offline list and player state |

### `e2e-mobile/` (mobile project)

| File                  | Coverage                                                            |
|-----------------------|---------------------------------------------------------------------|
| `responsive.spec.ts`  | Long-press → select mode, sticky header off, compact card layout, mobile player tap targets, queue→source link closes panel |

## Environment

Tests read from `.env.local` at repo root:

| Var                       | Purpose                                                        |
|---------------------------|----------------------------------------------------------------|
| `TEST_USERNAME` / `TEST_PASSWORD` | Shared read-only test user (admin, info, nav, login, `e2e-prod/offline`, share, smoke, playlist) |
| `E2E_ADMIN_USERNAME` / `_PASSWORD` | Admin for global-setup user provisioning             |
| `E2E_EDITOR_USERNAME` / `_PASSWORD` | editor.spec.ts                                     |
| `E2E_BULK_USERNAME` / `_PASSWORD`   | bulk-select.spec.ts                                |
| `E2E_IMPORT_USERNAME` / `_PASSWORD` | import.spec.ts                                     |
| `E2E_QUEUE_USERNAME` / `_PASSWORD`  | queue.spec.ts, search.spec.ts (queue search block) |
| `E2E_PLAYER_USERNAME` / `_PASSWORD` | player.spec.ts                                     |
| `E2E_SYNC_USERNAME` / `_PASSWORD`   | player-sync.spec.ts                                |
| `E2E_DOWNLOAD_USERNAME` / `_PASSWORD` | download.spec.ts                                 |
| `E2E_SETTINGS_USERNAME` / `_PASSWORD` | settings.spec.ts (audio format block)            |
| `E2E_LIBRARY_USERNAME` / `_PASSWORD` | library.spec.ts                                   |
| `E2E_SEARCH_USERNAME` / `_PASSWORD`  | search.spec.ts (library search block)             |
| `E2E_ERROR_USERNAME` / `_PASSWORD`   | error-states.spec.ts                              |
| `E2E_OFFLINE_USERNAME` / `_PASSWORD` | e2e-prod/offline-songs.spec.ts                    |
| `NEXT_PUBLIC_API_BASE_URL`        | Empty in dev (browser uses relative URLs through Next proxy) |
| `E2E_API_BASE_URL`                | Override when API is on a different host                |

`API_BASE` resolution in `helpers.ts` falls back via
`E2E_API_BASE_URL || NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'`. The fallback
matters because `NEXT_PUBLIC_API_BASE_URL` is intentionally empty in dev — without it,
`apiLogin()` produces invalid URLs.

## Architecture

```
Playwright runner ─── browser context (cookies, login) ── songbirdweb (3000 / 3001 / 6996)
        │                                                              │
        └─── APIRequestContext (direct calls) ─────────── songbirdapi (8000 / 8001)
```

Browser-side flows use `page.goto`, real clicks, etc. API-side flows (via `apiLogin()`)
hit FastAPI directly for state init/cleanup — faster and less brittle than driving the
UI for setup.

## Helpers (`helpers.ts`)

| Function                              | Purpose                                                   |
|---------------------------------------|-----------------------------------------------------------|
| `login(page)`                         | Sets httpOnly cookies in the browser; lands on `/download`|
| `apiLogin()`                          | Authenticated `APIRequestContext` for state setup         |
| `uniq(prefix)`                        | `<prefix>-<timestamp>-<rand>` for collision-free test data |
| `purgePlaylistsByPrefix(api, prefix)` | Delete any playlist whose name starts with `prefix`       |
| `pickFirstLibrarySong(api)`           | Grab any library song UUID + track for tests that just need *a* song |
| `ignoreError(msg)`                    | Console-error allow-list (AbortError, favicon 404, fetch-during-nav, etc.) |
| `clearLocalAudio(page)`               | Empty the OPFS audio folder and the saved-songs index      |
| `libraryIds(page)`                    | Song ids in library order (each song renders two cards, so deduped) |
| `saveSongOffline(page, uuid)`         | Save one song offline through its menu and wait until held |
| `playLibraryPaused(page, opts)`       | Start Play All, set shuffle/repeat, and leave it paused    |
| `setVisibility(page, state)`          | Drive a tab hide/show the way the player observes it       |
| `songTrackName(page, uuid)`           | The displayed track name of a library song                 |
| `recordDownloadRequests(page)`        | Ids of every song-audio request the page makes, in order   |
| `recordDownloads(page, respond?)`     | Intercept song downloads, recording ids; `respond` decides the answer |
| `restoredSongId(page)`                | The song the player restored on load, read off the stream URL |
| `expectStable(read, ms?)`             | Assert a value does not change for `ms` — for "nothing happens" checks without a sleep |
| `emptySavedFile(page, uuid)`          | Leave a song listed as saved with nothing in its file      |
| `enterDeadZone(page, context)`        | Network gone while the browser still reports online        |
| `failAnApiRequest(page, player)`      | Make the app's first failed request, so it learns the server is gone |
| `routeStalePlayerState(page, body)`   | Answer player-state reads the way the service worker does with a stored copy |

## State isolation

**Most specs get their own isolated user** provisioned in `global-setup.ts`, each with
a seeded library of 9 fixture songs and its own logins. This prevents
cross-spec interference when tests run in parallel across 4 workers.

**Read-only specs** (admin, info, navigation, login, `e2e-prod/offline`, share, smoke, playlist)
share the main test user since they don't mutate server state that other specs depend on.
A spec that saves songs offline or presses Play All is not read-only: it writes the
user's server-side offline list and player state, so it gets its own user
(`e2e-prod/offline-songs.spec.ts`).

**Write specs** that mutate player state, settings, or library contents get dedicated
users: player, sync, download, settings, library, search, error-states, editor,
bulk-select, import, queue, offline.

To add a new isolated user:
1. Add env vars to `.env.local`, `.github/workflows/test.yml`
2. Add constants to `global-setup.ts` and `helpers.ts`
3. Register + seed in `globalSetup()`
4. Import `test` from `./fixtures/test` and use `test.use({ authUser: '<name>-user' })` in the spec

**Logins are per worker.** The API rotates refresh tokens and revokes a session when it sees a token it already replaced, so parallel tests must never share one login. `global-setup.ts` logs each user in once per Playwright worker (`e2e/.auth/<name>-user.w<N>.json`) and `e2e/fixtures/test.ts` hands each test its own worker's file. The e2e API container runs with `COOKIE_SECURE=false` (plain HTTP) and `SESSION_MAX_PER_USER=1000` (tests log in far more than 10 times); an API image from before those settings ignores them.

User-scoped data created during a test (drafts, playlists, share tokens) should be
prefixed with `e2e-` and purged in `afterAll`:

```ts
test.afterAll(async () => {
    const api = await apiLoginAs(MY_USERNAME, MY_PASSWORD)
    await purgePlaylistsByPrefix(api, 'e2e-')
    await api.dispose()
})
```

## Conventions

- One `describe` per spec; `beforeEach` for per-test setup (login)
- Prefer `data-testid` over text/CSS selectors — text drift / Tailwind refactors break the others
- No hard-coded sleeps; use `expect.poll` or `toBeVisible({ timeout: ... })`
- Don't assert on toast / animation timing — race-prone
- New helpers go in `helpers.ts`, not inline in specs

Per-spec user isolation eliminates the main source of flakiness (parallel specs stomping
shared player state, settings, and library contents).
