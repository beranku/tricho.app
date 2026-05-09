#!/usr/bin/env bash
# infrastructure/server/install-host.sh — Ubuntu 24.04 ARM64 host bootstrap.
#
# Idempotent. Safe to re-run any number of times. See
# openspec/specs/server-host-bootstrap/spec.md for the contract.
#
# What it does:
#   1. Sanity-check arch (arm64) + release (noble / 24.04).
#   2. Install Docker Engine + Compose v2 plugin via the modern signed-by
#      keyring pattern (apt-key was removed in Ubuntu 24.04).
#   3. Install sops, age, jq, restic, ufw, curl (no-install-recommends).
#   4. Create dedicated `ghrunner` user + add to docker group (NOT to sudo).
#   5. Create persistent /srv/tricho/{edge/acme,prod,dev}/... directories.
#   6. Write hardened /etc/docker/daemon.json (no-new-privileges,
#      userland-proxy: false, log rotation).
#   7. Configure ufw default-deny + allow 22/80/443.
#   8. Add 4G swap if absent.
#
# Designed to be invoked from infrastructure/server/bootstrap.sh (which also
# installs the runner) or via the server-bootstrap.yml workflow for upgrades.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "must run as root (try: sudo $0)" >&2
  exit 1
fi

# ── Sanity guards ───────────────────────────────────────────────────────────
arch="$(dpkg --print-architecture)"
if [ "$arch" != "arm64" ]; then
  echo "this bootstrap supports arm64 only (detected: $arch)" >&2
  exit 1
fi

. /etc/os-release
if [ "${VERSION_CODENAME:-}" != "noble" ]; then
  echo "this bootstrap supports Ubuntu 24.04 (noble) only (detected: ${VERSION_CODENAME:-unknown})" >&2
  exit 1
fi

echo "==> install-host.sh on $(hostname -f) ($arch / $VERSION_CODENAME)"

# ── Docker engine + compose plugin ──────────────────────────────────────────
if ! dpkg -s docker-ce >/dev/null 2>&1; then
  echo "==> installing docker engine"
  install -d -m 0755 /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
  fi
  cat > /etc/apt/sources.list.d/docker.list <<EOF
