# TrichoApp — one-command stack orchestration.
#
# Primary developer entry point. Wraps docker compose profiles and the
# SOPS-driven secret rendering step so you never have to remember which
# -f flags or env vars to set for dev / ci / prod.
#
# Idempotent: every target is safe to re-run. Prereq checks fail loudly
# (missing docker, missing age key, missing sops) before invoking compose.

SHELL           := /usr/bin/env bash
.SHELLFLAGS     := -eu -o pipefail -c
.DEFAULT_GOAL   := help

# ── Configuration ────────────────────────────────────────────────────────────
PROFILE         ?= dev
# Prefer the v2 `docker compose` plugin; fall back to legacy `docker-compose`.
COMPOSE         ?= $(shell if docker compose version >/dev/null 2>&1; then echo "docker compose"; elif command -v docker-compose >/dev/null; then echo "docker-compose"; else echo "docker compose"; fi)
COMPOSE_FILE    ?= compose.yml
SECRETS_DIR     := .secrets-runtime
AGE_KEY_PATH    := $${SOPS_AGE_KEY_FILE:-$$HOME/.config/sops/age/keys.txt}

# Load layered env: committed .env defaults, then optional .env.local overrides.
# Compose reads .env natively; .env.local is passed through explicitly.
ENV_FILE_ARGS   := --env-file .env $(shell test -f .env.local && echo "--env-file .env.local")

# ── Public targets ───────────────────────────────────────────────────────────

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "Usage: make \033[36m<target>\033[0m\n\nTargets:\n"} \
		/^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

.PHONY: dev
dev: _check-prereqs _render-secrets ## Bring up the dev stack (CouchDB + tricho-auth [+ PWA dev in section 2+])
	PROFILE=dev $(COMPOSE) $(ENV_FILE_ARGS) -f $(COMPOSE_FILE) --profile dev up -d
	@echo "Stack up. CouchDB at http://localhost:5984, tricho-auth at http://localhost:4545"

.PHONY: prod-local
prod-local: _check-prereqs _guard-profile _render-secrets ## Run the prod topology locally (Let's Encrypt, Caddy-served dist)
	PROFILE=prod $(COMPOSE) $(ENV_FILE_ARGS) -f $(COMPOSE_FILE) --profile prod up -d
	@echo "Prod stack up at https://$${APP_HOST:-tricho.localhost}"

.PHONY: ci
ci: _check-prereqs _guard-profile _render-secrets ## Bring up the CI profile (self-signed TLS + mock OIDC)
	GOOGLE_ISSUER_URL=http://mock-oidc:8080 \
	GOOGLE_CLIENT_ID=mock-client \
	GOOGLE_REDIRECT_URI=https://tricho.test/auth/google/callback \
	PROFILE=ci $(COMPOSE) $(ENV_FILE_ARGS) -f $(COMPOSE_FILE) --profile ci up -d
	@echo "CI stack up at https://tricho.test"

.PHONY: down
down: ## Stop every profile and remove runtime secrets
	-$(COMPOSE) $(ENV_FILE_ARGS) -f $(COMPOSE_FILE) --profile dev --profile prod --profile ci down
	@rm -rf $(SECRETS_DIR)
	@echo "Stack down. Runtime secrets wiped."

.PHONY: logs
logs: ## Tail logs of the running stack
	$(COMPOSE) $(ENV_FILE_ARGS) -f $(COMPOSE_FILE) logs -f --tail=200

