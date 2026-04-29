# Known Issues

## Offline / Service Worker

The SW is **disabled in development** (`sw-register.tsx` checks `NODE_ENV`). It only registers in production builds where chunk filenames are content-hashed and stable. To test offline behavior locally, run a production build (`npm run build && npm start`).

## Performance

### Song component handlers not memoized
`useCallback` is not used on click handlers in `app/components/song.tsx` (`handleLibraryToggle`, `handlePlay`, `handleOfflineToggle`, `handleShare`, `handleDownload`). No user-visible impact currently — would only matter if the actions row is extracted into a `React.memo` component. Requires refactor to be worthwhile.

## Rate Limiting

### No rate limiting on playlist creation or share token generation
`POST /v1/playlists` and `POST /v1/share/songs/{id}` have no per-user rate limits. Not a concern for a known user base but relevant if registration is opened to the public. Fix: add `slowapi` middleware.

## Account self-service

### No way to update email after registration
A user who typos their email at signup has no recourse. Settings page has no email field; backend has no `PUT /v1/users/me/email` endpoint. Admin can only fix it via direct DB write. No functional impact today (email isn't used for anything), but blocks password-reset-via-email if/when added. Fix: add an email-update endpoint + a settings field (with re-verify-password gate).

### No password reset flow
If a user forgets their password, only an admin can reset it (and there's no admin UI for it either — would need a direct DB write or admin endpoint that doesn't yet exist). Fix: email-based reset link, contingent on the email-update gap above being closed.
