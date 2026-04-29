# songbirdweb — React state model

The web app keeps three layers of state:

1. **Server state** — fetched on demand from `songbirdapi`. Server components read it via `app/lib/data.ts` (forwarding cookies). Client components fetch with `credentials: 'include'`.
2. **React contexts** — `PlayerProvider`, `UserProvider`. Mounted once at the top of the tree.
3. **Component-local `useState`** — most pages keep their own UI state.

This doc maps the contexts and the most state-heavy components. For the page/route map, see `ARCHITECTURE.md`.

## `PlayerProvider` — `app/components/player.tsx`

Mounted once in `app/layout.tsx` so a single `<audio>` element survives every navigation. Owns queue, current song, shuffle/repeat, queue sources, and persists all of it to the server (`/v1/player/state`). No longer uses localStorage — state is server-authoritative.

### Public API — `usePlayer()`

```ts
interface PlayerContextValue {
  current: PlayableSong | null
  isPlaying: boolean
  queue: PlayableSong[]
  shuffle: boolean
  repeat: 'off' | 'one' | 'all'
  playContext: PlayContext | null     // { label, href, id } — what triggered this queue
  play: (song, queue?, context?) => void  // sets queue and starts immediately
  pause: () => void
  resume: () => void
  skipNext: () => void
  skipPrev: () => void
  toggleShuffle: () => void
  toggleRepeat: () => void
  insertNext: (song) => void          // inject after the current track (manual_next)
  removeFromQueue: (index: number) => void
  reorderQueue: (fromIdx, toIdx) => void
  showToast: (msg, error?) => void    // small status pill near the player
}
```

### Internal state of note

| Ref / state | Purpose |
|---|---|
| `audioRef` | The single `<audio>` element. |
| `queueRef`, `queueIndexRef` | Source of truth for queue + index; mirrored to React state for renders. Stable callbacks read refs to avoid stale closures. |
| `queueSourcesRef` | Array of `QueueSource` objects ({ label, href, id }) — persisted to server so the player knows what context triggered the current queue (e.g., "all songs", "artist X"). |
| `manualNextRef` | Songs that were inserted via `insertNext` — they play before the natural queue order resumes. Persisted server-side so reload preserves them. |
| `shuffleOrderRef`, `shuffleSeedRef`, `shufflePosRef` | Pre-computed shuffle order (Mulberry32-seeded) so the queue panel can show upcoming songs deterministically. The seed is persisted; reload reproduces the same order. Toggling shuffle off+on preserves seed; drag in shuffled mode reorders shuffleOrder without reseeding. |
| `loadGenRef` | Generation counter; every `loadSong` call bumps it. Late awaits check `gen !== loadGenRef.current` and bail to avoid a stale OPFS swap clobbering a newer song. |
| `blobUrlRef` | The current OPFS blob URL (revoked on next load to avoid leaks). |
| `pendingPosition` | Resume position to seek to once `loadedmetadata` fires. |
| `shouldPlayRef` | Set to true between `audio.load()` and the metadata event so we know to call `play()` then. |
| `autoplayActivatedRef` | First play must call `audio.play()` synchronously inside the user-gesture window. After that, awaits before touching the audio element are safe. |
| `saveTimerRef` | Throttles server-state saves (queue mutations + position checkpoints). |

### Persistence schedule

- **Queue + shuffle + repeat + queue_sources:** `scheduleSave()` debounces a `PUT /v1/player/state` after every queue mutation. On page load, `GET /v1/player/state` restores the entire state from the server (queue sources are now server-of-truth, not localStorage).
- **Position (`last_position` on `user_songs`):** `PATCH /v1/library/{id}/position` every 10 s while playing and on pause.
- **Play event:** `POST /v1/songs/{id}/play` after 30 s of continuous play.

### Keyboard shortcuts

`Space` play/pause, `←/→` skip prev/next. Wired in a `useEffect` that listens on `window`. Media Session API integration sets `navigator.mediaSession.setActionHandler('previoustrack' | 'nexttrack')` so the OS-level controls work.

## `UserProvider` — `app/lib/user-context.tsx`

Tiny context exposing:

```ts
interface UserCtx {
  isAdmin: boolean
  username: string
}
```

Populated in `app/components/app-layout.tsx` from a server-side `fetchCurrentUser()` call. Used by `nav-links.tsx` (to conditionally render the admin link) and any client component that needs to gate UI on role. Read via `useUser()`.

## Library state — `app/library/library-list.tsx`

Big component because library is the central UX. State lives entirely in this client component; the server component (`page.tsx`) only seeds `initialSongs`.

