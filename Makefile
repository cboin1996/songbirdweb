APP_NAME=songbirdweb

.PHONY: setup
setup:
	npm ci
	git config core.hooksPath .githooks

.PHONY: env
env:
# check ENV env var has been set
ifndef ENV
	$(error Must set ENV variable!)
endif
# load env vars from .env file if present
ifneq ("$(wildcard $(ENV).env)", "")
	@echo "Loading configuration from $(ENV).env"
# include cannot be indented
include $(ENV).env
else
	@echo "Continuing without .env file."
	@echo "Creating template $(ENV).env file"
# conditionally setup env based on app choice via APP_NAME env var.
	echo 'RUN_LOCAL=false' > $(ENV).env
endif

# variables as a list, required for pytest targets
# in this makefile
ENV_VARS = $(shell cat $(ENV).env | xargs)

.PHONY: requirements
requirements:
	npm i

.PHONY: install
install:
	npm ci

.PHONY: lint
lint:
	npm run lint

.PHONY: typecheck
typecheck:
	npx tsc --noEmit

.PHONY: build
build:
	npm run build

# Raw runners: run the suite against whatever API and web are already up. CI calls
# these after it starts its own stack; locally use test-e2e* (fresh Docker stack).
# Destructive specs (editor, bulk-select, import) run on isolated users.
# E2E_ARGS passes extra Playwright flags, e.g. --shard=1/2.
.PHONY: e2e-run-dev
e2e-run-dev:
	npx playwright test --project=dev --workers=2 $(E2E_ARGS)

.PHONY: e2e-run-prod
e2e-run-prod:
	npx playwright test --project=prod --workers=2 $(E2E_ARGS)

.PHONY: e2e-run-bench
e2e-run-bench:
	npx playwright test --project=bench --workers=1 $(E2E_ARGS)

.PHONY: e2e-run-mobile
e2e-run-mobile:
	npx playwright test --project=mobile --workers=2 $(E2E_ARGS)

.PHONY: unit
unit:
	npx jest --ci

.PHONY: test
test: lint typecheck unit

# ----------------------------------------------------------------------------
# Local CI-parity e2e harness — same cboin/songbirdapi:latest Docker image
# as CI, so local and CI run identical server code.
# Usage:
#   make test-e2e              # fresh DB + stack, runs the dev suite (alias of test-e2e-local)
#   make test-e2e-prod         # fresh DB + stack, runs the prod suite
#   make test-e2e-mobile       # fresh DB + stack, runs the mobile suite
#   (the API database is recreated on every run; the Next.js build is reused when fresh)
#   make e2e-api-up            # start API stack only (postgres + API containers)
#   make e2e-api-down          # stop and remove containers
# ----------------------------------------------------------------------------

E2E_API_IMAGE=cboin/songbirdapi:latest
E2E_NETWORK=songbirdweb-e2e
E2E_PG_CONTAINER=songbirdweb-e2e-postgres
E2E_API_CONTAINER=songbirdweb-e2e-api
E2E_API_PORT=8001
E2E_WEB_PORT=3001
E2E_NEXT_PIDFILE=/tmp/songbirdweb-e2e-next.pid

.PHONY: e2e-api-up
e2e-api-up:
	@docker network create $(E2E_NETWORK) 2>/dev/null || true
	@if ! docker ps --format '{{.Names}}' | grep -q "^$(E2E_PG_CONTAINER)$$"; then \
		docker run -d --name $(E2E_PG_CONTAINER) --network $(E2E_NETWORK) \
			-e POSTGRES_DB=songbirdapi \
			-e POSTGRES_USER=songbirdapi \
			-e POSTGRES_PASSWORD=songbirdapi \
			postgres:17; \
		for i in $$(seq 1 30); do \
			docker exec $(E2E_PG_CONTAINER) pg_isready -U songbirdapi >/dev/null 2>&1 && break; \
			sleep 1; \
		done; \
	fi
	docker run --rm --network $(E2E_NETWORK) \
		--entrypoint alembic \
		-e ENV=test \
		-e POSTGRES_HOST=$(E2E_PG_CONTAINER) \
		-e POSTGRES_PORT=5432 \
		-e POSTGRES_USER=songbirdapi \
		-e POSTGRES_PASSWORD=songbirdapi \
		-e POSTGRES_DB=songbirdapi \
		-e API_KEY=ci-test-key \
		-e JWT_SECRET=ci-test-secret \
		$(E2E_API_IMAGE) upgrade head
	@if ! docker ps --format '{{.Names}}' | grep -q "^$(E2E_API_CONTAINER)$$"; then \
		mkdir -p data/downloads; \
		docker run -d --name $(E2E_API_CONTAINER) --network $(E2E_NETWORK) \
			-e ENV=test \
			-e POSTGRES_HOST=$(E2E_PG_CONTAINER) \
			-e POSTGRES_PORT=5432 \
			-e POSTGRES_USER=songbirdapi \
			-e POSTGRES_PASSWORD=songbirdapi \
			-e POSTGRES_DB=songbirdapi \
			-e API_KEY=ci-test-key \
			-e JWT_SECRET=ci-test-secret \
			-e COOKIE_SECURE=false \
			-e SESSION_MAX_PER_USER=1000 \
			-e ADMIN_USERNAME=e2e-admin \
			-e ADMIN_EMAIL=e2e-admin@ci.local \
			-e ADMIN_PASSWORD=e2e-admin-pass \
			-e CORS_ORIGINS=http://localhost:$(E2E_WEB_PORT),http://localhost:6996 \
			-v $$(pwd)/data:/songbirdapi/data \
			-p $(E2E_API_PORT):8000 \
			$(E2E_API_IMAGE); \
		for i in $$(seq 1 30); do \
			curl -sf http://localhost:$(E2E_API_PORT)/v1/version >/dev/null && echo "✓ e2e api ready" && exit 0; \
			sleep 1; \
		done; \
		docker logs $(E2E_API_CONTAINER); exit 1; \
	else \
		echo "e2e api already running"; \
	fi