deb [arch=$arch signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable
EOF
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
  echo "==> docker already installed ($(docker --version))"
fi

# ── Other tooling (idempotent) ──────────────────────────────────────────────
# `sops` is NOT in Ubuntu's apt repo; install from upstream GitHub release.
# `age` is in apt and is fine. The rest is straight apt.
declare -A pkgs=(
  [age]=age
  [jq]=jq
  [restic]=restic
  [ufw]=ufw
  [curl]=curl
  [git]=git
  [make]=make
)
to_install=()
for bin in "${!pkgs[@]}"; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    to_install+=("${pkgs[$bin]}")
  fi
done
if [ ${#to_install[@]} -gt 0 ]; then
  echo "==> installing tooling: ${to_install[*]}"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${to_install[@]}"
fi

# sops via official GitHub release deb (linux-arm64). Pinning version so an
# upstream-yank doesn't surprise a re-bootstrap.
SOPS_VERSION="3.10.2"
SOPS_DEB="sops_${SOPS_VERSION}_arm64.deb"
SOPS_URL="https://github.com/getsops/sops/releases/download/v${SOPS_VERSION}/${SOPS_DEB}"
if ! command -v sops >/dev/null 2>&1 || [ "$(sops --version 2>/dev/null | awk '{print $2}' | head -1)" != "$SOPS_VERSION" ]; then
  echo "==> installing sops v$SOPS_VERSION"
  tmp_sops="$(mktemp -d)"
  trap 'rm -rf "$tmp_sops"' EXIT
  curl -fsSL -o "$tmp_sops/$SOPS_DEB" "$SOPS_URL"
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$tmp_sops/$SOPS_DEB"
fi

# ── Dedicated runner user ───────────────────────────────────────────────────
if ! getent passwd ghrunner >/dev/null 2>&1; then
  echo "==> creating ghrunner user"
  useradd --system --create-home --home-dir /var/lib/ghrunner --shell /bin/bash ghrunner
fi
if ! id -nG ghrunner | tr ' ' '\n' | grep -qx docker; then
  echo "==> adding ghrunner to docker group"
  usermod -aG docker ghrunner
fi

# ── Persistent data layout ──────────────────────────────────────────────────
echo "==> ensuring /srv/tricho layout"
install -d -m 0755 /srv/tricho
install -d -m 0700 /srv/tricho/edge
install -d -m 0700 /srv/tricho/edge/acme
install -d -m 0755 /srv/tricho/prod
install -d -m 0755 /srv/tricho/prod/couchdb
install -d -m 0755 /srv/tricho/prod/couchdb/data
install -d -m 0755 /srv/tricho/dev
install -d -m 0755 /srv/tricho/dev/couchdb
install -d -m 0755 /srv/tricho/dev/couchdb/data
# CouchDB upstream image runs as uid:gid 5984:5984.
chown -R 5984:5984 /srv/tricho/prod/couchdb /srv/tricho/dev/couchdb

# ── Hardened daemon.json ────────────────────────────────────────────────────
new_daemon_json='{
  "no-new-privileges": true,
  "userland-proxy": false,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "live-restore": true
}
'
# `userns-remap` deliberately NOT enabled here. For single-tenant production
# deploy on this host the migration cost outweighs the benefit; revisit if
# the host begins running untrusted workloads.

current="$(cat /etc/docker/daemon.json 2>/dev/null || true)"
if [ "$current" != "$new_daemon_json" ]; then
  echo "==> writing hardened /etc/docker/daemon.json"
  install -d -m 0755 /etc/docker
  printf '%s' "$new_daemon_json" > /etc/docker/daemon.json
  # `reload` is enough — `restart` would interrupt running containers.
  systemctl reload docker || systemctl restart docker
fi

# ── Firewall ────────────────────────────────────────────────────────────────
if ! ufw status | grep -q "^Status: active"; then
  echo "==> enabling ufw"
  ufw --force default deny incoming
  ufw --force default allow outgoing
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
else
  for port in 22 80 443; do
    if ! ufw status | grep -qE "^${port}/tcp\s+ALLOW"; then
      ufw allow ${port}/tcp
    fi
  done
fi

# Oracle Cloud's Ubuntu image ships /etc/iptables/rules.v4 with a high-priority
# global REJECT in the INPUT chain that fires before the ufw chains. Insert
# explicit ACCEPT for HTTP(S) at the head of INPUT so traffic reaches Traefik.
# Idempotent: -C (check) returns non-zero if the rule is missing.
#
# IMPORTANT: this only handles the host-local firewall. On Oracle Cloud you
# ALSO need the VCN's Security List (or NSG) to allow ingress on tcp/80 and
# tcp/443 — do that in the OCI console; it is outside this script's scope.
for port in 80 443; do
  if ! iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    iptables -I INPUT -p tcp --dport "$port" -j ACCEPT
  fi
done
# Persist via netfilter-persistent if installed; otherwise the rules survive
# until reboot only. (Oracle's image typically ships iptables-persistent.)
if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save >/dev/null 2>&1 || true
fi

# ── Swap ────────────────────────────────────────────────────────────────────
if ! swapon --show | grep -q '^/'; then
  if [ ! -f /swapfile ]; then
    echo "==> creating 4G swapfile"
    fallocate -l 4G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    if ! grep -q '^/swapfile' /etc/fstab; then
      echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
  fi
fi

# ── /opt/tricho for IMAGE_TAG.<env>.current rollback markers ────────────────
install -d -m 0755 -o ghrunner -g ghrunner /opt/tricho

echo "==> install-host.sh OK"
echo "    docker:  $(docker --version)"
echo "    compose: $(docker compose version --short 2>/dev/null || echo 'unknown')"
echo "    sops:    $(sops --version 2>/dev/null | head -1)"
echo "    age:     $(age --version 2>/dev/null | head -1)"
