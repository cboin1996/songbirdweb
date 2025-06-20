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

