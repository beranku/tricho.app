# Traefik configuration

This directory holds Traefik's dynamic configuration and TLS material
for the local stack. It is consumed by the root
[`compose.yml`](../../compose.yml) under the `dev` and `ci` profiles —
invoke via `make dev` or `make ci` from the repo root.

| Path | Purpose |
|---|---|
| `dynamic/` | Shared middlewares (security headers, redirects, rate limits) mounted into Traefik in every profile. |
| `dynamic-ci/` | CI-specific TLS config; only mounted under the `ci` profile. |
| `ci-certs/` | Self-signed certificates for the `ci` profile (`tricho.test` and friends). |
| `docker-compose.yml` | Legacy two-file compose flow, superseded by the root `compose.yml`. Kept only as a fallback during recovery from broken root-stack setups. |

Spec: `openspec/specs/traefik-edge/`. Stack profiles:
`openspec/specs/stack-orchestration/`.
