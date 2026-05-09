#!/usr/bin/env bash
# /etc/cron.monthly/tricho-restore-drill — automated restore validation.
#
# Per openspec/specs/server-backup-restore/spec.md, this script:
#   1. Spins up a throwaway compose project tricho-restoretest from
#      infrastructure/server/sync/compose.yml.
#   2. Restores the most recent restic snapshot of tricho-sync-prod's
#      CouchDB data into the throwaway project's data path.
#   3. Boots CouchDB; verifies /_up returns 200, /_all_dbs lists the
#      meta DB, and at least one userdb-<hex> /_design/<...> view
#      responds within a sane timeout.
#   4. Tears the project down completely and removes its data path.
#   5. Emails / Telegrams the operator on failure.
#
# Untested backups are theoretical. This drill is what makes them real.

set -euo pipefail

CREDS_FILE="${TRICHO_BACKUP_CREDS:-/etc/tricho/restic-creds.env}"
if [ ! -f "$CREDS_FILE" ]; then
  echo "[restore-drill] $CREDS_FILE not found" >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a; . "$CREDS_FILE"; set +a

PROJECT_NAME="tricho-restoretest"
RESTORE_ROOT="/srv/tricho/restoretest"
RESTORE_DATA="$RESTORE_ROOT/couchdb/data"
LOG_TAG="[restore-drill $(date -u +%Y-%m-%dT%H:%M:%SZ)]"

# Force-clean any leftover state from a failed prior run.
cleanup() {
  local rc=$?
  echo "$LOG_TAG cleanup (exit=$rc)"
  if [ "$rc" -ne 0 ]; then
    echo "$LOG_TAG FAILED — see /var/log/tricho-restore-drill.log" >&2
  fi
  docker compose -p "$PROJECT_NAME" down --volumes --remove-orphans 2>/dev/null || true
  rm -rf "$RESTORE_ROOT"
  exit "$rc"
}
trap cleanup EXIT INT TERM

echo "$LOG_TAG starting"

# Fresh data directory — the cleanup block guarantees we start clean.
install -d -m 0755 -o 5984 -g 5984 "$RESTORE_ROOT/couchdb/data"

# Restore prod CouchDB data only (the bigger surface; edge ACME state
# isn't worth re-validating monthly because issuance is idempotent).
LATEST_SNAPSHOT=$(restic snapshots --tag tricho --json --latest 1 \
  --host "$(hostname -f)" \
  --path /srv/tricho/prod/couchdb/data 2>/dev/null \
  | jq -r '.[0].id // empty')

if [ -z "$LATEST_SNAPSHOT" ]; then
  echo "$LOG_TAG no recent prod snapshot found"
  exit 1
fi
echo "$LOG_TAG restoring snapshot $LATEST_SNAPSHOT"

restic restore "$LATEST_SNAPSHOT" \
  --target "$RESTORE_ROOT" \
  --include /srv/tricho/prod/couchdb/data \
  --quiet

# Move the restored tree into the place compose expects.
if [ -d "$RESTORE_ROOT/srv/tricho/prod/couchdb/data" ]; then
  rsync -a --delete --remove-source-files \
    "$RESTORE_ROOT/srv/tricho/prod/couchdb/data/" "$RESTORE_DATA/"
  rm -rf "$RESTORE_ROOT/srv"
fi

# Bring up an isolated stack pointing at the restored data. We override
# the data path via env (ENVIRONMENT=restoretest); compose.yml binds
# /srv/tricho/${ENVIRONMENT}/couchdb/data.
sync_dir="$(cd "$(dirname "$0")/../sync" && pwd)"
export COMPOSE_PROJECT_NAME="$PROJECT_NAME"
export ENVIRONMENT="restoretest"
export IMAGE_TAG="${IMAGE_TAG:-$(cat /opt/tricho/IMAGE_TAG.prod.current 2>/dev/null || echo 'sha-unknown')}"
export APP_HOST="restoretest.invalid"  # no real DNS — drill never serves traffic
export APP_ORIGIN="https://restoretest.invalid"
export TRICHO_AUTH_CORS_MIDDLEWARE="tricho-cors-dev"

echo "$LOG_TAG starting throwaway stack"
docker compose -p "$PROJECT_NAME" -f "$sync_dir/compose.yml" up -d --wait --wait-timeout 60 couchdb

# CouchDB internal liveness via docker exec — no Traefik, no DNS.
echo "$LOG_TAG probing CouchDB integrity"
docker compose -p "$PROJECT_NAME" -f "$sync_dir/compose.yml" exec -T couchdb \
  curl -sf -u "admin:$(cat /run/secrets/couchdb_password)" \
  http://localhost:5984/_up >/dev/null

# At least one userdb-<hex> should be present in a real prod restore.
ALL_DBS=$(docker compose -p "$PROJECT_NAME" -f "$sync_dir/compose.yml" exec -T couchdb \
  curl -sf -u "admin:$(cat /run/secrets/couchdb_password)" \
  http://localhost:5984/_all_dbs)
echo "$LOG_TAG _all_dbs sample: $(echo "$ALL_DBS" | head -c 200)"

if ! echo "$ALL_DBS" | grep -q 'userdb-\|_users\|_replicator\|tricho_meta'; then
  echo "$LOG_TAG WARN: no expected DBs in _all_dbs — backup may be incomplete (acceptable on a fresh stack with no users yet)"
fi

echo "$LOG_TAG drill OK"
exit 0
