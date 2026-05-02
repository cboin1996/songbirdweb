# E2E Refactor Plan

## Audit snapshot (2026-05-01)
- 245+ tests across 19 spec files, 3 projects (dev / prod / mobile)
- `fullyParallel: true`, serial-per-file, 1 shared test user, global setup seeds 9 fixture songs

---

## Phase 1 — waitForTimeout → deterministic waits ✅ done (commits 877cbff, b93421c)

Replaced 36 of 55 hard-coded sleeps. 19 remain — all inside `test.fixme()` or
`test.skip(!!process.env.CI)` blocks, so they have zero impact on CI.

Replacement patterns used:
| Old pattern | New pattern |
|---|---|
| wait after click for class change | `expect(el).not.toHaveAttribute('class', before)` |
| wait for queue panel to open | `expect(player-queue-panel).toBeVisible({ timeout: 3000 })` |
| wait for debounced server save | `page.waitForResponse(r => r.url().includes('/player/state') && r.request().method() === 'PUT', { timeout: 8000 })` (set up BEFORE the triggering action) |
| wait for page errors to surface | `page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})` |
| wait for scroll to complete | `expect.poll(() => el.evaluate(getBoundingClientRect check), { timeout: 5000 }).toBe(true)` |
| wait for waveform ready | `expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 15000 })` |
| simple click settling (React re-render) | removed — Playwright auto-waits handle these |

---

## Phase 2 — data-testid pass on fragile CSS selectors ← next

**Priority: High.** Any Tailwind refactor silently breaks these selectors.

| Selector | File | Proposed testid |
|---|---|---|
| `div.touch-none.select-none.cursor-pointer` | library.spec.ts | `data-testid="letter-rail"` |
| `span.font-bold.text-sky-500` | library.spec.ts | `data-testid="letter-rail-active"` |
| `.bg-amber-400` | offline.spec.ts | `data-testid="offline-banner"` |
| `div.fixed.z-50.shadow-xl` | playlist.spec.ts | `data-testid="context-menu"` |
| `button[title="preview with edits"]` | editor.spec.ts | `data-testid="editor-preview-btn"` |
| `button[title="stop preview"]` | editor.spec.ts | `data-testid="editor-stop-preview-btn"` |
| `button[title="undo (Ctrl+Z)"]` | editor.spec.ts | `data-testid="editor-undo-btn"` |
| `button[title="redo (Ctrl+Shift+Z)"]` | editor.spec.ts | `data-testid="editor-redo-btn"` |
| `button[title="remove cut"]` | editor.spec.ts | `data-testid="editor-remove-cut-btn"` |
| `span.cursor-grab` | player.spec.ts | `data-testid="queue-drag-handle"` |

Requires app code changes (no test-only pass). ~4–8h.

---

## Phase 3 — per-suite user isolation for destructive tests ✅ done

**Priority: Medium.** Needed before raising worker count above 2.

**Problem:** `editor.spec.ts` and `bulk-select.spec.ts` mutate shared library state
(delete songs, save new versions). Running them in parallel with `library.spec.ts`
or `player.spec.ts` causes silent races.

**Solution:** provision one user per destructive spec in `global-setup.ts`, each
with its own seeded library and storageState file.

Destructive specs needing own user:
- `editor.spec.ts`
- `bulk-select.spec.ts`
- `import.spec.ts`
- `settings.spec.ts` (already creates its own user — verify it's isolated)

Read-only specs can keep sharing the main test user:
- `library.spec.ts`, `player.spec.ts`, `queue.spec.ts`, `explore.spec.ts`,
  `navigation.spec.ts`, `info.spec.ts`, `share.spec.ts`, `offline.spec.ts`,
  `admin.spec.ts`, `download.spec.ts`, `playlist.spec.ts`

Implementation:
1. `global-setup.ts`: create `EDITOR_USERNAME`, `BULK_USERNAME`, `IMPORT_USERNAME`
2. Seed each with the 9 fixture songs
3. Save separate storageState files per user
4. Update spec `beforeEach` to use the right storageState
5. Update `global-teardown.ts` to purge all test users' playlists

Effort: ~8–12h.

---

## Phase 4 — page object models

**Priority: Medium.** Reduces selector duplication; makes future UI refactors cheaper.

Proposed structure:
```
e2e/pages/
  Library.ts    — song cards, letter rail, tabs, sort
  Player.ts     — bar, play/pause, shuffle, repeat, queue panel, drag handle
  Editor.ts     — waveform, preview/stop, undo/redo, cuts, properties tab
  Download.ts   — search, results, kebab
  Common.ts     — navbar, offline banner, auth helpers
```

Extract from: repeated `page.getByTestId(...)` patterns inside spec files.
Effort: ~8–12h.

---

## Phase 5 — fixme triage (partial — 9faa7a2)

First pass attempted 4 fixmes; 2 landed, 2 re-fixme'd with deeper notes:

**Landed:**
- `navigation.spec.ts` — added `.first()` defensively against link text matches outside the navbar
- `player.spec.ts` — timestamps render in M:SS: replaced one-shot regex with `expect.poll`

**Re-fixme'd with new notes:**
- `library.spec.ts` — letter-rail selector fix was correct (`filter+has` was looking for descendant span; classes are ON the span itself), but root cause is `scrollIntoViewIfNeeded()` doesn't fire the rAF-debounced active-letter handler
- `offline.spec.ts` — library-list returns the empty-state message instead of the toolbar when offline AND no cached songs, so `save-all-offline` button doesn't render for the seed user. Needs to first cache a song while online, then flip offline

**Still pending (categorized but not yet attempted):**
- *Keep (environment limits)*:
  - `player.spec.ts` — position persistence: headless Chromium won't advance `audio.currentTime`
  - `editor.spec.ts` — waveform drag handle (no stable selector until phase 2 adds testid)
  - `editor.spec.ts` — close-guard "don't show again" (banner disappears before Playwright can click)
- *Fix (has a clear path)*:
  - `editor.spec.ts` — version badge: add `data-testid="version-badge"` (phase 2)
  - `editor.spec.ts` — add-cut button disabled before wsReady: rewrite using preview-btn ready signal
- *Delete (premise no longer valid)*:
  - `editor.spec.ts` — global fade-in/out sliders, zoom slider, loop button: UI was redesigned, tests reference controls that don't exist

Remaining effort: ~3–5h.

---

## Known test coverage gaps (low priority)

- Admin: only visibility tests, no user management operations
- Settings: only password change tested
- E2E for responsive/mobile layout (e2e-mobile project exists but thin)
- Error boundaries / 500 handling
- Network interruption mid-request (beyond offline banner)
