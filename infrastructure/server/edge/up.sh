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

# Optional staging CA override. When set, append the caServer flag to the
# running container's command via a compose override. Implemented as an
# env-driven inline override file written next to compose.yml.
override_path=".compose.override.yml"
if [ "${TRAEFIK_USE_LE_STAGING:-0}" = "1" ]; then
  cat > "$override_path" <<'EOF'
services:
  traefik:
    command:
      - --certificatesresolvers.le.acme.caServer=https://acme-staging-v02.api.letsencrypt.org/directory
EOF
  compose_args=(-f compose.yml -f "$override_path")
  echo "==> using LE staging CA"
else
  rm -f "$override_path"
  compose_args=(-f compose.yml)
fi

echo "==> starting tricho-edge"
docker compose "${compose_args[@]}" up -d --wait --wait-timeout 30
docker compose "${compose_args[@]}" ps