.PHONY: e2e
e2e: _check-prereqs ## Run Playwright end-to-end suite against the ci profile stack
	@set -eu; \
	getent hosts tricho.test >/dev/null 2>&1 || grep -q "tricho.test" /etc/hosts 2>/dev/null || { \
		echo "tricho.test does not resolve. Add '127.0.0.1 tricho.test' to /etc/hosts:" >&2; \
		echo "  echo '127.0.0.1 tricho.test' | sudo tee -a /etc/hosts" >&2; \
		exit 1; \
	}; \
	project="tricho-e2e-$${GITHUB_RUN_ID:-$$$$}"; \
	echo "e2e project: $$project"; \
	trap "COMPOSE_PROJECT_NAME=$$project $(COMPOSE) $(ENV_FILE_ARGS) -f $(COMPOSE_FILE) --profile ci down -v >/dev/null 2>&1 || true; rm -rf $(SECRETS_DIR)" EXIT INT TERM; \
	$(MAKE) _render-secrets PROFILE=ci; \
	COMPOSE_PROJECT_NAME=$$project GOOGLE_ISSUER_URL=http://mock-oidc:8080 \
	  GOOGLE_CLIENT_ID=mock-client \
	  GOOGLE_REDIRECT_URI=https://tricho.test/auth/google/callback \
	  $(COMPOSE) $(ENV_FILE_ARGS) -f $(COMPOSE_FILE) --profile ci up -d --build; \
	echo "waiting for Traefik on https://tricho.test"; \
	for i in $$(seq 1 30); do \
		if curl -skf https://tricho.test/auth/health >/dev/null 2>&1; then echo "up"; break; fi; \
		[ $$i -eq 30 ] && { echo "stack never became healthy"; $(COMPOSE) -p $$project logs --tail=200; exit 1; }; \
		sleep 2; \
	done; \
	if [ ! -d node_modules/@playwright ]; then npm ci; fi; \
	npx playwright install chromium >/dev/null 2>&1 || true; \
	npx playwright test

.PHONY: secrets-edit
secrets-edit: ## Edit secrets/$(PROFILE).sops.yaml with sops (wired in section 5)
	@command -v sops >/dev/null || { echo "sops not installed — see secrets/README.md"; exit 1; }
	@test -f secrets/$(PROFILE).sops.yaml || { echo "secrets/$(PROFILE).sops.yaml missing — bootstrap in section 5"; exit 1; }
	sops secrets/$(PROFILE).sops.yaml

