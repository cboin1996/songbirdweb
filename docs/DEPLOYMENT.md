# songbirdweb — deployment

## Keebox layout

The live site at <https://songbird.kee-flix.com> runs on keebox (keenan@kee-flix.com, port 223) via docker-compose.

```
~/songbird/
├── docker-compose.yml
├── .env
├── songbirdapi/            # repo clone, branch songbirdapi-enhancements
└── songbirdweb/            # repo clone, branch songbirdweb-enhancements
```

**Container ports:**
| Service | Host → Container |
|---|---|
| songbirdweb | `6996:3000` |
| songbirdapi | `9669:8000` |
| postgres | internal (docker network) |

**nginx routing (host):**
| Path | Forward to |
|---|---|
| `/v1/*` | `http://127.0.0.1:9669` (API) |
| `/*` | `http://127.0.0.1:6996` (web) |

Both are behind SSL (nginx Proxy Manager on the host).

**Storage:**
```
/mnt/jellydisk3/songbird/
├── postgres/           # postgres data
└── data/
    ├── downloads/      # MP3 / M4A files
    └── artwork/        # song artwork cache
```

## CI/CD design

**PR workflow:**
- `test.yml` runs lint + typecheck (no DB required for web; integration tests are API-only).
- Merge gates on passing checks.

**Main branch:**
- On push, `docker.yml` builds both images and pushes to Docker Hub.

**Tags (semver):**
- `v1.0.0`, `v1.1.0`, etc. → keebox deploy + GitHub release (future automation).
- Manual deploy from `*-enhancements` branches with `keebox-beta-2` tags for now.

**Semver bumps:**
- web: `package.json`, `sw.js` cache version (`v6` → `v7`), app config versioning.
- api: `version.py`, `pyproject.toml`.
- All must move together — a future PR check will enforce version-sync.

## Manual deploy to keebox

1. **Pull latest on keebox:**
   ```bash
   ssh kee-flix.com
   cd ~/songbird/songbirdapi && git pull
   cd ~/songbird/songbirdweb && git pull
   cd ~/songbird
   ```

2. **Run API migrations BEFORE building:**
   ```bash
   docker compose run --rm songbirdapi alembic upgrade head
   ```

3. **Build and restart:**
   ```bash
   docker compose build
   docker compose up -d
   ```

4. **Verify:**
   ```bash
   curl -s http://localhost:9669/v1/version    # API up
   curl -sI http://localhost:6996/              # Web up
   ```

5. **Browse:** <https://songbird.kee-flix.com>

## Rollback

```bash
cd ~/songbird/songbirdapi && git checkout keebox-beta-1
cd ~/songbird/songbirdweb && git checkout keebox-beta-1
cd ~/songbird
docker compose build && docker compose up -d
```

If the migration also needs rollback:
```bash
docker compose run --rm songbirdapi alembic downgrade <prior-rev>
docker compose up -d
```

## Known issue — NPM hot-fix

nginx Proxy Manager config on the host is manually edited and will be wiped on next NPM save. Keenan must persist via the UI:
1. Forward Scheme = `http`
2. Custom Nginx: `client_max_body_size 100m;`

See `songbirdapi/docs/DEPLOYMENT.md` for full context.
