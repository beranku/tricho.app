#!/usr/bin/env bash
# Umbrella: run every smoke check. Called by `npm run test:smoke`.

set -euo pipefail

cd "$(dirname "$0")/../.."

scripts=(
  scripts/smoke/secrets-lint.sh
  scripts/smoke/compose-config.sh
  scripts/smoke/healthcheck-declared.sh
)

failed=0
for s in "${scripts[@]}"; do
  echo "── $s"
  if ! bash "$s"; then
    failed=1
  fi
done

if [ $failed -ne 0 ]; then
  echo "smoke: one or more checks failed" >&2
  exit 1
fi
echo "smoke: all checks green"
