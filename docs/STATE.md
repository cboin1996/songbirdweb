# songbirdweb — React state model

The web app keeps three layers of state:

1. **Server state** — fetched on demand from `songbirdapi`. Server components read it via `app/lib/data.ts` (forwarding cookies). Client components fetch with `credentials: 'include'`.
2. **React contexts** — `PlayerProvider`, `UserProvider`. Mounted once at the top of the tree.
3. **Component-local `useState`** — most pages keep their own UI state.

This doc maps the contexts and the most state-heavy components. For the page/route map, see `ARCHITECTURE.md`.

## `PlayerProvider` — `app/components/player.tsx`

Mounted once in `app/layout.tsx` so a single `<audio>` element survives every navigation. Owns queue, current song, shuffle/repeat, queue sources, and persists all of it to the server (`/v1/player/state`). Server is the source of truth; localStorage holds a mirror that's used as a fallback if the server fetch fails on restore.

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
| `blobSlotRef` | Owns the OPFS blob URL on the element (`app/lib/blob-slot.ts`). A URL is revoked when the element lets go of it — when a newer source is applied — never when a competing load merely creates its own, so a superseded load cannot revoke the URL the element is playing. |
| `srcUuidRef` | The song whose source was last assigned to the element. Can differ from `current` while a load is in flight; the "is this song already loaded" check reads it, plus `audio.error`, so a failed source reloads instead of being skipped. |
| `pendingPosition` | Resume position to seek to once `loadedmetadata` fires. |
| `shouldPlayRef` | Set to true between `audio.load()` and the metadata event so we know to call `play()` then. |
| `autoplayActivatedRef` | First play must call `audio.play()` synchronously inside the user-gesture window. After that, awaits before touching the audio element are safe. It is also the switch for the token refresh: the first play fires `ensureFreshToken()` without awaiting it (an await would cost the gesture), every later load awaits it before assigning the source. |
| `hasUserPlayedRef` | Set by `play()` and `playNow()` (not by the play/pause button). Guards the launch only: a restore that arrives after the user has picked a song (the server's answer, or this device's own copy) is dropped, so it cannot override what the user chose. The resync on return to the tab does not read it. |
| `saveTimerRef` | The pending debounced server-state save (2 s). Nulled when it fires, so non-null means "a local change is not on the server yet": `reconcilePlayerState` does nothing while it is set, so a resync cannot overwrite a newer local edit with older server state. Once it has fired, `playerWritesPending()` says the same for a save that is on its way or waiting its turn. |
| `sessionKeepAliveRef` | True while the audio element is looping `silence.mp3` to keep the iOS audio session warm during a logical pause. Listeners early-return when set so silent-loop events don't clobber UI state. |
| `savedSrcBeforeSilenceRef` | The real song's `audio.src` captured at pause time, so resume can restore it. |
| `pinnedPosRef`, `pinnedDurRef` | Real position + duration captured at pause; re-asserted to `mediaSession.setPositionState` on every silent-loop tick so iOS lock-screen shows the static paused position instead of the silent file's `audio.currentTime`. |
| `failureCountRef` | Consecutive failed loads. Reaches `MAX_CONSECUTIVE_FAILURES` (5) and the cascade stops. Cleared by `clearFailureState()` — a user action, or `PROGRESS_RESET_SEC` (10 s) of real playback past where the load started. |
| `failureSnapshotRef` | Queue index, shuffle position/order/seed and manual-next list from where the cascade started, restored when it stops so the player lands back on the song it started from, not wherever the walk ended. |
| `stoppedRef` | The terminal state (`enterStoppedState`): paused, toasted, saved. Only the user leaves it. The error handler returns immediately while it is set. |
| `srcGenRef` | The load generation that assigned the source on the element. An error whose `srcGenRef` differs from `loadGenRef` belongs to an outgoing load and is ignored. |
| `retriedGenRef` | The load generation that has already used its one silent retry. A load error calls `tryRefresh()` once, then reloads from where it failed; a second error on the same generation falls through to the cascade. A `rejected` refresh stops the player and sends the user to sign in. |
| `pendingSwapGenRef` | The load whose synchronous stream-URL guess (first play) has not yet been confirmed or replaced by the resolved source. Errors from the guess are held; offline it fails before the local copy resolves, and `loadSong` resurfaces it only if the swap finds nothing to replace it with. |
| `loadStartPositionRef`, `lastPositionRef` | Where the current load began, and the last position seen. A retry resumes from `lastPositionRef`; real progress is measured against `loadStartPositionRef`. |
| `lastRefreshOutcomeRef` | The result (`ok` / `rejected` / `unavailable`) of the refresh the last retry made. Written to the console when a cascade stops, because a 401 and a dead zone are otherwise indistinguishable after the fact. |
| `cachedIdsRef`, `cachedIdsStatusRef` | Mirrors of `cachedIds` / `cachedIdsStatus` from `useOfflineSave()`. The advance path is a stable callback captured once into the media-session and keyboard handlers, so it must read these through refs; a direct read would pin the initial empty set for the session. |

