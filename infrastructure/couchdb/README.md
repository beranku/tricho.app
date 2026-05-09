# CouchDB + tricho-auth

This directory holds the application-level pieces of the server stack.
They are built and run by the root [`compose.yml`](../../compose.yml)
under the `dev` / `ci` / `prod` profiles — invoke via `make dev` /
`make ci` / `make prod-local` from the repo root.

| Path | Purpose |
|---|---|
| `Dockerfile` | CouchDB 3 image with the project's entrypoint shim. |
| `entrypoint.sh` | Adds JWT public-key bootstrap and `couch_peruser` setup before launching CouchDB. |
| `local.ini` | CouchDB configuration mounted into the container. |
| `tricho-auth/` | Node service: OIDC (Google/Apple) → RS256 JWT + rotated refresh tokens, plus the CouchDB JWT proxy. See [`tricho-auth/BILLING.md`](tricho-auth/BILLING.md) for paid-plans deploy & reconciliation. |
| `docker-compose.yml` | Legacy two-file compose flow, superseded by the root `compose.yml`. Kept only as a fallback during recovery from broken root-stack setups. |

Specs that govern this directory:

- `openspec/specs/jwt-session/`
- `openspec/specs/jwt-key-bootstrap/`
- `openspec/specs/oauth-identity/`
- `openspec/specs/billing-plans/`
- `openspec/specs/stripe-recurring-billing/`
- `openspec/specs/bank-transfer-billing/`
- `openspec/specs/stack-orchestration/`
