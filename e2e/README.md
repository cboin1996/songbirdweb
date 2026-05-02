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
| `player.spec.ts`       | Play/pause, skip, shuffle, repeat, queue drag, source links      |
| `queue.spec.ts`        | Queue panel, skip-next, manual-next                              |
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
| `sw.spec.ts`      | SW registers, becomes controller, version bumps purge old caches      |
| `offline.spec.ts` | `/library` from cache when offline, `/offline` fallback, manifest, full auth→play flow no errors |

### `e2e-mobile/` (mobile project)

| File                  | Coverage                                                            |
|-----------------------|---------------------------------------------------------------------|
| `responsive.spec.ts`  | Long-press → select mode, sticky header off, compact card layout, mobile player tap targets, queue→source link closes panel |

## Environment

Tests read from `.env.local` at repo root:

| Var                       | Purpose                                                        |
|---------------------------|----------------------------------------------------------------|
| `TEST_USERNAME` / `TEST_PASSWORD` | Shared read-only test user                            |
| `E2E_ADMIN_USERNAME` / `_PASSWORD` | Admin spec                                           |
| `E2E_EDITOR_USERNAME` / `_PASSWORD` | Per-suite isolation for editor mutations            |
| `E2E_BULK_USERNAME` / `_PASSWORD`   | Per-suite isolation for bulk-select mutations       |
| `E2E_IMPORT_USERNAME` / `_PASSWORD` | Per-suite isolation for import mutations            |
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

## State isolation

**Read-only specs** share the main test user — library is seeded with 9 fixture songs
in `global-setup.ts` and is NOT wiped between tests. Write specs that tolerate existing
library data.

**Destructive specs** (`editor.spec.ts`, `bulk-select.spec.ts`, `import.spec.ts`) get
their own user provisioned in `global-setup.ts`, each with its own seeded library and
storageState file. This is the per-suite isolation pass from `REFACTOR_PLAN.md` Phase
3.

User-scoped data created during a test (drafts, playlists, share tokens) should be
prefixed with `pw-test-` and purged in `afterAll`:

```ts
test.afterAll(async () => {
    const api = await apiLogin()
    await purgePlaylistsByPrefix(api, 'pw-test-')
})
```

## Conventions

- One `describe` per spec; `beforeEach` for per-test setup (login)
- Prefer `data-testid` over text/CSS selectors — text drift / Tailwind refactors break the others
- No hard-coded sleeps; use `expect.poll` or `toBeVisible({ timeout: ... })`
- Don't assert on toast / animation timing — race-prone
- New helpers go in `helpers.ts`, not inline in specs

In-progress refactor phases (testid pass, page object models, fixme triage) are tracked
in [the E2E refactor epic](https://github.com/cboin1996/songbirdweb/issues/10).