### Persistence schedule

- **Queue + shuffle + repeat + queue_sources:** `scheduleSave()` debounces a `PUT /v1/player/state` (2 s) after every queue mutation, and after a stop, so a reload opens on the song the stop restored rather than the one the cascade died on. On page load, `GET /v1/player/state` restores the entire state from the server (queue sources are now server-of-truth, not localStorage).
- **Position (`last_position` on `user_songs`):** `PATCH /v1/library/{id}/position` every 10 s while playing and on pause.
- **Play event:** `POST /v1/songs/{id}/play` after 30 s of continuous play.

### Keyboard shortcuts

`Space` play/pause, `←/→` skip prev/next. Wired in a `useEffect` that listens on `window`.

### Media Session API + iOS lock-screen

`navigator.mediaSession.setActionHandler` is bound for `play`, `pause`, `previoustrack`, and `nexttrack` so OS-level controls (Android notification, iOS lock-screen / Control Center) work.

iOS Safari releases the audio session ~10s after a normal `audio.pause()` in the background, after which the lock-screen play button becomes unresponsive until the user reopens Safari. To keep the session warm, **`pause()` swaps `audio.src` to a 4 KB looping `silence.mp3`** instead of actually pausing the element. `resume()` swaps the song's src back and seeks to `pendingPosition`.

Because the silent file's `audio.currentTime`/`audio.duration` are ~0/1s, iOS would show those on the lock-screen scrubber. To override:

- `mediaSession.playbackState = 'paused'` — tells the OS to render a play button + treat position as static.
- `mediaSession.setPositionState({ position: realPos, duration: realDur, playbackRate: 1 })` — must use `playbackRate=1` (the spec rejects 0; `try/catch` would silently swallow the `TypeError` if you pass 0).
- The position state is **re-asserted on every silent-loop `timeupdate`** because iOS otherwise polls `audio.currentTime` for the playhead and the lock-screen position drifts back to 0:00.

After ~20s in the background iOS sometimes suspends the page, killing the silent loop. A `visibilitychange` listener detects this on re-foreground (silent-loop active + `audio.paused === true`) and resets the UI to "ready to play" — restores the real `audio.src`, drops the keep-alive flag, clears `isBuffering`/`isPlaying` — so the user sees a tappable play button instead of a stuck spinner. The same handler re-binds `previoustrack`/`nexttrack` because iOS forgets them across suspension and falls back to ±10s seek markers.

### Coming back to the tab

The same `visibilitychange` handler, on return with a connection, does two more things:

1. Calls `ensureFreshToken()` without awaiting it. This is what keeps the 15-minute token valid across a long pause: a resume sets no `src` and fetches the rest of the song as range requests, so the check at source assignment never runs. The attempt is gated (10 min since the last refresh, 30 s cooldown after a failure), so a tab that is toggled repeatedly costs nothing.
2. Fetches the server's player state with `{ current: true }` (`fetchData` refuses a service-worker cached fallback, marked `X-SW-Stale`, so a stale answer is never mistaken for the server's) and calls `reconcilePlayerState`. That declines when audio is playing, when a save is waiting for its debounce (`saveTimerRef`), or when a write is on its way or waiting its turn (`playerWritesPending()`). Otherwise it compares the server against the player's live refs: identical, nothing happens; same song and queue but different shuffle, repeat or manual-next, those are applied, unless this device's copy of them (`saved_at` in the local mirror) is newer than the server's `updated_at`, in which case they are kept and sent again (the server never heard them); different song or queue, the newer of the local mirror and the server wins (a newer local state raises the sync prompt, an older one is replaced by the server's with a "synced from another device" toast).

### Launch restore

The launch effect fetches the player state (`fetchPlayerStateAtLaunch()`, which also says whether the service worker answered from its stored copy) and the library together. A fresh answer goes through `reconcilePlayerState`. No answer (the request failed) or a stale one: this device's own copy wins, because it is newer than anything the stored one knew, and the stored one stands in only when there is nothing local. The local copy (`readLocalPlayerState()`, the `playerState` mirror in localStorage) counts only if it holds a `queue` list; anything else is treated as absent. Whatever the user picked while the requests were out (`hasUserPlayedRef`) is never replaced. `logout()` removes the mirror, the library lists in IndexedDB and the service worker's `songbird-api-*` caches, so the next account on a shared device starts clean; the songs saved to the device stay until the user removes them.

### Writing to the server — `app/lib/queue-writes.ts`

