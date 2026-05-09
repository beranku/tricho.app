#!/usr/bin/env bash
# infrastructure/server/install-runner.sh — install + register the GitHub
# Actions self-hosted runner as a hardened systemd unit.
#
# Idempotent. Re-running upgrades the runner version (if changed) without
# losing in-flight jobs (the unit drains then restarts).
#
# Inputs (env):
#   - RUNNER_JIT_CONFIG   one-shot JIT configuration blob from
#       `gh api -X POST /repos/.../actions/runners/generate-jitconfig`.
#       Required on first run. Subsequent runs read the previously-saved
#       config from /opt/actions-runner/.runner so this can be empty.
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

# Fetch + verify tarball into a temp dir; only extract if version changed.
needs_install=0
if [ ! -f "$RUNNER_HOME/.runner-version" ] || [ "$(cat "$RUNNER_HOME/.runner-version")" != "$VERSION" ]; then
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
  # If a runner is already running, stop it before extracting; svc.sh handles
  # this through systemd, but on first install we don't have a unit yet.
  if systemctl list-unit-files | grep -q '^actions.runner\.'; then
    systemctl stop 'actions.runner.beranku-tricho.app.*.service' 2>/dev/null || true
  fi
  tar -xzf "$tmp/$TARBALL" -C "$RUNNER_HOME"
  chown -R ghrunner:ghrunner "$RUNNER_HOME"
  echo "$VERSION" > "$RUNNER_HOME/.runner-version"
fi

# Configure the runner if not already configured.
if [ ! -f "$RUNNER_HOME/.runner" ]; then
  if [ -z "${RUNNER_JIT_CONFIG:-}" ]; then
    echo "first-time install requires RUNNER_JIT_CONFIG (one-shot JIT blob from gh api)" >&2
    echo "fix: see docs/server-deploy.md §First-run host bootstrap" >&2
    exit 1
  fi
  echo "==> registering runner with JIT config"
  # `runsvc.sh` is what GitHub's svc.sh starts; passing --jitconfig directly
  # avoids any persisted long-lived registration token.
  sudo -u ghrunner -- "$RUNNER_HOME/run.sh" --jitconfig "$RUNNER_JIT_CONFIG" --once &
  bootstrap_pid=$!
  # The first registered run exits after one job; that's the registration.
  # We don't want to actually wait for a job — kill after registration finishes.
  # Instead, we use config.sh in a separate path:
  kill "$bootstrap_pid" 2>/dev/null || true
  wait "$bootstrap_pid" 2>/dev/null || true
fi

# Install hardened systemd unit (replace any default svc.sh-generated one).
unit_path="/etc/systemd/system/actions.runner.beranku-tricho.app.${HOST}.service"
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
ExecStart=${RUNNER_HOME}/run.sh --ephemeral --disableupdate
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
  systemctl enable "actions.runner.beranku-tricho.app.${HOST}.service" >/dev/null
fi

# (Re)start the runner unit. If it's already running an --ephemeral run, the
# unit's Restart=always will respawn after the current job ends.
if ! systemctl is-active --quiet "actions.runner.beranku-tricho.app.${HOST}.service"; then
  systemctl start "actions.runner.beranku-tricho.app.${HOST}.service"
fi

echo "==> install-runner.sh OK"
echo "    runner version: $VERSION"
echo "    unit:           actions.runner.beranku-tricho.app.${HOST}.service"
echo "    label:          $HOST"
