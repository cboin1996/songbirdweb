# Known Issues

## Offline / Service Worker

The SW is **disabled in development** (`sw-register.tsx` checks `NODE_ENV`). It only registers in production builds where chunk filenames are content-hashed and stable. To test offline behavior locally, run a production build (`npm run build && npm start`).

## Playback and offline

### The launch scan trusts any file it finds
`cacheSong` now rejects a short download and removes a partial write, but the scan that builds the saved-songs list checks only that a file exists. A truncated file from before that change still counts as saved: it plays cut short, and offline advance does not step over it. Fix: size check in the scan (needs the expected size stored with the index). Deferred to the offline-storage flow.

### A saved name can stand for a missing or empty file
The launch scan lists names without opening files, so a song whose file is missing or empty is offered as saved until it is opened. A tap, skip back or first play checks the file first and refuses with "not saved offline", and the song is then dropped from the list. The first walk after an offline launch cannot check before it moves: that song becomes current, stopped, and the walk steps on from there. Library sync (`/v1/library/offline/sync`) is built from the same unverified list, so an empty file can be offered to another device as saved; that device's download works.

### The first walk after an offline launch may need a second tap on iOS
`audio.play()` has to run inside the user's gesture. The one-press play after an offline launch walks past songs whose files turn out to be empty, and that walk happens after the gesture window. Not verified on a device.

### A hung request at launch delays the restore
The player-state and library requests at launch have no time limit of their own, so a connection that accepts and never answers holds the restore until the browser gives up. A time limit on the launch fetches would fix it. Predates the offline-launch work.

### The verified IndexedDB scan reads every blob
Where OPFS is unavailable, the saved-songs scan that verifies copies (`getCachedSongIds()` with its default, used by the settings page and after a save) reads every stored blob. Cost is unmeasured and Chromium's blobs are lazy. The launch scan does not do this.

### A session the API rejects but the middleware accepts
The middleware passes any unexpired access token through, and bounces `/` to `/download` when it sees one. If the API rejects a token that has not expired (secret rotated, user deleted, refresh token revoked early), the player's "session expired" redirect to `/?next=…` is bounced straight back to the app. The ordinary case — the 15-minute token has expired — shows the login form as intended. Fix: have the redirect clear the cookies, or have middleware verify against the API.

### Proactive refresh runs once per page load
A page cannot know how old its token is (the middleware passes any unexpired token, and the service worker can serve a page with a dead one), so the first `ensureFreshToken()` after a load always refreshes; later ones wait ten minutes, and a failure waits thirty seconds. A user who reloads often makes one extra `POST /v1/auth/refresh` per load. Accepted.

### "Play now" has no offline filter
`playNow()` does not check for a local copy offline. Every current caller is on a route that is online-only, or that lists only saved songs while offline, so an unsaved song cannot reach it. A new caller that lists unsaved songs offline would meet the error cascade rather than a skip.

### Pre-existing e2e failures
Failing independently of the playback changes, left alone: `offline.spec.ts` "go to library"; `player-expanded.spec.ts` "artwork button opens expanded overlay"; `download.spec.ts` "song search: clicking card starts player"; `error-states.spec.ts` "bulk download shows toast on failure and keeps failed selected" (the player and the page share one toast slot, so a player toast replaces the page's). `settings.spec.ts` audio-format tests are flaky when run in parallel.

## Performance

### Song component handlers not memoized
`useCallback` is not used on click handlers in `app/components/song.tsx` (`handleLibraryToggle`, `handlePlay`, `handleOfflineToggle`, `handleShare`, `handleDownload`). No user-visible impact currently — would only matter if the actions row is extracted into a `React.memo` component. Requires refactor to be worthwhile.

### Publish-eligible modal sluggish with hundreds of songs
`SongPickerModal` already uses `useVirtualList`, so rendering itself is bounded. The slowness comes from re-running the eligibility sort + `setOrder` on every prop update (`useEffect` dep includes `disabledItems`). With a few hundred items, the sort runs frequently. Fix: memoize the sorted order, or only re-sort when `songs.length` changes.

## Rate Limiting

### No rate limiting on playlist creation or share token generation
`POST /v1/playlists` and `POST /v1/share/songs/{id}` have no per-user rate limits. Not a concern for a known user base but relevant if registration is opened to the public. Fix: add `slowapi` middleware.

## Account self-service

### No way to update email after registration
A user who typos their email at signup has no recourse. Settings page has no email field; backend has no `PUT /v1/users/me/email` endpoint. Admin can only fix it via direct DB write. No functional impact today (email isn't used for anything), but blocks password-reset-via-email if/when added. Fix: add an email-update endpoint + a settings field (with re-verify-password gate).

### No password reset flow
If a user forgets their password, only an admin can reset it (and there's no admin UI for it either — would need a direct DB write or admin endpoint that doesn't yet exist). Fix: email-based reset link, contingent on the email-update gap above being closed.
