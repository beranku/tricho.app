#!/usr/bin/env bash
# infrastructure/server/install-runner.sh — install + register the GitHub
# Actions self-hosted runner as a hardened systemd unit.
#
# Idempotent. Re-running upgrades the runner version (if changed) without
# losing in-flight jobs (the unit drains then restarts).
#
# Inputs (env, required on first run):
#   RUNNER_REGISTRATION_TOKEN   one-shot registration token from
#       `gh api -X POST /repos/beranku/tricho.app/actions/runners/registration-token`
#       Token TTL is ~1 hour. config.sh consumes it once to provision
#       persistent runner credentials in /opt/actions-runner/.credentials.
#       After config.sh succeeds the token is no longer needed for the
#       lifetime of this runner.
#
# Inputs (env, optional):
#   RUNNER_LABEL                runner label override (default: hostname -f)
#
# Reads:
#   - infrastructure/server/runner-version.txt
#   - infrastructure/server/runner-checksums.txt
#
# See openspec/specs/server-host-bootstrap/spec.md for the contract.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "must run as root" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"

VERSION="$(tr -d '[:space:]' < "$script_dir/runner-version.txt")"
ARCH="linux-arm64"
TARBALL="actions-runner-${ARCH}-${VERSION}.tar.gz"
EXPECTED_SHA="$(awk -v t="$TARBALL" '$2 == t { print $1 }' "$script_dir/runner-checksums.txt" | head -1)"

if [ -z "$EXPECTED_SHA" ] || [ "$EXPECTED_SHA" = "PLACEHOLDER_REPLACE_BEFORE_BOOTSTRAP" ]; then
  echo "no real SHA256 for $TARBALL in runner-checksums.txt — refusing to install unverified binary" >&2
  echo "fix: look up the checksum at https://github.com/actions/runner/releases/tag/v${VERSION} and commit it" >&2
  exit 1
fi

RUNNER_HOME="/opt/actions-runner"
HOST="$(hostname -f)"
LABEL="${RUNNER_LABEL:-$HOST}"
REPO_URL="https://github.com/beranku/tricho.app"
UNIT_NAME="actions.runner.beranku-tricho.app.${HOST}.service"

# ── Tarball install / upgrade ───────────────────────────────────────────────
needs_install=0
if [ ! -f "$RUNNER_HOME/.runner-version" ] || [ "$(cat "$RUNNER_HOME/.runner-version" 2>/dev/null || echo)" != "$VERSION" ]; then
  needs_install=1
fi

if [ $needs_install -eq 1 ]; then
  echo "==> installing actions/runner v$VERSION ($ARCH)"
  install -d -m 0755 -o ghrunner -g ghrunner "$RUNNER_HOME"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL -o "$tmp/$TARBALL" \
    "https://github.com/actions/runner/releases/download/v${VERSION}/${TARBALL}"
  echo "$EXPECTED_SHA  $tmp/$TARBALL" | sha256sum --check --status
  # If a runner unit is already running, stop it so we can replace files.
  if systemctl list-unit-files | grep -q "^${UNIT_NAME}"; then
    systemctl stop "$UNIT_NAME" 2>/dev/null || true
  fi
  tar -xzf "$tmp/$TARBALL" -C "$RUNNER_HOME"
  chown -R ghrunner:ghrunner "$RUNNER_HOME"
  echo "$VERSION" > "$RUNNER_HOME/.runner-version"
fi

# ── Hardened systemd unit ───────────────────────────────────────────────────
# Authored BEFORE the registration step so that re-running the script to
# upgrade the unit (e.g. after editing the hardening overlay) is a no-op
# even when no registration token is provided.
# Replace any default unit svc.sh would have written. ExecStart calls run.sh
# without --ephemeral (config.sh already persisted that flag).
unit_path="/etc/systemd/system/${UNIT_NAME}"
new_unit="[Unit]
Description=GitHub Actions runner (${HOST})
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=ghrunner
Group=ghrunner
WorkingDirectory=${RUNNER_HOME}
# Redirect HOME from /var/lib/ghrunner (which ProtectSystem=strict makes
# read-only) to the runner's working tree. Tools like \`docker login\` and
# \`gh auth\` write to \$HOME/.docker, \$HOME/.config/gh, etc.
Environment=HOME=${RUNNER_HOME}
ExecStart=${RUNNER_HOME}/run.sh
Restart=always
RestartSec=5
TimeoutStopSec=5min
KillMode=process
KillSignal=SIGTERM

# Hardening — see openspec/specs/server-host-bootstrap/spec.md
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=${RUNNER_HOME} /var/run/docker.sock /opt/tricho /srv/tricho
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictNamespaces=yes
LockPersonality=yes
SystemCallArchitectures=native
LogNamespace=ghrunner

[Install]
WantedBy=multi-user.target
"

current_unit="$(cat "$unit_path" 2>/dev/null || true)"
if [ "$current_unit" != "$new_unit" ]; then
  echo "==> writing hardened systemd unit at $unit_path"
  printf '%s' "$new_unit" > "$unit_path"
  systemctl daemon-reload
  systemctl enable "$UNIT_NAME" >/dev/null
fi

# ── Configure (one-shot) ────────────────────────────────────────────────────
# config.sh exchanges the registration token for persistent runner credentials
# (.credentials, .runner). After this step the registration token is no
# longer needed and is NOT persisted to disk by us.
if [ ! -f "$RUNNER_HOME/.runner" ]; then
  if [ -z "${RUNNER_REGISTRATION_TOKEN:-}" ]; then
    echo "==> systemd unit installed; runner not yet configured"
    echo "    re-run with RUNNER_REGISTRATION_TOKEN=... to register, e.g.:"
    echo "      gh api -X POST /repos/beranku/tricho.app/actions/runners/registration-token --jq .token"
    echo "    (token has ~1h TTL; config.sh consumes it once)"
    exit 0
  fi
  echo "==> registering runner '$LABEL' against $REPO_URL"
  # Ensure the unit isn't actively trying (and failing) to run an
  # unconfigured agent while we're configuring.
  systemctl stop "$UNIT_NAME" 2>/dev/null || true
  # Persistent runner (NOT --ephemeral). The --ephemeral pattern requires
  # an external orchestrator (e.g. Actions Runner Controller) to mint a
  # fresh JIT config per job — systemd's Restart=always alone restarts the
  # runner with no config and infinite-loops "Not configured". Persistent
  # mode keeps the same registration alive across many jobs; the systemd
  # hardening (User=ghrunner, ProtectSystem=strict, etc.) preserves the
  # core security posture. See openspec/specs/server-host-bootstrap/ for
  # the full rationale.
  sudo -u ghrunner -- "$RUNNER_HOME/config.sh" \
    --url "$REPO_URL" \
    --token "$RUNNER_REGISTRATION_TOKEN" \
    --name "$HOST" \
    --labels "$LABEL" \
    --runnergroup default \
    --work _work \
    --unattended \
    --replace \
    --disableupdate
  unset RUNNER_REGISTRATION_TOKEN
fi

if ! systemctl is-active --quiet "$UNIT_NAME"; then
  systemctl start "$UNIT_NAME"
fi

echo "==> install-runner.sh OK"
echo "    runner version: $VERSION"
echo "    unit:           $UNIT_NAME"
echo "    label:          $LABEL"
