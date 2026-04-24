# Traefik overlay (legacy)

**Legacy entrypoint.** The `unified-stack-orchestration` change moved Traefik's routing into the root `compose.yml` with `dev` / `ci` / `prod` profiles. See the root `README.md` → "Running the stack".

The old two-file layout (`infrastructure/couchdb/docker-compose.yml` + `infrastructure/traefik/docker-compose.yml`) still works for the prod profile during rollout:

```sh
docker network create tricho-net
cp infrastructure/traefik/.env.example infrastructure/traefik/.env
docker compose \
  -f infrastructure/couchdb/docker-compose.yml \
  -f infrastructure/traefik/docker-compose.yml \
  --env-file infrastructure/traefik/.env \
  up -d
```

but prefer `make prod-local` from the repo root. Certs for the `ci` profile live under `infrastructure/traefik/ci-certs/`. Shared middlewares stay in `dynamic/`; CI-specific TLS config in `dynamic-ci/`.
