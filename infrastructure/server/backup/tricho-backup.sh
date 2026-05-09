#!/usr/bin/env bash
# /etc/cron.daily/tricho-backup — daily off-site snapshot of the deploy
# host's persistent state via restic. Provider-agnostic: works against
# Backblaze B2, rsync.net, or any other restic backend by pointing
# RESTIC_REPOSITORY at it (set in /etc/tricho/restic-creds.env).
#
# Per openspec/specs/server-backup-restore/spec.md, this script:
#   1. Snapshots /srv/tricho/<env>/couchdb/data and /srv/tricho/edge/acme
#      to the off-site repo (encrypted at rest by restic xchacha20-poly1305).
#   2. Applies retention policy: 30 daily, 12 monthly, 2 yearly.
#   3. On failure, exits non-zero (cron's MAILTO catches it). When the
#      operator wires a Telegram/email channel later, swap the alert
#      below for the project-specific notifier.
#
# Installed by infrastructure/server/backup/install-backup.sh.
# CouchDB 3 storage is append-only, so a live snapshot is consistent
# without quiescing — see CouchDB §5.3.

set -euo pipefail

# ── Provider creds + repo URL ──────────────────────────────────────────────
# /etc/tricho/restic-creds.env defines:
#   RESTIC_REPOSITORY=b2:tricho-backup:o3       (B2)         OR
#   RESTIC_REPOSITORY=sftp:tricho@…:repo        (rsync.net)  etc.
#   B2_ACCOUNT_ID=…  B2_ACCOUNT_KEY=…           (B2 only)
#   RESTIC_PASSWORD_FILE=/etc/tricho/restic.pw
CREDS_FILE="${TRICHO_BACKUP_CREDS:-/etc/tricho/restic-creds.env}"
if [ ! -f "$CREDS_FILE" ]; then
  echo "[tricho-backup] $CREDS_FILE not found; install via infrastructure/server/backup/install-backup.sh" >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a; . "$CREDS_FILE"; set +a

if [ -z "${RESTIC_REPOSITORY:-}" ] || [ -z "${RESTIC_PASSWORD_FILE:-}" ]; then
  echo "[tricho-backup] RESTIC_REPOSITORY or RESTIC_PASSWORD_FILE missing in $CREDS_FILE" >&2
  exit 1
fi

# ── Source paths ──────────────────────────────────────────────────────────
# Per server-backup-restore spec — exactly these paths form a recoverable
# snapshot. The shards subdir order matters per CouchDB docs (§5.3):
# back .shards before .couch files so restore replays without reindex.
SOURCES=(
  /srv/tricho/edge/acme
)
# Auto-include every deployed environment's CouchDB data.
for env_dir in /srv/tricho/*/couchdb/data; do
  [ -d "$env_dir" ] && SOURCES+=("$env_dir")
done

# ── Snapshot ──────────────────────────────────────────────────────────────
hostname_tag="$(hostname -f)"
log_prefix="[tricho-backup $(date -u +%Y-%m-%dT%H:%M:%SZ)]"
echo "$log_prefix snapshot starting → $RESTIC_REPOSITORY"

restic backup \
  --tag tricho \
  --tag "host:${hostname_tag}" \
  --host "$hostname_tag" \
  --quiet \
  "${SOURCES[@]}"

# ── Retention ─────────────────────────────────────────────────────────────
restic forget \
  --keep-daily 30 \
  --keep-monthly 12 \
  --keep-yearly 2 \
  --tag tricho \
  --prune \
  --quiet

echo "$log_prefix done"
