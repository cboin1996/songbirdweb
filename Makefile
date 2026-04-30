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
# workers=1 for dev — the full e2e/ suite shares player + queue + library
# state across the test user; workers=2 races on player state and flakes
# editor/queue/player tests. Mobile + prod live in their own (smaller) dirs
# without that shared-state surface, so they're fine at 2.
test-e2e:
	npx playwright test --project=dev --workers=1

.PHONY: test-e2e-prod
test-e2e-prod:
	npx playwright test --project=prod --workers=2

.PHONY: test-e2e-mobile
test-e2e-mobile:
	npx playwright test --project=mobile --workers=2

.PHONY: test
test: lint typecheck

# ----------------------------------------------------------------------------
# Local CI-parity e2e harness — talks to the songbirdapi e2e stack
# (api on :8001 + postgres on :5433) instead of the dev stack on :3000/:8000.
# Brings up `npm run dev:e2e` (next on :3001 pointing at api :8001), runs
# the test suite, then tears the next dev process down.
#
# Prereq: in songbirdapi repo, `make e2e-up` must have been run.
# Use `make e2e-reset` (in songbirdapi) between runs to wipe DB state.
# ----------------------------------------------------------------------------

E2E_WEB_PORT=3001
E2E_API_PORT=8001
E2E_NEXT_PIDFILE=/tmp/songbirdweb-e2e-next.pid

.PHONY: e2e-check-api
e2e-check-api:
	@curl -sf http://localhost:$(E2E_API_PORT)/v1/health >/dev/null || \
		(echo "✗ e2e api not reachable on :$(E2E_API_PORT). Run \`make e2e-up\` in songbirdapi first." && exit 1)
	@echo "✓ e2e api is up"

.PHONY: e2e-next-up
e2e-next-up: e2e-check-api
	@if [ -f $(E2E_NEXT_PIDFILE) ] && kill -0 $$(cat $(E2E_NEXT_PIDFILE)) 2>/dev/null; then \
		echo "e2e next already running (pid $$(cat $(E2E_NEXT_PIDFILE)))"; \
	else \
		echo "starting next dev:e2e on :$(E2E_WEB_PORT)..."; \
		nohup env NEXT_PUBLIC_API_BASE_URL=http://localhost:$(E2E_API_PORT) API_BASE_URL=http://localhost:$(E2E_API_PORT) npm run dev:e2e > /tmp/songbirdweb-e2e-next.log 2>&1 & echo $$! > $(E2E_NEXT_PIDFILE); \
		for i in $$(seq 1 60); do \
			curl -sf http://localhost:$(E2E_WEB_PORT) -o /dev/null && echo "next ready" && exit 0; \
			sleep 1; \
		done; \
		echo "next dev:e2e failed to start — check /tmp/songbirdweb-e2e-next.log" && exit 1; \
	fi

.PHONY: e2e-next-down
e2e-next-down:
	@if [ -f $(E2E_NEXT_PIDFILE) ]; then \
		kill $$(cat $(E2E_NEXT_PIDFILE)) 2>/dev/null || true; \
		pkill -f "next-server.*$(E2E_WEB_PORT)" 2>/dev/null || true; \
		rm -f $(E2E_NEXT_PIDFILE); \
		echo "stopped e2e next"; \
	fi

# Run the full dev e2e suite against the e2e stack. Mirrors what CI does
# but on alt ports so dev work isn't disturbed.
.PHONY: test-e2e-local
test-e2e-local: e2e-next-up
	E2E_WEB_URL=http://localhost:$(E2E_WEB_PORT) \
	E2E_API_BASE_URL=http://localhost:$(E2E_API_PORT) \
	NEXT_PUBLIC_API_BASE_URL=http://localhost:$(E2E_API_PORT) \
	TEST_USERNAME=e2e-testuser \
	TEST_PASSWORD=e2e-TestPass-9917 \
	E2E_ADMIN_USERNAME=e2e-admin \
	E2E_ADMIN_PASSWORD=e2e-admin-pass \
	npx playwright test --project=dev --workers=1

.PHONY: test-e2e-local-mobile
test-e2e-local-mobile: e2e-next-up
	E2E_WEB_URL=http://localhost:$(E2E_WEB_PORT) \
	E2E_API_BASE_URL=http://localhost:$(E2E_API_PORT) \
	NEXT_PUBLIC_API_BASE_URL=http://localhost:$(E2E_API_PORT) \
	TEST_USERNAME=e2e-testuser \
	TEST_PASSWORD=e2e-TestPass-9917 \
	E2E_ADMIN_USERNAME=e2e-admin \
	E2E_ADMIN_PASSWORD=e2e-admin-pass \
	npx playwright test --project=mobile --workers=2

.PHONY: e2e-down
e2e-down: e2e-next-down

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

