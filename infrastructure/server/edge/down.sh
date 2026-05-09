#!/usr/bin/env bash
# infrastructure/server/edge/down.sh — stop the shared Traefik edge.
#
# Does NOT delete /srv/tricho/edge/acme/* (LE rate limit guard).
# Does NOT delete the tricho-edge network (per-env stacks may still need it).
#
# Used during planned maintenance. Routine deploys should not run this.

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$script_dir"

echo "==> stopping tricho-edge (preserving ACME state and tricho-edge network)"
docker compose -f compose.yml down
echo "==> done. ACME state preserved at /srv/tricho/edge/acme/"
