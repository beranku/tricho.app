#!/usr/bin/env bash
# infrastructure/server/edge/up.sh — bring up the shared Traefik edge
# project. Idempotent. Persistent across per-env stack redeploys.
#
# Required env:
#   TRAEFIK_ACME_EMAIL    contact email for Let's Encrypt
#
# Optional env:
#   TRAEFIK_USE_LE_STAGING=1   use the LE staging CA (avoids prod rate limits)
#   TRAEFIK_LOG_LEVEL=DEBUG    raise Traefik log verbosity

set -euo pipefail

if [ -z "${TRAEFIK_ACME_EMAIL:-}" ]; then
  echo "TRAEFIK_ACME_EMAIL is required" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$script_dir"

# Ensure the external network exists. `docker network create` is NOT
# idempotent on its own — guard explicitly.
if ! docker network inspect tricho-edge >/dev/null 2>&1; then
  echo "==> creating external network tricho-edge"
  docker network create --attachable tricho-edge >/dev/null
fi

# Ensure ACME bind path exists with the right perms BEFORE Traefik tries
# to write into it. Per the traefik-edge spec this MUST be a directory
# bind (not a single-file bind) and live outside the project tree.
if [ ! -d /srv/tricho/edge/acme ]; then
  echo "==> creating /srv/tricho/edge/acme"
  install -d -m 0700 /srv/tricho/edge/acme
fi

# LE staging URL switch. compose.yml reads TRAEFIK_ACME_CASERVER with a
# production default; we override it for staging.
if [ "${TRAEFIK_USE_LE_STAGING:-0}" = "1" ]; then
  export TRAEFIK_ACME_CASERVER="https://acme-staging-v02.api.letsencrypt.org/directory"
  echo "==> using LE staging CA"
fi

echo "==> starting tricho-edge"
docker compose -f compose.yml up -d --wait --wait-timeout 30 --remove-orphans
docker compose -f compose.yml ps