.PHONY: e2e-api-down
e2e-api-down:
	@docker rm -f $(E2E_API_CONTAINER) $(E2E_PG_CONTAINER) 2>/dev/null || true
	@docker network rm $(E2E_NETWORK) 2>/dev/null || true

# Production build for e2e. Skipped when .next is newer than every input and was
# built for the same API URL (the URL is baked in at build time). A rebuild stops
# the running server first: it would otherwise keep serving chunks that are gone.
E2E_BUILD_STAMP=.next/.e2e-build-stamp
E2E_BUILD_KEY=http://localhost:$(E2E_API_PORT)
E2E_BUILD_INPUTS=app public middleware.ts next.config.ts package.json package-lock.json tsconfig.json postcss.config.mjs $(wildcard .env*)

.PHONY: e2e-build
e2e-build:
	@if [ -f .next/BUILD_ID ] && [ "$$(cat $(E2E_BUILD_STAMP) 2>/dev/null)" = "$(E2E_BUILD_KEY)" ] \
		&& [ -z "$$(find $(E2E_BUILD_INPUTS) -newer .next/BUILD_ID -print -quit)" ]; then \
		echo "e2e build is fresh, reusing it"; \
	else \
		echo "Building Next.js for e2e (production build — no hot-reload watcher)..."; \
		rm -f $(E2E_BUILD_STAMP); \
		$(MAKE) --no-print-directory e2e-next-down; \
		if ! NEXT_PUBLIC_API_BASE_URL=$(E2E_BUILD_KEY) API_BASE_URL=$(E2E_BUILD_KEY) \
			npm run build > /tmp/songbirdweb-e2e-build.log 2>&1; then \
			echo "✗ next build failed — check /tmp/songbirdweb-e2e-build.log"; exit 1; \
		fi; \
		echo "$(E2E_BUILD_KEY)" > $(E2E_BUILD_STAMP); \
	fi

.PHONY: e2e-next-up
e2e-next-up: e2e-build
	@curl -sf http://localhost:$(E2E_API_PORT)/v1/version >/dev/null || \
		(echo "✗ e2e api not reachable on :$(E2E_API_PORT). Run make e2e-api-up first." && exit 1)
	@if [ -f $(E2E_NEXT_PIDFILE) ] && kill -0 $$(cat $(E2E_NEXT_PIDFILE)) 2>/dev/null; then \
		echo "e2e next already running (pid=$$(cat $(E2E_NEXT_PIDFILE)))"; \
	else \
		nohup env \
			NEXT_PUBLIC_API_BASE_URL=http://localhost:$(E2E_API_PORT) \
			API_BASE_URL=http://localhost:$(E2E_API_PORT) \
			npx next start -p $(E2E_WEB_PORT) > /tmp/songbirdweb-e2e-next.log 2>&1 & echo $$! > $(E2E_NEXT_PIDFILE); \
		for i in $$(seq 1 60); do \
			curl -sf http://localhost:$(E2E_WEB_PORT) -o /dev/null && echo "✓ next ready" && exit 0; \
			sleep 1; \
		done; \
		echo "✗ next start failed — check /tmp/songbirdweb-e2e-next.log" && exit 1; \
	fi

.PHONY: e2e-next-down
e2e-next-down:
	@if [ -f $(E2E_NEXT_PIDFILE) ]; then \
		kill $$(cat $(E2E_NEXT_PIDFILE)) 2>/dev/null || true; \
		rm -f $(E2E_NEXT_PIDFILE); \
	fi

