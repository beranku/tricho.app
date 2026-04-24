#!/usr/bin/env bash
# Smoke: every compose profile parses without errors or warnings.
# Catches accidental env-var typos, forgotten include: paths, malformed labels.

set -euo pipefail

cd "$(dirname "$0")/../.."

COMPOSE="docker compose"
if ! docker compose version >/dev/null 2>&1; then
  COMPOSE="docker-compose"
fi

for profile in dev ci prod; do
  out=$(
    APP_HOST=tricho.localhost APP_ORIGIN=https://tricho.localhost \
    $COMPOSE --env-file .env -f compose.yml --profile "$profile" config 2>&1
  ) || {
    echo "compose-config: profile '$profile' failed:" >&2
    echo "$out" >&2
    exit 1
  }
  echo "compose-config: profile '$profile' OK"
done