.PHONY: secrets-rotate-age
secrets-rotate-age: ## Rewrite every SOPS-encrypted secret with the current .sops.yaml recipient set (wired in section 5)
	@command -v sops >/dev/null || { echo "sops not installed"; exit 1; }
	@for f in secrets/*.sops.yaml; do \
		[ -f "$$f" ] && sops updatekeys -y "$$f" || true; \
	done

.PHONY: doctor
doctor: ## Diagnose local prerequisites (Docker, SOPS, age, hosts, DNS)
	@set -eu; status=0; \
	check() { name="$$1"; shift; if "$$@" >/dev/null 2>&1; then echo "  OK     $$name"; else echo "  MISSING $$name"; status=1; fi; }; \
	echo "Checking prerequisites:"; \
	check "docker"                command -v docker; \
	check "docker daemon"         docker info; \
	check "docker compose v2"     docker compose version; \
	check "sops"                  command -v sops; \
	check "age"                   command -v age; \
	check "age-keygen"            command -v age-keygen; \
	check "jq"                    command -v jq; \
	check "openssl"               command -v openssl; \
	check "age key file"          test -f "$$HOME/.config/sops/age/keys.txt"; \
	check "tricho.localhost DNS"  sh -c 'getent hosts tricho.localhost >/dev/null || ping -c1 -W1 tricho.localhost'; \
	check "tricho.test DNS"       sh -c 'getent hosts tricho.test >/dev/null 2>&1 || grep -q tricho.test /etc/hosts'; \
	echo; \
	if [ $$status -eq 0 ]; then echo "All checks passed."; else echo "Some checks failed — see secrets/README.md and root README for setup."; fi; \
	exit $$status

# ── Internal helpers ─────────────────────────────────────────────────────────

.PHONY: _check-prereqs
_check-prereqs:
	@command -v docker >/dev/null || { echo "docker not installed"; exit 1; }
	@docker info >/dev/null 2>&1 || { echo "docker daemon not reachable"; exit 1; }
	@$(COMPOSE) version >/dev/null 2>&1 || { echo "'docker compose' subcommand missing"; exit 1; }

.PHONY: _render-secrets
_render-secrets:
	@set -eu; \
	profile="$${PROFILE:-dev}"; \
	mkdir -p $(SECRETS_DIR) && chmod 700 $(SECRETS_DIR); \
	sops_file="secrets/$$profile.sops.yaml"; \
	if [ -f "$$sops_file" ]; then \
		command -v sops >/dev/null || { echo "sops not installed (see secrets/README.md)" >&2; exit 1; }; \
		command -v jq   >/dev/null || { echo "jq not installed (required to split SOPS output)" >&2; exit 1; }; \
		test -n "$${SOPS_AGE_KEY:-}" || test -f "$$HOME/.config/sops/age/keys.txt" || { \
			echo "no age key available (set SOPS_AGE_KEY or create ~/.config/sops/age/keys.txt)" >&2; \
			echo "see secrets/README.md for onboarding" >&2; \
			exit 1; \
		}; \
		tmp="$$(mktemp)"; trap "rm -f $$tmp" EXIT; \
		sops -d --input-type yaml --output-type json "$$sops_file" > "$$tmp"; \
		for k in $$(jq -r 'keys[]' "$$tmp"); do \
			jq -r --arg key "$$k" '.[$$key] // empty' "$$tmp" > "$(SECRETS_DIR)/$$k"; \
			chmod 0600 "$(SECRETS_DIR)/$$k"; \
		done; \
		echo "rendered $$(jq -r 'keys | length' "$$tmp") secrets from $$sops_file"; \
	elif [ "$$profile" = "dev" ] && [ -f secrets/dev.fallback.env ]; then \
		echo "no secrets/$$profile.sops.yaml yet — using dev fallback (see secrets/README.md)"; \
		while IFS= read -r line; do \
			case "$$line" in ''|\#*) continue;; esac; \
			key="$${line%%=*}"; val="$${line#*=}"; \
			[ -n "$$key" ] || continue; \
			printf '%s' "$$val" > "$(SECRETS_DIR)/$$key"; \
			chmod 0600 "$(SECRETS_DIR)/$$key"; \
		done < secrets/dev.fallback.env; \
	else \
		echo "secrets/$$profile.sops.yaml missing — required for profile '$$profile'" >&2; \
		echo "author it per secrets/README.md before running this target" >&2; \
		exit 1; \
	fi; \
	touch "$(SECRETS_DIR)/couchdb_password" "$(SECRETS_DIR)/cookie_secret" \
		"$(SECRETS_DIR)/google_client_secret" "$(SECRETS_DIR)/apple_client_secret" \
		"$(SECRETS_DIR)/jwt_private_pem"; \
	chmod 0600 "$(SECRETS_DIR)/"*

.PHONY: _guard-profile
_guard-profile:
	@# Verify the resolved compose config for the active profile does not
	@# contain services that belong to a different profile. Catches authoring
	@# mistakes (e.g. accidentally tagging mock-oidc with [prod]) before they
	@# ship. Called by prod-local and ci.
	@set -eu; \
	profile="$${PROFILE:-dev}"; \
	services="$$($(COMPOSE) -f $(COMPOSE_FILE) --profile $$profile config --services 2>/dev/null)"; \
	case "$$profile" in \
	  prod) \
	    for forbidden in mock-oidc pwa-dev traefik-dev traefik-ci couchdb tricho-auth; do \
	      if echo "$$services" | grep -qx "$$forbidden"; then \
	        echo "guard: forbidden service '$$forbidden' active in $$profile profile" >&2; exit 1; \
	      fi; \
	    done;; \
	  ci) \
	    for forbidden in pwa-dev traefik-dev traefik couchdb tricho-auth; do \
	      if echo "$$services" | grep -qx "$$forbidden"; then \
	        echo "guard: forbidden service '$$forbidden' active in $$profile profile" >&2; exit 1; \
	      fi; \
	    done;; \
	esac; \
	echo "guard: $$profile profile OK"