| State | Type | Updates when |
|---|---|---|
| `songs` | `LibrarySong[]` | initial hydration, `EVENTS.songRemoved`, post-publish refetch, post-bulk-remove |
| `scrollPos` | `number` | sessionStorage-backed scroll position; restored on navigation back, cleared on reload |
| `cachedIds` | `Set<string>` | OPFS scan on mount, after each per-song download, on `EVENTS.offlineCleared`, after `Save all offline` |
| `offlineReady` | `boolean` | true after first successful OPFS scan |
| `savingAll` / `saveAllProgress` | flags + counter | during the bulk "save all offline" flow |
| `failedIds` | `Set<string>` | songs that failed to download to OPFS (shown with retry pill) |
| `syncPromptIds` | `string[]` | server-side offline list ⊃ local OPFS list — UI prompts to download these |
| `playlists` | `Playlist[]` | when the playlists tab opens |
| `draftIds` | `Set<string>` | songs with an autosaved editor draft (used by `EditsBanner`) |
| `eligibleSongs` | `EligibleSong[]` | `fetchEligibleSongs()` on mount + after publish |
| `eligibleCount` | `number` | derived count for the publish-bar badge |
| `publishModalOpen`, `publishing` | flags | publish-to-community modal lifecycle |
| `offlineSyncModalOpen` | flag | cross-device sync modal lifecycle |
| `selectMode`, `selectedIds`, `lastSelectedId` | bulk-select state | toggled by the toolbar; range select works via shift-click + drag |
| `bulkLoading`, `bulkPlaylistPicking` | flags | during bulk remove / bulk-add-to-playlist |
| `activeLetter`, `scrubLetter` | alpha-scrub state | desktop scroll position updates `activeLetter` on scroll; mobile scrubber sets `scrubLetter` while dragging (URL not used) |

### Cross-component events

`app/lib/events.ts` re-exports a tiny event-name registry. Components dispatch `window.dispatchEvent(new Event(EVENTS.songRemoved))` etc. The library list listens for `offlineCleared` (settings page wiped OPFS) and `songRemoved` (editor modal deleted a draft + song).

## Editor state — `app/components/editor-modal.tsx`

A modal that owns the WaveSurfer instance plus dual waveforms (original + edit). State worth knowing about:

| State | Notes |
|---|---|
| `params` | `EditParams` — trim_start, trim_end, volume, fades[], cuts[], speed, normalize. Mirrored to `paramsRef` for stable callbacks. |
| `historyRef`, `redoStackRef` | Undo/redo stacks (params snapshots). Capped to a small depth. |
| `pendingSnapshotRef` | Holds a snapshot for the *previous* state during a region drag, committed to history on drag end. |
| `eligibility` | `SongEligibility` — refetched after every successful save. Drives the publish bar inside the editor. |
| `wsReady`, `wsLoadError` | WaveSurfer load lifecycle. |
| `origReady`, `origDuration`, `origPlaying` | Original waveform (the source song before any edits). Used for A/B comparison. |
| `activeWaveform` | `'orig' \| 'edit'` — which one the user is interacting with. Both a state (for render) and a ref (for stale-closure-safe handlers). |
| `activeSongId`, `activeRootSongId` | Transition pointers. After a non-overwrite save, `activeSongId` flips to the new `result_song_id` so further edits chain off the saved version; `activeRootSongId` walks back to the original community song. |
| `previewing` | Web Audio preview is running (separate from WaveSurfer playback so we can apply fades/cuts in real time without re-rendering peaks). |
| `jobStatus` | `'idle' \| 'submitting' \| 'polling' \| 'done' \| 'error'`. Polled via `pollIntervalRef`. |
| `overwrite` | Admin-only checkbox. When true, save replaces the source file in place (atomic `.tmp` swap on the server). |

### Draft save lifecycle

Draft autosave debounces 1 s after the last `params` change. `PUT /v1/edit/songs/{id}/draft` writes the JSON; `draftSaveStatus` toggles `idle → saving → saved`. Closing the modal does NOT clear drafts — clearing is explicit (`DELETE /v1/edit/songs/{id}/draft`) when the user clicks "discard".

### Eligibility refresh

After every successful save, `GET /v1/properties/{song_id}/eligible` re-runs and updates the eligibility pane. The publish bar inside the editor lights up only when `eligible === true`.

## Import state — `app/components/import-jobs-table.tsx`

Polls `GET /v1/import` while any job is `pending` or `processing`. State:

| State | Purpose |
|---|---|
| `jobs` | `ImportJobResult[]` — current visible page |
| `total` | Total rows for pagination |
| `counts` | `Record<status, number>` — lifetime status counts shown as chips |
| `filter`, `page`, `loading` | UI controls |
| `activeIds` | `Set<string>` — job IDs currently in-flight in this session. Used so the poller stops once everything is done, not just everything visible. |
| `sessionFinished` | counter — increments as `activeIds` shrinks; powers the "X finished this session" banner |

There is **one** poller (`useEffect` keyed on `hasInFlight`). Earlier versions had per-row pollers; the single-poller refactor (`feat(import): single shared poller`) is the current shape — every page render reuses one `setInterval`. The poll interval is `POLL_INTERVAL_MS` and asks for `Math.max(PAGE_SIZE, activeIds.size + 10)` jobs to make sure all in-flight rows get refreshed even when paginated off-screen.

When an upload finishes (job transitions out of pending/processing), `setSessionFinished` increments and the dove-banner counter updates.

## Service worker registration lifecycle

`app/components/sw-register.tsx` runs on mount as a client component. Behavior:

- `process.env.NODE_ENV !== 'production'` (dev) — calls `getRegistrations()` and unregisters every SW. Prevents stale chunks from a previous prod build cached in the browser from breaking HMR or causing hydration mismatches.
- Production — `navigator.serviceWorker.register('/sw.js')`. Errors are logged but non-fatal.

There is **no version pinging** — to ship a new SW, bump the cache name suffix in `sw.js` (`songbird-shell-v6` → `-v7`) so the activate handler purges old caches. The `self.skipWaiting()` + `self.clients.claim()` calls make new SWs take over without a second reload.

> **In dev the SW is disabled.** To exercise SW changes (offline UX, cache shapes, RSC offline behavior), `npm run build && npm run start`.
