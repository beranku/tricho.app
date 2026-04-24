# CouchDB + tricho-auth stack

**Legacy entrypoint.** The unified `unified-stack-orchestration` change replaced this two-file compose flow with a single root `compose.yml` + `Makefile`. See the root `README.md` → "Running the stack".

This file and its sibling `docker-compose.yml` are kept during rollout so the old recipe still works:

```sh
cd infrastructure/couchdb
COUCHDB_PASSWORD=choose-something-strong docker compose up -d
```

but new work should use `make dev` from the repo root. This directory will be slimmed to just the application-level bits (local.ini, entrypoint shim, tricho-auth source) after the rollout settles.