# Each local target recreates the API database (e2e-api-down then e2e-api-up), so
# a run never meets users or songs left by an earlier one. Credentials not set
# here come from .env.local.
E2E_LOCAL_ENV = \
	E2E_SEED_BENCH=1 \
	E2E_API_BASE_URL=http://localhost:$(E2E_API_PORT) \
	NEXT_PUBLIC_API_BASE_URL=http://localhost:$(E2E_API_PORT) \
	API_BASE_URL=http://localhost:$(E2E_API_PORT) \
	TEST_USERNAME=e2e-testuser \
	TEST_PASSWORD=e2e-TestPass-9917 \
	E2E_ADMIN_USERNAME=e2e-admin \
	E2E_ADMIN_PASSWORD=e2e-admin-pass \
	E2E_EDITOR_USERNAME=e2e-editor \
	E2E_EDITOR_PASSWORD=e2e-EditorPass-1 \
	E2E_BULK_USERNAME=e2e-bulk \
	E2E_BULK_PASSWORD=e2e-BulkPass-1 \
	E2E_IMPORT_USERNAME=e2e-import \
	E2E_IMPORT_PASSWORD=e2e-ImportPass-1 \
	E2E_QUEUE_USERNAME=e2e-queue \
	E2E_QUEUE_PASSWORD=e2e-QueuePass-1

.PHONY: test-e2e-local
test-e2e-local: e2e-api-down e2e-api-up e2e-next-up
	$(E2E_LOCAL_ENV) E2E_WEB_URL=http://localhost:$(E2E_WEB_PORT) \
	npx playwright test --project=dev --workers=2 $(E2E_ARGS)

.PHONY: test-e2e-local-mobile
test-e2e-local-mobile: e2e-api-down e2e-api-up e2e-next-up
	$(E2E_LOCAL_ENV) E2E_WEB_URL=http://localhost:$(E2E_WEB_PORT) \
	npx playwright test --project=mobile --workers=2 $(E2E_ARGS)

# The benchmark project: counts on the 1000-song bench library, one worker.
.PHONY: test-e2e-local-bench
test-e2e-local-bench: e2e-api-down e2e-api-up e2e-next-up
	$(E2E_LOCAL_ENV) E2E_WEB_URL=http://localhost:$(E2E_WEB_PORT) \
	npx playwright test --project=bench --workers=1 $(E2E_ARGS)

.PHONY: test-e2e-bench
test-e2e-bench: test-e2e-local-bench

# The prod project serves its own build on :6996; reuse the fresh e2e build.
.PHONY: test-e2e-local-prod
test-e2e-local-prod: e2e-api-down e2e-api-up e2e-build
	$(E2E_LOCAL_ENV) PLAYWRIGHT_SKIP_BUILD=1 \
	npx playwright test --project=prod --workers=2 $(E2E_ARGS)

# Default names run the fresh-stack harness.
.PHONY: test-e2e
test-e2e: test-e2e-local

.PHONY: test-e2e-prod
test-e2e-prod: test-e2e-local-prod

.PHONY: test-e2e-mobile
test-e2e-mobile: test-e2e-local-mobile

.PHONY: e2e-down
e2e-down: e2e-next-down e2e-api-down

E2E_API_LOCAL_SRC=$(HOME)/proj/cboin1996/songbirdapi

.PHONY: e2e-api-build
e2e-api-build:
	docker build -t cboin/songbirdapi:e2e-local $(E2E_API_LOCAL_SRC)

.PHONY: test-e2e-local-dev
test-e2e-local-dev: e2e-api-build
	$(MAKE) test-e2e-local E2E_API_IMAGE=cboin/songbirdapi:e2e-local

local-run-songbirdweb:
	npm run dev

.PHONY: docker-build
docker-build:
	docker build -t $(APP_NAME):latest .

DOCKER_NETWORK_NAME=songbirdapi
.PHONY: docker-run-songbirdweb
docker-run-songbirdweb:
	docker run --network $(DOCKER_NETWORK_NAME) -p 3000:3000 $(APP_NAME):latest

.PHONY: docker-clean-songbirdweb
docker-clean-songbirdweb:
	docker rm $(APP_NAME) || true

.PHONY: docker-stop-songbirdweb
docker-stop-songbirdweb:
	docker kill $(APP_NAME) || true
	docker rm $(APP_NAME) || true


# Creates the e2e users and the 1000-song bench library: Playwright's global setup
# does it, so run one cheap test to trigger it.
.PHONY: e2e-seed
e2e-seed:
	$(E2E_LOCAL_ENV) E2E_WEB_URL=http://localhost:$(E2E_WEB_PORT) \
	npx playwright test --project=bench --workers=1 -g "cold library load"

# Lighthouse CI on the library page against a running stack (make e2e-api-up e2e-next-up).
# Scores land in lhci-results/; nothing here fails on a millisecond figure.
# lighthouse-run is the lhci call alone, for CI where the bench leg has already seeded the
# bench user; `lighthouse` seeds first, for a local stack.
.PHONY: lighthouse-run
lighthouse-run:
	$(E2E_LOCAL_ENV) E2E_WEB_URL=http://localhost:$(E2E_WEB_PORT) \
	npx lhci autorun --config=lighthouserc.js

.PHONY: lighthouse
lighthouse: e2e-seed lighthouse-run

.PHONY: test-lighthouse
test-lighthouse: e2e-api-down e2e-api-up e2e-next-up lighthouse
