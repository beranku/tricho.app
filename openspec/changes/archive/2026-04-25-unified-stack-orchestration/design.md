## Context

TrichoApp's current runtime story has three disconnected entry points:

- **Frontend dev:** `npm run dev` on the host binds `:4321`. The Astro dev server knows nothing about CouchDB or `tricho-auth`; the developer configures `VITE_COUCHDB_URL` and `VITE_AUTH_PROXY_URL` to point at `localhost` ports and lives with a different origin than production.
- **CouchDB + auth:** `infrastructure/couchdb/docker-compose.yml` starts two containers. CouchDB needs a JWT public key pasted manually into `local.ini` on first start — there is no automation for this handoff.
- **Edge (prod only):** `infrastructure/traefik/docker-compose.yml` `include:`'s the CouchDB compose and adds Traefik + Caddy. The PWA is shipped by building `dist/` on the host and bind-mounting it read-only.

The consequence is that nothing in CI or local dev exercises the full edge path. The only integration test surface is whatever fits in Vitest with `fake-indexeddb`. Any OAuth, device-registration, JWT, or replication bug ships unexamined against the real CouchDB/Traefik behavior, and every new contributor hits the "paste the public key into local.ini" trap within the first ten minutes.

The repository also has valuable invariants that this work MUST preserve:

- Zero-knowledge: the server never sees plaintext data, DEKs, or the recovery secret.
- Single-origin routing at the edge: `/auth/*`, `/userdb-<hex>`, `/_replicator`, `/`.
- `couch_peruser` semantics: only the owner (or admin) accesses `userdb-<hex>`.

**Stakeholders:** the sole developer (Jan) for DX; future self-hosters of TrichoApp for prod; the mobile-web users for correctness of OAuth + sync paths.

## Goals / Non-Goals

**Goals:**

- One command (`make dev`) brings the entire stack up locally with working HMR, same-origin routing, and real backends.
- One command (`make e2e`) runs the same stack under a `ci` profile with a mock OIDC provider, executing Playwright against the Traefik edge.
- The prod topology differs from dev only in (a) which env file is active, (b) which SOPS-encrypted secrets file is decrypted, (c) the TLS provider.
- JWT keys flow automatically from `tricho-auth` into CouchDB. No manual paste into `local.ini`. Ever.
- Secrets at rest are encrypted with SOPS+age. Secrets at runtime are file-mounted under `/run/secrets`. Secret env vars are a bug.
- First-run onboarding from a clean clone to a running stack is under 10 minutes, with every prerequisite documented.

**Non-Goals:**

- Rewriting any application logic (auth flows, encryption, replication). This change is orchestration-only.
- Kubernetes, ECS, or any other non-Compose runtime. Compose is the deliverable; migrations to k8s are a later, separate change.
- Replacing Traefik or Caddy. Their roles are stable; we only adjust routing and profiles.
- Multi-tenant / multi-environment secret hierarchies (per-env age recipients are in scope; per-tenant is not).
- Performance or load testing. The e2e suite targets correctness, not throughput.

## Decisions

### D1 — Single root `compose.yml` with `profiles:` (not multiple `-f` overlays)

