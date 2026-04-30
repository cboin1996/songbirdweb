# Playwright E2E Suite

Locks in observable behavior at the `keebox-beta-1` baseline. Tests describe what the app does *today*; failures are bugs to file, not signals to "fix the test."

## Running

```bash
# Local dev server must be running on :3000 with API on :8000
ENV=dev make local-run            # in songbirdapi (separate terminal)
npm run dev                       # in songbirdweb

# Run the full suite
npx playwright test --reporter=line

# Single spec
npx playwright test e2e/library.spec.ts

# Headed (watch the browser)
npx playwright test --headed e2e/player.spec.ts

# Open the HTML report after a run
npx playwright show-report
```

## Environment

Tests read from `.env.local`:

| Var | Purpose | Example |
|---|---|---|
| `TEST_USERNAME` | account used in browser + API logins | `cboin` |
| `TEST_PASSWORD` | password for that account | (your dev password) |
| `NEXT_PUBLIC_API_BASE_URL` | empty in dev — browser uses relative URLs | `''` |
| `E2E_API_BASE_URL` | optional override for tests when API is on a different host | `http://staging:8000` |

## Architecture

```
Playwright runner ─── browser context ── (cookies, login) ── songbirdweb (3000)
        │                                                         │
        └─── APIRequestContext ── direct calls ────────── songbirdapi (8000)
```

The browser-side flow uses `page.goto`, real clicks, etc. The API-side flow (via `apiLogin()`) calls the FastAPI directly for state init/cleanup — faster and less brittle than driving the UI for setup.

**Important**: `API_BASE` resolution in `helpers.ts` falls back via `E2E_API_BASE_URL || NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'` because `NEXT_PUBLIC_API_BASE_URL` is intentionally empty in dev (so the browser uses relative paths through the Next.js proxy). Without the fallback, `apiLogin()` produces invalid URLs.

## Helpers (`helpers.ts`)

| Function | Purpose |
|---|---|
| `login(page)` | Sets httpOnly cookies in the browser context; lands on `/download` |
| `apiLogin()` | Returns an `APIRequestContext` already authenticated — for state setup outside the browser |
| `uniq(prefix)` | Returns `<prefix>-<timestamp>-<rand>` for collision-free test data |
| `purgePlaylistsByPrefix(api, prefix)` | Cleanup helper — deletes any playlist whose name starts with `prefix` |
| `pickFirstLibrarySong(api)` | Grab any library song UUID + track for tests that just need *a* song |
| `ignoreError(msg)` | Console-error allow-list (AbortError, favicon 404, fetch-during-nav, etc.) |

## State isolation

Default strategy: **shared dev DB, per-test data with unique prefixes, cleanup at end**.

```ts
test.afterAll(async () => {
    const api = await apiLogin()
    await purgePlaylistsByPrefix(api, 'pw-test-')
})
```

If you create user-scoped data (drafts, playlists, share tokens), prefix it with `pw-test-` and purge in `afterAll`. Songs and the library itself are NOT wiped between tests — write specs that tolerate existing library data.

For tests that need a *clean* library, run `ENV=dev make dev-wipe` in songbirdapi between test runs (manual). A future "test database" mode would isolate fully but isn't built yet.

## Spec inventory

| File | Coverage |
|---|---|
| `smoke.spec.ts` | login + library load + nav top-level |
| `login.spec.ts` | auth happy path + bad creds |
| `navigation.spec.ts` | every authed page loads without console errors |
| `library.spec.ts` | view tabs (songs/artists/albums/genres/playlists), search, scrub bar |
| `bulk-select.spec.ts` | Select mode + bulk action bar + bulk add to playlist |
| `player.spec.ts` | play, pause, skip, shuffle, repeat |
| `queue.spec.ts` | queue panel open, skip-next |
| `playlist.spec.ts` | create / add songs / rename / delete |
| `editor.spec.ts` | open modal, properties, cuts/fades, draft save |
| `import.spec.ts` | drop file, dove banner, status counts, history |
| `download.spec.ts` | song / album / URL modes |
| `explore.spec.ts` | window/sort/view filters, search |
| `settings.spec.ts` | password change, clear cache |
| `share.spec.ts` | "copy share link" kebab + `/share/[token]` page |
| `offline.spec.ts` | OfflineGuard pages, banner, cached-only library |
| `info.spec.ts` | info page renders, no console errors |
| `admin.spec.ts` | admin gating, system stats, user table |