The server's copy is written two ways: one request per queue change (insert, remove, reorder) and a save of the whole state two seconds after the last change. Both go through one write chain (`createWriteChain`; the instance is `playerWrites` in `data.ts`), one request at a time, in the order the user made them, so a slow request is never overtaken by a quick one. Each has a 15-second limit (`__playerWriteLimitMs` in tests): a request that never answers is aborted and the next goes ahead. The whole-state save is built when its turn comes, so it is never an old snapshot. While one waits, a newer replaces it and queue changes waiting beside it are dropped, because it already holds them. A queue change that fails is followed by a whole-state save, which repairs what the server missed. A whole-state save that fails has nothing after it, so it is sent again by `resendIfFailed()` when the server answers again (`subscribeOffline` in `data.ts`). Failed and replaced writes are logged to the console (`warn`, `debug`). The API accepts up to 10,000 songs in a saved queue (`MAX_QUEUE_SONGS` in `songbirdapi`; it was 2,000 before the API release paired with this change).

### The offline signal — `app/lib/offline-signal.ts`

`isOffline()` is true when the browser says so (`navigator.onLine` false) or when the last request to the API found the server unreachable: no answer, or a 502 from the proxy (`markServerUnreachable()` in `data.ts`). A phone between towers reports a connection and fails every request, so the browser's word alone is not enough. It ends when the server answers with something of its own (`serverReachable` is raised for any answer except a 502 or a copy the service worker served from its cache), or the browser reports a connection coming back. While it believes the server is gone, `data.ts` asks `/v1/health` every 15 seconds (`__probeIntervalMs` in tests), so a page left alone finds out too; the probe stays quiet while the browser itself is offline. A request the caller gave up on (the write limit) is not an unreachable server. Two sites still read `navigator.onLine` directly, on purpose, each with a comment: the return to the tab, and `redirectToLogin()`.

### Offline advance

Offline, `advanceTrack()` filters against `cachedIdsRef` instead of attempting each song and failing: `offlineOnlyIds()` returns the saved set (`savedNow()`, the context's live set) only when offline and the launch scan has finished (`cachedIdsStatus === 'scanned'`), else `null` and the old behaviour. The walk steps over unsaved songs (shuffle, manual-next and lap boundaries all use `stepAdvance()`), is bounded, restores the snapshot if it ends without a song, and says "the rest of the queue is not saved offline" only if it stepped over something; a queue that simply ends offline ends quietly, as it does online.

### Offline taps and the launch scan

The launch scan lists the saved songs by file name, without opening any file (`getCachedSongIds(false)`; it throws when the folder cannot be listed rather than returning a partial list). A name can stand for a missing or empty file, so a song is only proved playable when it is opened. A tap, a skip back or a first play checks before anything changes (`startIfPlayable`): the song must be on the saved list (synchronous) and, once the first play has happened, its file must open (asynchronous; the very first play skips this check to keep `audio.play()` inside the user's gesture). If either fails, nothing changes and the player says "not saved offline". A song found to have no file is dropped from the list (`dropSaved`), so the queue marks it and the count follows without a reload. When the walk after an offline launch finds such a song it steps on to the next one; on iOS that first walk happens after the gesture window and may need a second tap (not verified on a device). Offline, the queue panel and the expanded player's queue dim and mark the songs that will not play (a cloud-off icon) and show "Offline — N of M available", counted over the whole queue.

## Token refresh — `app/lib/data.ts`

`tryRefresh()` is the reactive path (something just got a 401; single-flight; 8 s timeout). `ensureFreshToken()` is the proactive path (stale-gated, with a cooldown after failure). Both return `'ok' | 'rejected' | 'unavailable'`: `rejected` is a 401/403 from the refresh endpoint (the session is over: sign in again), `unavailable` is anything else (a dead connection: do not sign anyone out). `logout()` marks the page as signing out, after which `redirectToLogin()` declines and the player's error handler stands down: logout clears the cookies before it navigates, and a stream that fails on that must not race it to the login page. Test timing knobs live in `app/lib/test-overrides.ts`.

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
| `cachedIds` | `Set<string>` | read from `useOfflineSave()`, which owns it: scanned once at app launch (so it is right on a page that never opened the library), updated after each per-song download, on `EVENTS.offlineCleared`, after `Save all offline` |
| `offlineReady` | `boolean` | true after first successful OPFS scan on this page |
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

There is **no version pinging** — `public/sw.js` is generated from `public/sw.template.js` at build, with the app version in the shell cache name, so every release is a new worker and the activate handler purges the old shell cache. The `self.skipWaiting()` + `self.clients.claim()` calls make new SWs take over without a second reload.

> **In dev the SW is disabled.** To exercise SW changes (offline UX, cache shapes), `npm run build && npm run start`.
