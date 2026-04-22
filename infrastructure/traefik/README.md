# Traefik overlay for TrichoApp

Adds TLS, single-origin routing, and PWA static hosting in front of the CouchDB stack.

## Routes

| Path | Service |
|---|---|
| `/auth/*` | `tricho-auth` (admin proxy + OAuth, future stages) |
| `/userdb-*`, `/_replicator/*` | CouchDB (JWT auth only) |
| everything else | PWA static files (Caddy) |

`/_session`, `/_config`, `/_all_dbs` and every other CouchDB admin surface are **deliberately not routed** — only the three public paths above reach CouchDB.

## Bring it up

```sh
# First-time: create the shared docker network
docker network create tricho-net

# Export required env vars
cp infrastructure/traefik/.env.example infrastructure/traefik/.env
# edit APP_HOST, TRAEFIK_ACME_EMAIL, COUCHDB_PASSWORD

# Build the PWA bundle (Caddy serves /srv from this dir)
npm run build

# Launch
docker compose \
  -f infrastructure/couchdb/docker-compose.yml \
  -f infrastructure/traefik/docker-compose.yml \
  --env-file infrastructure/traefik/.env \
  up -d
```

## Dev mode without Traefik

Just run the CouchDB compose alone — ports 5984 (CouchDB) and 4545 (auth-proxy) are published directly:

```sh
docker compose -f infrastructure/couchdb/docker-compose.yml up -d
```

## Inspect the live config

```sh
docker compose \
  -f infrastructure/couchdb/docker-compose.yml \
  -f infrastructure/traefik/docker-compose.yml \
  --env-file infrastructure/traefik/.env \
  config
```

## Smoke test

After `up -d`:

```sh
curl -skI https://${APP_HOST}/_up                       # CouchDB reachable
curl -skI https://${APP_HOST}/auth/health               # auth-proxy reachable
curl -sk  https://${APP_HOST}/                          # PWA index.html
curl -sk  https://${APP_HOST}/_session | grep -v ok     # should be 404, not routed
```
