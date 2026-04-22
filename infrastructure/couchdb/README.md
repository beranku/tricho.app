# TrichoApp CouchDB stack

One container for the database, one tiny proxy that provisions users.

## Bring it up

```sh
cd infrastructure/couchdb
COUCHDB_PASSWORD=choose-something-strong docker compose up -d
```

Wait for health:

```sh
curl -sf http://localhost:5984/_up
curl -sf http://localhost:4545/health
```

## What's inside

- `couchdb:3` with `[couch_peruser] enable = true` — each authenticated user gets a private `userdb-<hex(name)>` database that only they can read/write.
- `[chttpd] enable_cors = true` so the PWA can talk to CouchDB directly from the browser.
- `auth-proxy`: a ~100-line Node HTTP server whose only job is creating CouchDB users via admin creds on the client's behalf. Clients never see admin credentials.

## Client environment variables

The PWA expects:

- `VITE_COUCHDB_URL` — e.g. `http://localhost:5984`
- `VITE_AUTH_PROXY_URL` — e.g. `http://localhost:4545`

Both default to the ports above if unset.

## Tear down

```sh
docker compose down -v   # -v also drops the data volume
```
