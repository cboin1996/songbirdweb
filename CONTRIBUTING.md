# Contributing — songbirdweb

## Branch policy

**Never commit to `main`.** Always work on a feature branch.

```bash
git checkout main && git pull
git checkout -b feat/<short-description>
```

When done, open a PR with `gh pr create` (don't push to `main` directly).

## Commit style

Short, semantic, lower-case. Prefix with the affected area when not obvious:

```
feat(library): bulk-select toolbar
fix(player): preserve manual_next on shuffle toggle
perf(library): React.memo song row with data-only comparison
docs: add architecture and state guides
chore(deps): bump next to 15.5.7
```

Rules:

- Don't add `Co-Authored-By` trailers (this isn't an open-source project; attribution lives in the git history).
- Don't include `🤖 Generated with...` lines.
- Body is optional but useful for non-trivial changes — explain *why*, not *what*.

## How to add a new page

Pages live under `app/<route>/page.tsx` (App Router). Use `app/library/page.tsx` as the template:

1. Create the directory and a server component `page.tsx` that fetches initial data via the helpers in `app/lib/data.ts`. SSR fetches automatically forward cookies via `next/headers` — no extra wiring needed.
2. If the page is mostly interactive, hand the data to a client component (e.g. `<LibraryList initialSongs={songs} />`). Keep the SSR seam thin.
3. Add a `layout.tsx` if the page needs a navbar wrap or an `<OfflineGuard>`. Most pages use `app/components/app-layout.tsx` (which mounts `NavBar` + `UserProvider`).
4. **Decide if it's offline-supported:**
   - **Offline-supported (works without network):** add the route to `OFFLINE_SUPPORTED` in `app/components/nav-links.tsx` so the link doesn't dim when offline. Today: `library` and `settings`.
   - **Online-only:** wrap in `<OfflineGuard feature="<name>">{children}</OfflineGuard>` inside the layout. The guard renders a friendly fallback when `navigator.onLine === false`.
5. Add an entry to the `links` array in `app/components/nav-links.tsx` if it should appear in the top nav. Admin-only links are gated by a `useUser()` check.
6. Add an entry to `routes` in `app/lib/routes.ts` so client code can `import { routes } from '../lib/routes'` instead of hardcoding strings.
7. Update `app/components/login.tsx` (or wherever post-login redirects happen) if the new page should be the default landing page.
8. Update `docs/ARCHITECTURE.md`'s route map.

## How to add a new component using `PlayerProvider`

`PlayerProvider` is mounted once in `app/layout.tsx`. Any client component can call `usePlayer()`:

```tsx
'use client'
import { usePlayer } from '../components/player'

export function MyButton({ song }: { song: PlayableSong }) {
  const { play, current, isPlaying } = usePlayer()
  const isThis = current?.uuid === song.uuid && isPlaying
  return (
    <button onClick={() => play(song, [song], { label: 'My feature', href: '/my', id: 'my' })}>
      {isThis ? 'pause' : 'play'}
    </button>
  )
}
```

Common patterns:

- **Play one song from a list:** `play(song, list, context)` — passing the list sets the queue so skip-next/prev works naturally. The `context` object (`{ label, href, id }`) appears as a "Playing from <label>" line above the player.
- **Insert next:** `insertNext(song)` — drops the song right after the currently playing one. `manual_next` is persisted server-side.
- **Add many to queue:** there is no public batch API; multiple `insertNext` calls work but show a toast each time. If you need bulk-enqueue, extend the context.
- **Don't directly mutate the audio element.** Use `play / pause / resume / skipNext / skipPrev`.

For player API details see `docs/STATE.md`.

## Service worker gotchas in dev

The SW is **disabled in development** by `app/components/sw-register.tsx`. In dev it actively unregisters any prior SW so stale chunks from a previous prod build don't break HMR.

If you need to test SW behavior (offline navigation, RSC cache, artwork cache):

```bash
npm run build
npm run start
```

…then open the app in an incognito window so a fresh SW installs. Bump cache versions in `public/sw.js` (`songbird-shell-v6` → `-v7`) when changing fetch handler shape so the activate handler purges old caches.

DevTools tips:

- Application → Service Workers → check "Update on reload" while iterating.
- Application → Cache Storage → inspect the `songbird-shell-vX` and `songbird-artwork-v1` caches.
- Network tab → "Offline" mode tests the OfflineGuard fallback.
- Application → Storage → "Clear site data" wipes cookies, OPFS, IndexedDB — useful after `dev-wipe` on the API side.

## How to run tests

```bash
npm test               # Jest + React Testing Library (unit)
npm run lint           # next lint (ESLint)

# E2E — recommended (CI-parity Docker harness, isolated API + Postgres)
make test-e2e-local        # dev project (Desktop Chrome on prod build)
make test-e2e-local-mobile  # mobile project (iPhone 13 viewport)
make e2e-down              # tear down containers when done

# E2E — against your local dev API on :8000 (faster iteration)
make test-e2e              # dev project (single worker)
make test-e2e-mobile       # mobile project
make test-e2e-prod         # service worker + offline (prod project)

npm run test:e2e           # raw Playwright (no harness, no env injection)
```

`make test-e2e-local` is the canonical way to run e2e — same image and seeded data as
CI. `make test-e2e` is for fast iteration against your own dev API. See
[`e2e/README.md`](e2e/README.md) for project layout, env vars, and conventions.

## Pre-PR checklist

- [ ] Branch is off `main` and up to date (`git fetch && git rebase origin/main`).
- [ ] `npm run lint` passes.
- [ ] `npm test` green.
- [ ] If you touched the player or offline path, also run `make test-e2e-local` locally.
- [ ] If you touched the SW or service-worker registration, do a manual `npm run build && npm run start` smoke (offline + online navigation, login flow, artwork load).
- [ ] If you added an env var, update `docs/ENV.md` and any `.env.*` placeholders.
- [ ] If you added a route, update `docs/ARCHITECTURE.md`'s route map and `nav-links.tsx`.
- [ ] Commit messages follow the semantic style (no `Co-Authored-By`, no Claude attribution).
- [ ] Manual smoke: log in, play a song, edit a song, import a file, log out.

## Useful repo paths

| Path | What |
|---|---|
| `app/` | App Router routes + layouts |
| `app/components/` | Shared client components |
| `app/lib/` | Pure client helpers (data fetching, OPFS, hooks) |
| `app/v1/[...path]/route.ts` | Dev-only API proxy |
| `middleware.ts` | Auth + token refresh |
| `public/sw.js` | Service worker (production) |
| `e2e/` | Playwright specs + helpers |
| `__tests__/` | Jest unit tests |
| `docs/` | This + ARCHITECTURE + STATE + ENV |
| `playwright.config.ts` | E2E config (dev server boot) |
| `jest.config.ts` | Jest config |
| `next.config.ts` | Build flags (standalone, body limit, image domains) |
