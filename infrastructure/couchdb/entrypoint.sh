#!/bin/sh
# CouchDB entrypoint shim for TrichoApp.
#
# Waits for tricho-auth to publish the current JWT public key to the shared
# volume, splices it into [jwt_keys] in /opt/couchdb/etc/local.d/jwt.ini, and
# then exec's the upstream entrypoint. If an "old" key is also present
# (mounted separately during rotation), emits a second jwt_keys entry so
# outstanding tokens remain valid during the overlap window.

set -eu

# CouchDB's stock image reads `COUCHDB_PASSWORD` from the literal env var only.
# We want it from a file-mounted Docker secret, so shim it: if the _FILE path
# is readable and the literal is empty, hydrate the env before the stock
# entrypoint runs. Password ends up baked into local.d/docker.ini (the same
# path the image would write it to from the env var), so nothing sensitive
# leaks into `docker inspect` longer than startup.
if [ -z "${COUCHDB_PASSWORD:-}" ] && [ -n "${COUCHDB_PASSWORD_FILE:-}" ] && [ -r "$COUCHDB_PASSWORD_FILE" ]; then
  COUCHDB_PASSWORD="$(cat "$COUCHDB_PASSWORD_FILE")"
  export COUCHDB_PASSWORD
fi

pub="${TRICHO_JWT_PUBLIC_KEY_PATH:-/shared/jwt/jwt-public.pem}"
pub_old="${TRICHO_JWT_OLD_PUBLIC_KEY_PATH:-/shared/jwt/jwt-public-old.pem}"
jwt_ini="/opt/couchdb/etc/local.d/jwt.ini"
kid="${TRICHO_AUTH_JWT_KID:-tricho-$(date -u +%Y)}"
kid_old="${TRICHO_AUTH_JWT_OLD_KID:-tricho-old}"
wait_max="${TRICHO_JWT_WAIT_MAX_SEC:-30}"

echo "[couchdb-entrypoint] waiting up to ${wait_max}s for ${pub}"
waited=0
until [ -f "$pub" ]; do
  if [ "$waited" -ge "$wait_max" ]; then
    echo "[couchdb-entrypoint] JWT public key missing at ${pub} — aborting" >&2
    exit 1
  fi
  sleep 1
  waited=$((waited + 1))
done

pem_body() {
  # Strip PEM header/footer and concatenate all interior lines.
  awk '/BEGIN PUBLIC KEY/{flag=1; next} /END PUBLIC KEY/{flag=0} flag' "$1" | tr -d '\n'
}

{
  echo "[jwt_keys]"
  echo "rsa:${kid} = $(pem_body "$pub")"
  if [ -f "$pub_old" ]; then
    echo "rsa:${kid_old} = $(pem_body "$pub_old")"
    echo "[couchdb-entrypoint] included overlap key ${kid_old}" >&2
  fi
} > "$jwt_ini"
chmod 644 "$jwt_ini"
echo "[couchdb-entrypoint] wrote ${jwt_ini} with kid=${kid}"
echo "[couchdb-entrypoint] handing off to /docker-entrypoint.sh $*"

exec /docker-entrypoint.sh "$@"
