# Production E2E Tests

Tests for service-worker lifecycle, offline behavior, and PWA fundamentals. These tests require a production build and cannot run against the dev server (SW is disabled in dev via `app/components/sw-register.tsx`).

## Running Tests

Build and start the prod server, then run tests:

```bash
npm run build
npm run start
# In another terminal:
npx playwright test --project=prod
```

Or use the Playwright config's integrated webServer (will build and start automatically):

```bash
npx playwright test --project=prod
```

List all prod tests:

```bash
npx playwright test --list --project=prod
```

## What's Tested

**sw.spec.ts** — Service Worker registration and caching:
- SW registers and becomes controller on first page load
- Cache version bumps purge old versions (v0 deleted when v7 activates)
- Static JS chunks served from cache on reload (minimal network requests)

**offline.spec.ts** — Offline fallback and PWA:
- /library loads from cache when offline
- Uncached navigation routes fall through to /offline page
- OfflineGuard component on /import shows "you're offline" when offline
- Cached songs play while offline
- /manifest.json returns valid PWA manifest with icons
- Full auth→library→play flow has no console errors

## Why Prod-Only

The dev server (`npm run dev`) disables the service worker via a feature flag in `app/components/sw-register.tsx`. These tests verify the real SW lifecycle and offline behavior that only works with `npm run start` (production build).

Dev E2E tests (`npx playwright test`) run against the dev server and focus on business logic, navigation, and auth. Prod E2E tests focus on caching, offline resilience, and manifest correctness.
