#!/usr/bin/env bash
# infrastructure/server/sync/up.sh — bring up (or upgrade) one
# environment's sync stack on the deploy host.
#
# Usage:    bash infrastructure/server/sync/up.sh prod
#           bash infrastructure/server/sync/up.sh dev
#
# Required env (set by the deploy workflow):
#   IMAGE_TAG       — e.g. sha-<full-git-sha>. Consumed by compose.yml.
#   SOPS_AGE_KEY    — for `make _render-secrets` to decrypt sync-<env>.sops.yaml
#                     (alternative: SOPS_AGE_KEY_FILE pointing at the host's key)
#
# Per server-stack-deploy spec (three-gate DoD):
#   1. compose up --wait green
#   2. external HTTPS smoke (curl /auth/health, X-Build-Sha matches)
#   3. data-path probe (smoke.sh)
# On any failure, restore /opt/tricho/IMAGE_TAG.<env>.current and re-up.

set -euo pipefail

ENVIRONMENT="${1:-}"
case "$ENVIRONMENT" in
  prod|dev) ;;
  *) echo "usage: $0 prod|dev" >&2; exit 1 ;;
esac

if [ -z "${IMAGE_TAG:-}" ]; then
  echo "IMAGE_TAG is required (e.g. sha-<full-git-sha>)" >&2
  exit 1
fi

case "$IMAGE_TAG" in
  sha-*) ;;
  *) echo "IMAGE_TAG must be of the form sha-<full-git-sha>; got: $IMAGE_TAG" >&2; exit 1 ;;
esac

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
sync_dir="$repo_root/infrastructure/server/sync"
cd "$sync_dir"

# Compose project name + persistent rollback marker path.
export COMPOSE_PROJECT_NAME="tricho-sync-${ENVIRONMENT}"
export ENVIRONMENT
ROLLBACK_MARKER="/opt/tricho/IMAGE_TAG.${ENVIRONMENT}.current"

# Layered env: defaults → versions → per-env. Per-env wins.
set -a
. "$sync_dir/config/default/.env"
[ -f "$sync_dir/config/default/versions.env" ] && . "$sync_dir/config/default/versions.env"
. "$sync_dir/config/${ENVIRONMENT}/.env"
set +a

# Render SOPS secrets for this env into ./.secrets-runtime/ (relative to
# compose.yml's location, where the file-mounted Docker secrets resolve).
echo "==> rendering secrets for sync-${ENVIRONMENT}"
( cd "$repo_root" && make _render-secrets PROFILE="sync-${ENVIRONMENT}" )
# Move .secrets-runtime/ adjacent to compose.yml so the relative `file:`
# secret paths in compose.yml resolve correctly.
rm -rf "$sync_dir/.secrets-runtime"
mv "$repo_root/.secrets-runtime" "$sync_dir/.secrets-runtime"
# Compose `file:` secrets are bind-mounted into /run/secrets/ with the
# host file's mode preserved on Linux. The Makefile renders 0600
# owned by ghrunner; the auth container runs as uid 1000 (node) and
# CouchDB as 5984 — neither can read 0600-ghrunner files. Relax to
# world-readable now that the files live inside the runner's
# hardened workspace (only the deploy step has access).
chmod 0644 "$sync_dir/.secrets-runtime/"*

# Cosign verify both images BEFORE pull. Per server-image-pipeline spec,
# bypass via --insecure-* MUST NOT exist in this script.
echo "==> cosign verify"
COSIGN_IDENTITY_REGEX='^https://github\.com/beranku/tricho\.app/\.github/workflows/build-server-images\.yml@refs/heads/(main|dev)$'
for img in tricho-auth tricho-couchdb; do
  cosign verify \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com \
    --certificate-identity-regexp "$COSIGN_IDENTITY_REGEX" \
    "ghcr.io/beranku/${img}:${IMAGE_TAG}" >/dev/null
  echo "    OK: ghcr.io/beranku/${img}:${IMAGE_TAG}"
done

# Capture the previous SHA for rollback before we overwrite it.
prev_sha=""
[ -f "$ROLLBACK_MARKER" ] && prev_sha="$(cat "$ROLLBACK_MARKER")"

deploy_one_pass() {
  local tag="$1"
  IMAGE_TAG="$tag" docker compose pull --quiet
  IMAGE_TAG="$tag" docker compose up -d --wait --wait-timeout 60 --remove-orphans
}

rollback() {
  if [ -z "$prev_sha" ]; then
    echo "==> rollback: no prior SHA cached; leaving stack as-is" >&2
    return 1
  fi
  echo "==> rollback: re-deploying $prev_sha"
  deploy_one_pass "$prev_sha"
  echo "==> rollback complete (stack now on $prev_sha)"
}

# Gate 1: compose up --wait
echo "==> deploying $IMAGE_TAG"
if ! deploy_one_pass "$IMAGE_TAG"; then
  echo "::error::compose up failed for $IMAGE_TAG"
  rollback || true
  exit 1
fi

# Gates 2 + 3: external smoke + data-path probe.
echo "==> running smoke gate"
if ! IMAGE_TAG="$IMAGE_TAG" APP_HOST="$APP_HOST" \
     bash "$sync_dir/smoke.sh" "$ENVIRONMENT"; then
  echo "::error::smoke gate failed for $IMAGE_TAG"
  rollback || true
  exit 1
fi

# Only after all three gates: advance the rollback marker.
echo "$IMAGE_TAG" > "$ROLLBACK_MARKER"
echo "==> deploy OK: $COMPOSE_PROJECT_NAME @ $IMAGE_TAG"
echo "    previous: ${prev_sha:-<none>}"
echo "    rollback marker updated: $ROLLBACK_MARKER"

# Cleanup: prune images older than 7 days that are not used by any container.
docker image prune -f --filter "until=168h" >/dev/null || true
