#!/usr/bin/env bash
# infrastructure/server/backup/install-backup.sh — one-shot installer.
# Run on the deploy host as root once you've decided the off-site target
# (Backblaze B2 or rsync.net) and provisioned credentials.
#
# Idempotent: re-running after a config change updates the cron files
# and creds shape without losing the restic repository.
#
# Inputs (env, all optional — script prompts where missing):
#   RESTIC_REPOSITORY   e.g. b2:tricho-backup:o3
#                       or  sftp:user@xxx.rsync.net:tricho-backup
#   RESTIC_PASSWORD     Plaintext password for the restic repo. Stored
#                       at /etc/tricho/restic.pw (mode 0600, root-only)
#                       and ALSO printed once to stderr for the operator
#                       to copy into a password manager. Losing it loses
#                       the backups — the encryption is ours, not the
#                       provider's.
#   B2_ACCOUNT_ID, B2_ACCOUNT_KEY  B2-only.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "must run as root" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"

if ! command -v restic >/dev/null 2>&1; then
  echo "restic not installed; run install-host.sh first" >&2
  exit 1
fi

CREDS_DIR="/etc/tricho"
CREDS_FILE="$CREDS_DIR/restic-creds.env"
PW_FILE="$CREDS_DIR/restic.pw"

install -d -m 0700 -o root -g root "$CREDS_DIR"

# ── Repository URL ────────────────────────────────────────────────────────
if [ -z "${RESTIC_REPOSITORY:-}" ]; then
  if [ -f "$CREDS_FILE" ]; then
    # Re-use existing
    set -a; . "$CREDS_FILE"; set +a
  fi
fi
if [ -z "${RESTIC_REPOSITORY:-}" ]; then
  cat <<EOF >&2
RESTIC_REPOSITORY is not set. Pick a backend and re-run:

  Backblaze B2:
    export RESTIC_REPOSITORY=b2:<bucket>:<path>
    export B2_ACCOUNT_ID=…
    export B2_ACCOUNT_KEY=…

  rsync.net (SFTP-over-SSH; restic-friendly plan):
    export RESTIC_REPOSITORY=sftp:<user>@<host>.rsync.net:<path>
    # SSH key auth via /root/.ssh/id_rsa is required.

EOF
  exit 1
fi

# ── Password ──────────────────────────────────────────────────────────────
if [ -n "${RESTIC_PASSWORD:-}" ]; then
  install -m 0600 -o root -g root /dev/null "$PW_FILE"
  printf '%s' "$RESTIC_PASSWORD" > "$PW_FILE"
  echo "==> wrote $PW_FILE (mode 0600); copy this value into your password manager NOW:" >&2
  echo "    [redacted — see $PW_FILE on the host]" >&2
elif [ ! -f "$PW_FILE" ]; then
  # Auto-generate
  install -m 0600 -o root -g root /dev/null "$PW_FILE"
  openssl rand -hex 32 > "$PW_FILE"
  echo "==> generated $PW_FILE (mode 0600). The password is:" >&2
  echo "    $(cat "$PW_FILE")" >&2
  echo "    Save this value in your password manager NOW. Losing it loses the backups." >&2
fi

# ── Creds env file ────────────────────────────────────────────────────────
{
  echo "# Restic backup creds for tricho-app. Loaded by"
  echo "# /etc/cron.daily/tricho-backup and cron.monthly/tricho-restore-drill."
  echo "# Mode 0600, root-only."
  echo "RESTIC_REPOSITORY=$RESTIC_REPOSITORY"
  echo "RESTIC_PASSWORD_FILE=$PW_FILE"
  case "$RESTIC_REPOSITORY" in
    b2:*)
      echo "B2_ACCOUNT_ID=${B2_ACCOUNT_ID:-FILL_ME_IN}"
      echo "B2_ACCOUNT_KEY=${B2_ACCOUNT_KEY:-FILL_ME_IN}"
      ;;
  esac
} > "$CREDS_FILE"
chmod 0600 "$CREDS_FILE"
chown root:root "$CREDS_FILE"

# ── Initialize repository (idempotent — restic init exits 1 if exists) ────
echo "==> ensuring restic repository is initialized"
set -a; . "$CREDS_FILE"; set +a
if ! restic --password-file "$PW_FILE" snapshots --no-lock --json >/dev/null 2>&1; then
  restic --password-file "$PW_FILE" init
  echo "    initialized fresh repository"
else
  echo "    repository already initialized"
fi

# ── Cron files ────────────────────────────────────────────────────────────
install -m 0755 -o root -g root \
  "$script_dir/tricho-backup.sh" /etc/cron.daily/tricho-backup
install -m 0755 -o root -g root \
  "$script_dir/tricho-restore-drill.sh" /etc/cron.monthly/tricho-restore-drill

# ── Logrotate for the drill log file ──────────────────────────────────────
cat > /etc/logrotate.d/tricho-backup <<'EOF'
/var/log/tricho-backup.log /var/log/tricho-restore-drill.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    copytruncate
}
EOF

# ── Verify daily cron runs (synthetic dry run) ────────────────────────────
echo "==> dry-running tricho-backup once to verify creds"
if /etc/cron.daily/tricho-backup; then
  echo "==> dry run succeeded; the next scheduled run will produce snapshot #2"
else
  echo "==> dry run FAILED; check /etc/tricho/restic-creds.env" >&2
  exit 1
fi

cat <<EOF

==========================================================================
Backup installed on $(hostname -f).

  Daily snapshot:  /etc/cron.daily/tricho-backup
  Monthly drill:   /etc/cron.monthly/tricho-restore-drill
  Repo:            $RESTIC_REPOSITORY
  Password file:   $PW_FILE
  Retention:       30 daily, 12 monthly, 2 yearly

To list snapshots:
  set -a; . $CREDS_FILE; set +a
  restic snapshots

To run the restore drill manually NOW (recommended on first install):
  /etc/cron.monthly/tricho-restore-drill

Backup sensitivity reminder: restic encrypts contents at rest, but the
on-disk CouchDB state contains plaintext metadata (vaultId, docId, OAuth
sub claims, _users table). Treat the password and provider creds as
material with the same sensitivity as SOPS age private keys.
==========================================================================
EOF
