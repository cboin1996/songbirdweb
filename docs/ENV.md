# songbirdweb — environment variables

`.env.development`, `.env.production`, and `.env.local` are read by Next.js per the standard precedence (`.env.local` wins). `NEXT_PUBLIC_*` values are inlined into the client bundle at **build time**; everything else is read at runtime on the server.

Source-of-truth references in code:

- `next.config.ts` — exports `NEXT_PUBLIC_APP_VERSION`, sets up rewrites, image domains, and the 100 MB middleware body limit.
- `middleware.ts` — uses `process.env.NEXT_PUBLIC_API_HOST` for `auth/refresh` calls during SSR.
- `app/lib/data.ts` — uses `API_BASE_URL` server-side and `NEXT_PUBLIC_API_BASE_URL` client-side to build `BASE_URL`.
- `app/v1/[...path]/route.ts` — uses `API_BASE_URL` for the dev proxy.

## Variables

| Variable | Build-time? | Runtime? | Default | Where used | Purpose |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | yes (inlined into client bundle) | yes (read by client code) | `''` (same-origin via `/v1` proxy) | `app/lib/data.ts` | Client-side API base URL. Empty string makes the browser hit same-origin `/v1/...` and rely on the proxy / nginx. Set to e.g. `https://api.example.com` to bypass the proxy. |
| `API_BASE_URL` | no | yes (server only) | `http://localhost:8000` | `app/lib/data.ts`, `app/v1/[...path]/route.ts`, `next.config.ts` rewrites | Server-side API base URL — used by RSC fetches, the `/v1` proxy, and the artwork rewrite. In Docker (keebox), set to `http://songbirdapi:8000` so the web container talks to the API container over the Docker network. |
| `NEXT_PUBLIC_API_HOST` | yes | yes | `localhost` | `middleware.ts` | Constructs `http://${NEXT_PUBLIC_API_HOST}:8000` for the SSR `/v1/auth/refresh` call from middleware. Note: this is the **only** place the host shape is hardcoded; if you ever change the API port, change this and `API_BASE_URL` together. |
| `NEXT_PUBLIC_APP_VERSION` | yes | yes | `process.env.npm_package_version` (set by `next build`) | UI footer / about page | Auto-injected from `package.json` via `next.config.ts → env`. Don't set this manually. |
| `TEST_USERNAME` | no | no (test only) | — | `e2e/*.spec.ts` (Playwright) | Login username for e2e tests. Stored in `.env.local`, not committed. |
| `TEST_PASSWORD` | no | no (test only) | — | Playwright | Password for the e2e user. |

> **Build-time vs runtime:** `NEXT_PUBLIC_*` is baked into the JS bundle when you run `next build`. Changing it requires a rebuild. The non-public ones (`API_BASE_URL`) are read fresh on every request, so a container restart with new env is enough.

## Setting per environment

### Local dev (typical)

`.env.local`:

```
NEXT_PUBLIC_API_BASE_URL=
API_BASE_URL=http://localhost:8000
TEST_USERNAME=cboin
TEST_PASSWORD=...
```

Empty `NEXT_PUBLIC_API_BASE_URL` makes the client use same-origin and the proxy forwards to `localhost:8000`. SSR fetches go directly via `API_BASE_URL`.

### Local dev against a remote API

If you're hacking on the web app against a deployed API:

```
NEXT_PUBLIC_API_BASE_URL=https://songbird.kee-flix.com
API_BASE_URL=https://songbird.kee-flix.com
NEXT_PUBLIC_API_HOST=songbird.kee-flix.com
```

CORS on the API must include your dev origin (`http://localhost:3000`).

### Production (keebox)

The API and web run in the same Docker network. The web container's environment in `~/songbird/docker-compose.yml`:

```yaml
environment:
  API_BASE_URL: http://songbirdapi:8000
```

`NEXT_PUBLIC_API_BASE_URL` is intentionally empty so the client hits same-origin `/v1/...`. Nginx terminates SSL and routes `/v1/*` to `127.0.0.1:9669` (the API container) and `/*` to `127.0.0.1:6996` (the web container).

`NEXT_PUBLIC_API_HOST` is not set in prod because middleware's `auth/refresh` call uses `localhost:8000` as a default — **and it shouldn't, because the API container's hostname is `songbirdapi`.** This is a known minor wart; the middleware refresh path runs entirely on the server-side Next runtime so `localhost:8000` won't reach the API in Docker. If middleware refresh ever starts failing in prod, set `NEXT_PUBLIC_API_HOST=songbirdapi` in the web container env. (For keebox today this hasn't surfaced because the access token TTL of 15 min means most users never trip the SSR refresh path before another client-side fetch refreshes for them.)

## Adding a new env var

1. Decide build-time vs runtime. Build-time = `NEXT_PUBLIC_*`. Anything secret stays runtime.
2. Add it to `.env.development`, `.env.production`, and `.env.local` (with a placeholder), so contributors know it exists.
3. Document it in the table above with default + purpose.
4. If it's needed in prod, update `~/songbird/docker-compose.yml` on keebox and the `.env` template in `~/proj/cboin1996/songbird-keebox/`.
5. Reference it via `process.env.X` — TypeScript doesn't know about runtime envs unless you augment `next-env.d.ts`, but most existing code just uses `process.env.X ?? '<default>'`.

## Things that are NOT env vars (commonly mistaken)

- **`NEXT_TELEMETRY_DISABLED`** — Next.js telemetry. Not currently set; can be added to the Dockerfile if you want to disable telemetry in builds.
- **`PORT`** — set in the Dockerfile, not `.env`. Defaults to `3000`. The web container exposes 3000 internally; keebox publishes it as `6996`.
- **`HOSTNAME`** — Dockerfile pins `0.0.0.0` so the standalone server binds all interfaces.