Compose `profiles:` ([docs](https://docs.docker.com/compose/how-tos/profiles/)) mark each service with the profile(s) it belongs to; `--profile <name>` opts that set in. Layered `-f` overlays would also work and are what we have today, but they cost us an `include:` chain and require the developer to remember the right flag combination. Profiles keep everything in one file and make `docker compose --profile dev config` self-documenting.

**Alternatives considered:**

- *Keep overlays:* rejected — doesn't reduce the number of entry points, and the current `include:` still requires developers to know which file to invoke.
- *Build tooling like Earthly or Dagger:* rejected — adds a heavyweight dependency for what is effectively `docker compose up`.

**Trade-off accepted:** profiles are a newer Compose feature (Docker 20.10+). Anyone on older Docker will get a clear error message. Our baseline is "Docker Desktop current", which is fine.

### D2 — Makefile over Taskfile / just

Make is everywhere, has no install step, and the target set here is small (~10 phony targets). Taskfile and just each pull in a separate binary dependency for marginal DX gains. If the Makefile grows past ~150 lines we revisit; for now, the simplest possible wrapper wins.

### D3 — Vite HMR through Traefik via the standard websocket upgrade

Vite's HMR uses a plain websocket. Traefik 3 handles websocket upgrade automatically on any router — no middleware needed. The subtle pieces:

1. `astro dev` in the container must bind `0.0.0.0` (Astro: `host: true` via `astro.config.mjs` or `--host 0.0.0.0` flag).
2. `server.hmr.clientPort` in `astro.config.mjs` (actually the underlying Vite config) must match the **public** port the browser reaches (443 for `https://tricho.localhost` with mkcert, 80 for HTTP-only).
3. `server.hmr.host` or Vite's inferred host must match the public hostname.
4. The PWA dev container must add `tricho.localhost` (and `tricho.test`) to its `allowedHosts` list.

We expose these through env vars (`PUBLIC_PWA_HOST`, `PUBLIC_PWA_PORT`) and let `astro.config.mjs` read them. The `dev` profile sets them to `tricho.localhost` / `443` (or `80`); prod never runs astro-dev so prod doesn't care.

**Alternative considered:** run the dev server outside the compose stack and route `/` on Traefik to `host.docker.internal:4321`. Works, but introduces a split brain (backend in docker, frontend on host), which is exactly what we're trying to eliminate.

### D4 — Secrets: SOPS + age at rest, Docker Compose `secrets:` at runtime

**Repo layout:**

```
.sops.yaml                         # creation rules: age recipients per file glob
secrets/
  dev.sops.yaml                    # committed, SOPS-encrypted
  ci.sops.yaml                     # committed, encrypted only to the CI age key + developers
  prod.sops.yaml                   # committed, encrypted only to prod age key + admins
  README.md                        # rotation + onboarding procedures
.secrets-runtime/                  # gitignored; Make creates these files per-run
  couchdb_password
  google_client_secret
  jwt_private.pem
  ...
```

`.sops.yaml` uses file-glob `creation_rules` so `sops --encrypt` finds the right recipients automatically. Example:

```yaml
creation_rules:
  - path_regex: secrets/dev\.sops\.yaml$
    key_groups:
      - age: [<dev1-pubkey>, <dev2-pubkey>]
  - path_regex: secrets/ci\.sops\.yaml$
    key_groups:
      - age: [<ci-pubkey>, <dev1-pubkey>]
  - path_regex: secrets/prod\.sops\.yaml$
    key_groups:
      - age: [<prod-pubkey>]
```

Each `secrets/<profile>.sops.yaml` is a flat key/value YAML file (so SOPS stores field-level ciphertext, keeping diffs readable):

```yaml
couchdb_password: ENC[AES256_GCM,data:...]
google_client_secret: ENC[AES256_GCM,data:...]
jwt_private_pem: ENC[AES256_GCM,data:...,multiline base64]
cookie_secret: ENC[AES256_GCM,data:...]
```

The `Makefile`'s `_render-secrets` phony target runs `sops --decrypt secrets/$PROFILE.sops.yaml` and writes each key to a file under `.secrets-runtime/` with mode `0600`. Compose then consumes them:

```yaml
secrets:
  couchdb_password:
    file: .secrets-runtime/couchdb_password
  jwt_private_pem:
    file: .secrets-runtime/jwt_private.pem
  google_client_secret:
    file: .secrets-runtime/google_client_secret

services:
  tricho-auth:
    secrets:
      - couchdb_password
      - jwt_private_pem
      - google_client_secret
    environment:
      COUCHDB_ADMIN_PASSWORD_FILE: /run/secrets/couchdb_password
      TRICHO_AUTH_JWT_PRIVATE_KEY_PATH: /run/secrets/jwt_private_pem
      GOOGLE_CLIENT_SECRET_FILE: /run/secrets/google_client_secret
```

`tricho-auth/server.mjs` grows the pattern: `const val = process.env.FOO ?? (process.env.FOO_FILE && fs.readFileSync(process.env.FOO_FILE, 'utf8').trim())`.

**Why not just env vars?** Env vars leak into `docker inspect`, `ps auxe`, child processes, and any library that prints `process.env` on crash. File mounts are the least-bad delivery mechanism for long-lived material.

**Why the two-file pattern (encrypted committed + decrypted gitignored)?** It keeps the source of truth in git, lets reviewers see *which* secrets exist and who can decrypt them (via `.sops.yaml`), and keeps Compose's `secrets: { file: ... }` happy without extra adapters. The decrypted files live under `.secrets-runtime/` and are wiped by `make down`.

**Alternatives considered:**

- *Dotenv plus `env_file:`* — what we have. Bad threat model, as above.
- *Pass SOPS output on stdin to `docker compose --env-file=/dev/stdin`* — clever but fragile; breaks on any re-invocation, and doesn't solve the "env vars are visible in `docker inspect`" problem.
- *External secret manager (Doppler / Vault):* adds a runtime dependency and an auth flow for every boot. Overkill for a one-dev project with a handful of secrets.

### D5 — CI delivers age key via `SOPS_AGE_KEY` env secret

SOPS natively reads `SOPS_AGE_KEY` env var as an age private key when `~/.config/sops/age/keys.txt` is absent. GitHub Actions stores the CI age private key in a repo-level secret. The `e2e.yml` workflow sets it only on the decrypt step, not globally:

```yaml
- name: Decrypt CI secrets
  env:
    SOPS_AGE_KEY: ${{ secrets.SOPS_AGE_KEY }}
  run: make _render-secrets PROFILE=ci
```

After that step, the env var goes out of scope and the decrypted files are the only authoritative source. The same age key material is never written to disk unencrypted.

### D6 — JWT key handoff via a shared named volume + CouchDB entrypoint shim

A named Docker volume `tricho-jwt-shared` is mounted read-write at `/shared/jwt` in `tricho-auth` and read-only at the same path in CouchDB. `tricho-auth` writes `jwt-public.pem` (atomic write-to-temp-then-rename) on every start.

CouchDB's image is left stock; we override its entrypoint with a tiny shim:

```sh
#!/bin/sh
# infrastructure/couchdb/entrypoint.sh
set -eu
pub=/shared/jwt/jwt-public.pem
for i in $(seq 1 30); do
  [ -f "$pub" ] && break
  sleep 1
done
[ -f "$pub" ] || { echo "JWT pubkey missing"; exit 1; }
kid="${TRICHO_AUTH_JWT_KID:-tricho-$(date -u +%Y)}"
cat > /opt/couchdb/etc/local.d/jwt.ini <<EOF
[jwt_keys]
rsa:${kid} = $(awk 'NR>1 && !/END/{printf "%s", $0} END{print ""}' "$pub")
EOF
exec /docker-entrypoint.sh "$@"
```

(The one-line key extraction is the format CouchDB expects: PEM body with header/footer stripped and newlines removed, as shown in the existing `local.ini` comment.)

This shim runs as the stock image's entrypoint would, and then `exec`s the real entrypoint. It fails CouchDB's boot if the key isn't there, so the `depends_on: service_healthy` gating on `tricho-auth` guarantees correctness.

**Alternative considered:** generate the key in a one-shot init container. Rejected because it splits ownership of the keypair across two services and complicates dev-to-prod symmetry.

### D7 — Mock OIDC provider: a small custom Node container, not Dex

Dex is full-featured but heavy and slow to boot (~3 s). The OAuth surface we exercise is narrow: discovery, authorize, token, userinfo, jwks. A ~150-line Node service (re-using `jose` for signing) boots in <100 ms and lets tests control `sub` / `email` / `email_verified` by POSTing to a `/mock/identity` control endpoint. Deterministic, scriptable, profile-gated.

**Alternative considered:** Keycloak — rejected, boot time measured in tens of seconds and far more configuration surface than we need.

### D8 — PWA container: single Dockerfile, two targets

```
infrastructure/pwa/Dockerfile
  FROM node:22-alpine AS dev
    WORKDIR /app
    COPY package.json package-lock.json ./
    RUN npm ci
    COPY . .
    CMD ["npx", "astro", "dev", "--host", "0.0.0.0", "--port", "4321"]

  FROM node:22-alpine AS builder
    WORKDIR /app
    COPY package.json package-lock.json ./
    RUN npm ci
    COPY . .
    RUN npm run build

  FROM caddy:2-alpine AS prod
    COPY --from=builder /app/dist /srv
    COPY infrastructure/pwa/Caddyfile /etc/caddy/Caddyfile
```

`dev` and `prod` profiles reference different `target:`s. Avoids the "build-on-host, mount into container" dance. The existing `infrastructure/traefik/Caddyfile` moves under `infrastructure/pwa/`.

### D9 — Hostnames

- Dev: `tricho.localhost` (resolves to 127.0.0.1 on macOS/Linux without /etc/hosts editing, per RFC 6761).
- CI: `tricho.test` (reserved TLD, guaranteed not to resolve upstream). Hosts file entry baked into the GitHub Actions job (`echo 127.0.0.1 tricho.test | sudo tee -a /etc/hosts`).
- Prod: whatever `APP_HOST` says, via real DNS.

### D10 — No existing specs outside `traefik-edge` are affected

`oauth-identity`, `jwt-session`, `payload-encryption`, etc. keep their semantics. The change is additive at the orchestration layer; application-level contracts stay frozen.

## Risks / Trade-offs

- **[Compose profiles let you accidentally mix dev + prod services]** → Mitigated by D1's "profiles must not leak" requirement and a `make _guard-profile` step that inspects the resolved compose config and greps for mock-oidc before allowing prod boot.
- **[SOPS+age adoption increases onboarding friction]** → Documented in `secrets/README.md` with copy-paste commands; the `make` target that needs it fails with a link to that doc. First-time pain traded for long-term safety.
- **[age private key loss locks everyone out]** → Multiple recipients per file (every active dev + a "break-glass" key stored in a password manager). Rotation procedure tested on a throwaway branch before first rollout.
- **[Vite HMR through Traefik is a known finicky setup]** → Mitigated by keeping the Traefik rule minimal and using the standard Vite `server.hmr.clientPort` knob. Documented as a first-class test in the e2e suite so any regression in this plumbing gets caught.
- **[Mock OIDC has less fidelity than real Google/Apple]** → Mitigated by keeping the mock strictly for CI. Manual smoke of real providers remains a documented dev procedure.
- **[CouchDB entrypoint override ties us to CouchDB's internal entrypoint path]** → Low risk — the base image's entrypoint has been `/docker-entrypoint.sh` for years, but the shim is versioned and pinned in the CouchDB tag.
- **[Threat-model delta]** Before: long-lived secrets in `.env` (readable by any process on the host), JWT private key at `/tmp/tricho-auth-keys` unencrypted, CouchDB admin password in shell history via `COUCHDB_PASSWORD=… docker compose up`. After: secrets encrypted at rest, delivered as file mounts readable only by the service user, never in env var listings. An attacker with repo read-only access gains zero — they'd need an age private key, which lives on individual laptops or in GitHub secrets. The only residual risk is a compromised dev laptop, which is the same blast radius as before.

## Migration Plan

1. **Land the scaffolding (no-op for secrets).** Add root `compose.yml`, `Makefile`, and the PWA Dockerfile behind an opt-in path. Existing `infrastructure/couchdb` and `infrastructure/traefik` compose files stay functional. Verify `make dev` equivalence to the old workflow.
2. **Flip JWT key bootstrap.** Add the CouchDB entrypoint shim + shared volume. Drop the `local.ini` instruction block. Rotate the real CouchDB JWT config on the prod host in the same deploy.
3. **Introduce SOPS.** Create `.sops.yaml`, initialize `secrets/dev.sops.yaml` from the current dev defaults, populate `ci.sops.yaml` with fresh secrets for the mock provider, populate `prod.sops.yaml` with the real prod values (do not commit the unencrypted intermediate). Wire `Make _render-secrets`. Update CI to set `SOPS_AGE_KEY`.
4. **Add the mock OIDC + e2e suite.** Ship Playwright config and a minimal smoke test. Enable `.github/workflows/e2e.yml`. Gate merges on it once green on main.
5. **Delete the legacy entry points.** Remove `infrastructure/couchdb/README.md`'s "docker compose up" block and the Traefik overlay-specific README references. Redirect them to the root `README.md`.
6. **Rotate all secrets that existed before step 3.** They were in plaintext — treat them as compromised once committed elsewhere. Rotate CouchDB admin password, regenerate OAuth client secrets if they've ever been committed.

**Rollback:** up to step 2, rolling back is a `git revert`. After step 3, rollback means re-generating plaintext `.env` files from SOPS (keep `make _render-secrets` callable on the revert branch). After step 6, rollback is materially complex — the compromised secrets must stay rotated; only the tooling reverts.

## Open Questions

- *Should `dev` use HTTP or mkcert-signed HTTPS?* Leaning HTTP for the simplest onboarding (localhost service workers require HTTPS in some browsers — but `http://tricho.localhost/` is treated as a secure context per WICG because of the `.localhost` TLD, which fixes the SW concern). We ship HTTP as default with a `MKCERT=1` flag to opt into HTTPS for testing prod-like cookie behavior.
- *Where should `.secrets-runtime/` live?* Repo root is simplest; `/run/tricho-secrets` (tmpfs) is more secure. Default to repo-root + `chmod 700` on the directory; offer a macOS/Linux-specific tmpfs flag in a later iteration.
- *Should we ship a `make doctor` target?* It would check Docker version, age key presence, SOPS install, `tricho.localhost` resolution, and mkcert-root install. Valuable enough to include in the first pass, or save for a follow-up? Propose to include a minimal version.
- *How long is the "overlap window" for JWT key rotation?* CouchDB supports multiple `jwt_keys` entries simultaneously, so an overlap is trivial; decide on 24h (spec says "either zero or explicitly configured") and implement via an optional second `TRICHO_AUTH_JWT_OLD_PUBLIC_KEY_PATH` env var that the entrypoint shim also splices in.
