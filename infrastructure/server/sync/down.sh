#!/usr/bin/env bash
# infrastructure/server/sync/down.sh — stop one environment's sync stack.
#
# Leaves /srv/tricho/<env>/couchdb/data/ intact. Leaves the
# tricho-edge external network intact (the edge project owns it).
#
# Usage: bash infrastructure/server/sync/down.sh prod|dev

set -euo pipefail

ENVIRONMENT="${1:-}"
case "$ENVIRONMENT" in
  prod|dev) ;;
  *) echo "usage: $0 prod|dev" >&2; exit 1 ;;
esac

sync_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$sync_dir"

export COMPOSE_PROJECT_NAME="tricho-sync-${ENVIRONMENT}"
export ENVIRONMENT
# IMAGE_TAG is required by compose.yml's variable substitution but its
# actual value doesn't matter for `down`; placeholder unblocks the call.
export IMAGE_TAG="${IMAGE_TAG:-sha-down}"

echo "==> stopping $COMPOSE_PROJECT_NAME (preserving /srv/tricho/${ENVIRONMENT}/couchdb/data/)"
docker compose down
echo "==> done"