## Known issues (punch list)

Tests document the broken behavior — a `.skip()` or `xfail` marks something for follow-up. Bug fixes go in *separate* PRs, not the test PR.

### Real source bugs found by the harness

| Severity | Test | File:line | Symptom | Likely fix |
|---|---|---|---|---|
| MED | `Album button switches to /download/album` | `e2e/download.spec.ts:31` | Clicking the album button on `/download` lands on `/download?mode=album` instead of `/download/album?mode=album`. Two `router.replace` calls in `Search` component race (`handleModeChange` + `useEffect` on `mode` change). | Drop the `useEffect`-driven replace; do all URL updates inside `handleModeChange`. |

### Tests blocked on missing UI / refactor

Marked `test.fixme()` — tests describe intended behavior but the helper or selector doesn't exist:

- `bulk-select.spec.ts` — "exit select mode by clicking Cancel", "bulk add to playlist". Select mode is entered via long-press on a song card (no "Select" button). Need to drive a touch long-press in Playwright.
- `bulk-select.spec.ts` — "bulk Remove confirms and removes". Destructive in shared dev DB; gate behind `TEST_BULK_REMOVE` once per-test isolation exists.
- `bulk-select.spec.ts` — "bulk Save offline triggers cache writes". Network/IndexedDB heavy; needs separate offline-suite harness.
- `bulk-select.spec.ts` — "bulk Download triggers a download per song". Needs `page.waitForEvent('download')` orchestration.
- `editor.spec.ts` — "opens editor modal for Jolene", "sliders are interactive". Helper `openEditorForJolene` uses iTunes search flow (network dep + fragile kebab `title="more"`). Refactor to open editor from a song already in the user's library.
- `editor.spec.ts` — "fade-cut ear collision: add cut → expand fade-out ear left → add second cut respects fade range". Requires precise pointer drag on the waveform-rendered fade-out handle (no stable testid). Locks in the simpler "two cuts can coexist" assertion as a baseline.
- `import.spec.ts` — "removing a row works". Import history rows have no remove button (server-persisted jobs).
- `library.spec.ts` — "save all offline: beforeunload warning fires while in-flight". `savingAll` flag drains too quickly for a small library — beforeunload listener registers/unregisters before navigation can fire.
- `offline.spec.ts` — "library loads cached songs when offline". SW is disabled in dev (`sw-register.tsx`). Test requires production build.

### Watch list (flaky / timing-sensitive)

- `info.spec.ts` "info page accessible via navbar link" — sometimes `a[href="/info"]` matches multiple; use `.first()` (already done).
- `library.spec.ts:24` "artists tab updates URL" — bumped timeout, may still be flaky.
- `playlist.spec.ts:33` "create playlist via UI then verify via API" — UI tile rendering can lag the API response; we now poll the API first then assert UI.
- `share.spec.ts:17` "Link copied!" — depends on backend share-token POST round-trip.

## Status snapshot (last triage pass)

Against the `keebox-beta-1` baseline:

- ~47 passing, ~13 marked `.fixme()`, several flakies on the watch list
- 1 real source bug surfaced (`Search` component double-replace race — see punch list)
- `did not run` count is high because Playwright skips dependent tests after a worker fails; resolving the flakies should unstick most of those

To get the most reliable run locally:

```bash
# Single-worker run avoids dev-server contention under parallelism
npx playwright test --workers=1 --reporter=line
```

## Conventions

- One `describe` per spec, `beforeEach` for per-test setup (login)
- Use `data-testid` over text where possible — text changes break tests cosmetically
- Avoid hard-coded sleeps; use `expect.poll` or `toBeVisible({ timeout: ... })`
- Don't assert on toast / animation timing — they're race-prone
- New helpers go in `helpers.ts`, not inline in specs
