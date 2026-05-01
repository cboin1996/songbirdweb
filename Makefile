APP_NAME=songbirdweb
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

.PHONY: test-e2e
# Destructive specs (editor, bulk-select, import) run on isolated users (phase 3).
# Workers=2 is safe: destructive specs can't corrupt the shared test-user library.
test-e2e:
	npx playwright test --project=dev --workers=2

.PHONY: test-e2e-prod
test-e2e-prod:
	npx playwright test --project=prod --workers=2

.PHONY: test-e2e-mobile
test-e2e-mobile:
	npx playwright test --project=mobile --workers=2

.PHONY: test
test: lint typecheck

# ----------------------------------------------------------------------------
# Local CI-parity e2e harness — same cboin/songbirdapi:latest Docker image
# as CI, so local and CI run identical server code.
# Usage:
#   make test-e2e-local        # spins up everything, runs dev suite, tears down
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

.PHONY: e2e-next-up
e2e-next-up:
	@curl -sf http://localhost:$(E2E_API_PORT)/v1/version >/dev/null || \
		(echo "✗ e2e api not reachable on :$(E2E_API_PORT). Run make e2e-api-up first." && exit 1)
	@if [ -f $(E2E_NEXT_PIDFILE) ] && kill -0 $$(cat $(E2E_NEXT_PIDFILE)) 2>/dev/null; then \
		echo "e2e next already running (pid=$$(cat $(E2E_NEXT_PIDFILE)))"; \
	else \
		echo "Building Next.js for e2e (production build — no hot-reload watcher)..."; \
		NEXT_PUBLIC_API_BASE_URL=http://localhost:$(E2E_API_PORT) \
		API_BASE_URL=http://localhost:$(E2E_API_PORT) \
		npm run build > /tmp/songbirdweb-e2e-build.log 2>&1 || \
			(echo "✗ next build failed — check /tmp/songbirdweb-e2e-build.log" && exit 1); \
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

.PHONY: test-e2e-local
test-e2e-local: e2e-api-up e2e-next-up
	E2E_WEB_URL=http://localhost:$(E2E_WEB_PORT) \
	E2E_API_BASE_URL=http://localhost:$(E2E_API_PORT) \
	NEXT_PUBLIC_API_BASE_URL=http://localhost:$(E2E_API_PORT) \
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
	npx playwright test --project=dev --workers=2

.PHONY: test-e2e-local-mobile
test-e2e-local-mobile: e2e-api-up e2e-next-up
	E2E_WEB_URL=http://localhost:$(E2E_WEB_PORT) \
	E2E_API_BASE_URL=http://localhost:$(E2E_API_PORT) \
	NEXT_PUBLIC_API_BASE_URL=http://localhost:$(E2E_API_PORT) \
	TEST_USERNAME=e2e-testuser \
	TEST_PASSWORD=e2e-TestPass-9917 \
	E2E_ADMIN_USERNAME=e2e-admin \
	E2E_ADMIN_PASSWORD=e2e-admin-pass \
	npx playwright test --project=mobile --workers=2

.PHONY: e2e-down
e2e-down: e2e-next-down e2e-api-down

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

