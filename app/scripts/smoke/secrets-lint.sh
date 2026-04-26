#!/usr/bin/env bash
# Smoke: nobody committed a plain-text .env. The only permitted .env* files
# are templates (.env.example, .env.defaults) and fallbacks under secrets/.

set -euo pipefail

cd "$(dirname "$0")/../.."

bad=$(git ls-files | grep -E '(^|/)\.env(\..+)?$' | \
      grep -Ev '^\.env$|\.env\.example$|\.env\.defaults$|secrets/.*\.fallback\.env$' \
      || true)

if [ -n "$bad" ]; then
  echo "secrets-lint: unexpected plaintext .env file(s):" >&2
  echo "$bad" >&2
  echo "→ move their contents into secrets/<profile>.sops.yaml and delete." >&2
  exit 1
fi
echo "secrets-lint: OK"
