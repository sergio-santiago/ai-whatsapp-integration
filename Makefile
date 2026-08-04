COMPOSE     := docker compose
COMPOSE_DEV := docker compose -f compose.yaml -f compose.dev.yaml

.DEFAULT_GOAL := help
.PHONY: help setup check test test-watch typecheck start dev build up up-dev down logs sh clean

## Show this help
help:
	@grep -E '^##' -A1 $(MAKEFILE_LIST) \
		| grep -v '^--' \
		| sed 'N;s/^## \(.*\)\n\([a-z-]*\):.*/  \2|\1/' \
		| column -t -s '|'

# ─── Local, no Docker ────────────────────────────────────────────────────────

## Install dependencies and create .env from the example
setup:
	npm install
	@test -f .env || (cp .env.example .env && echo "created .env, fill it in")

## Run the whole verification suite, the same one CI runs
check: typecheck test

## Run the tests
test:
	npm test

## Re-run the tests on every change
test-watch:
	node --test --watch

## Typecheck without emitting anything
typecheck:
	npm run typecheck

## Run the service against .env
start:
	npm start

## Run the service with reload on change
dev:
	npm run dev

# ─── Docker ──────────────────────────────────────────────────────────────────

## Build the image
build:
	$(COMPOSE) build

## Start the service in the background
up:
	$(COMPOSE) up -d

## Start the service with the development overlay, in the foreground
up-dev:
	$(COMPOSE_DEV) up

## Stop the service
down:
	$(COMPOSE) down

## Follow the logs
logs:
	$(COMPOSE) logs -f app

## Open a shell inside the running container
sh:
	$(COMPOSE) exec app sh

## Remove containers, volumes and locally built images
clean:
	$(COMPOSE) down -v --rmi local
