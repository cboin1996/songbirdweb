# Known Issues

## Performance

### Song component handlers not memoized
`useCallback` is not used on click handlers in `app/components/song.tsx` (`handleLibraryToggle`, `handlePlay`, `handleOfflineToggle`, `handleShare`, `handleDownload`). No user-visible impact currently — would only matter if the actions row is extracted into a `React.memo` component. Requires refactor to be worthwhile.

## Rate Limiting

### No rate limiting on playlist creation or share token generation
`POST /v1/playlists` and `POST /v1/share/songs/{id}` have no per-user rate limits. Not a concern for a known user base but relevant if registration is opened to the public. Fix: add `slowapi` middleware.
