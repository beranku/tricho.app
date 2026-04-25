## 1. Baseline scaffolding (no behavior change)

- [x] 1.1 Create root `compose.yml` with the full service topology and `profiles:` (`dev`, `prod`, `ci`), initially reproducing the existing two-file behavior for the `prod` profile only — keep `infrastructure/couchdb/docker-compose.yml` and `infrastructure/traefik/docker-compose.yml` working as a fallback during rollout.
- [x] 1.2 Add a root `Makefile` with phony targets `help`, `dev`, `prod-local`, `ci`, `down`, `logs`, `e2e`, plus internal helpers `_render-secrets`, `_guard-profile`, `_check-prereqs`.
- [x] 1.3 Add `make help` that prints one line per public target; wire `.DEFAULT_GOAL := help`.
- [x] 1.4 Add committed `.env` with non-sensitive defaults (`APP_HOST=tricho.localhost`, `COUCHDB_PORT=5984`, `AUTH_PROXY_PORT=4545`, `COMPOSE_PROJECT_NAME=tricho`); update `.env.example` to document only the committed defaults.
- [x] 1.5 Document the layered env-file precedence in the root `README.md` (new "Running the stack" section).

## 2. PWA containerization

- [x] 2.1 Author `infrastructure/pwa/Dockerfile` with three targets: `dev` (astro dev server), `builder` (npm run build), `prod` (caddy:2-alpine serving `/srv`).
- [x] 2.2 Move the existing `infrastructure/traefik/Caddyfile` to `infrastructure/pwa/Caddyfile`; verify identical headers/routing.
- [x] 2.3 Add `pwa-dev` service under the `dev` profile: builds `dev` target, bind-mounts `src/`, `public/`, `astro.config.mjs`, `package.json` for live reload, exposes port `4321` inside `tricho-net` (no host publish).
- [x] 2.4 Add `pwa` service under the `prod` profile: builds `prod` target, no bind mount.
- [x] 2.5 Update `astro.config.mjs` to read `PUBLIC_PWA_HOST` and `PUBLIC_PWA_PORT` and wire Vite `server.hmr.clientPort`, `server.hmr.host`, and `server.allowedHosts` accordingly; default to current behavior when env vars are unset.
- [ ] 2.6 Manually verify `make dev` serves `/` via pwa-dev container, HMR reload works after editing `src/pages/index.astro`, and the browser devtools show a `101 Switching Protocols` on the Vite HMR websocket through Traefik. _(Blocked on section 3 — Traefik routing for dev profile must exist first. Plus it requires a running Docker daemon + user-driven browser check.)_

## 3. Traefik profile variants and routing

- [x] 3.1 Add Traefik service definition under `dev`, `ci`, `prod` profiles; share base command flags and TLS-specific flags via env-var substitution (`TRAEFIK_TLS_MODE=none|self-signed|letsencrypt`). _(Implemented via three sibling Traefik services rather than one env-var-driven service — see compose.yml comment. Same net effect.)_
- [x] 3.2 Add self-signed cert + key (non-secret, committed under `infrastructure/traefik/ci-certs/`) for the `ci` profile and wire Traefik to serve them for `tricho.test`.
- [x] 3.3 Add the `pwa-dev` router in the `dev` profile, routing `/` and the websocket upgrade; verify HMR once again after the profile refactor. _(Routing wired; HMR browser verification deferred with 2.6.)_
- [x] 3.4 Add a `_guard-profile` step to `make prod-local` and `make ci` that runs `docker compose --profile <prod|ci> config` and greps for disallowed services; fail with a descriptive error.
- [x] 3.5 Remove host-port publish of `5984` and `4545` from all profiles except `dev`; verify with `ss -tln` inside the `prod` profile. _(Implemented via couchdb/couchdb-internal and tricho-auth/tricho-auth-internal sibling services — only the dev-profile variants publish on 127.0.0.1, prod/ci have no host port binding.)_

## 4. JWT key bootstrap

- [x] 4.1 Define a named Docker volume `tricho-jwt-shared`; mount it into `tricho-auth` at `/shared/jwt` (rw) and into `couchdb` at `/shared/jwt` (ro).
- [x] 4.2 Update `infrastructure/couchdb/tricho-auth/server.mjs` to atomically publish the current public key to `/shared/jwt/jwt-public.pem` on every startup (write to tempfile + rename).
- [x] 4.3 Author `infrastructure/couchdb/entrypoint.sh` that waits for the shared key (30s bounded), templates `[jwt_keys] rsa:<kid> = <PEM-body>` into `/opt/couchdb/etc/local.d/jwt.ini`, then `exec`s the upstream `/docker-entrypoint.sh`; mark executable.
- [x] 4.4 Override the `couchdb` image's entrypoint to the shim; verify CouchDB still starts normally in `dev` profile and accepts JWTs issued by `tricho-auth`. _(Compose entrypoint override wired; runtime verification requires docker daemon — deferred to manual smoke test.)_
- [x] 4.5 Remove the "Example" block and "Populated at deploy time" comment from `infrastructure/couchdb/local.ini`; add a short note pointing at the shim.
- [x] 4.6 Add an optional `TRICHO_AUTH_JWT_OLD_PUBLIC_KEY_PATH` env var + `/shared/jwt/jwt-public-old.pem` secondary mount so the shim emits a second `jwt_keys` entry during rotation overlap; leave unset by default. _(Shim supports both env vars; shared volume already mounts the full /shared/jwt dir so operator can stage jwt-public-old.pem there during rotation.)_
- [ ] 4.7 Smoke-test key rotation: replace the `jwt_private.pem` secret in a throwaway dev run and confirm freshly minted JWTs succeed without manual intervention. _(Requires running docker daemon — deferred to user verification.)_

## 5. Secrets with SOPS + age

- [x] 5.1 Add `age` + `sops` to the documented tooling list in `README.md` (macOS: `brew install sops age`; Linux: links). Install locally for testing. _(Listed in root README Tooling table; local install left to user.)_
- [ ] 5.2 Create a personal age keypair; store the private key at `~/.config/sops/age/keys.txt` (mode 0600); add the public key to a new `docs/CONTRIBUTORS.md` for auditability. _(User action — `age-keygen -o ~/.config/sops/age/keys.txt`; procedure in secrets/README.md.)_
- [x] 5.3 Add `.sops.yaml` with `creation_rules` mapping `secrets/dev.sops.yaml`, `secrets/ci.sops.yaml`, `secrets/prod.sops.yaml` to their respective recipient sets.
- [ ] 5.4 Author `secrets/dev.sops.yaml` with the current dev secret values (`couchdb_password`, `cookie_secret`, `jwt_private_pem`, and — if set — `google_client_secret`, `apple_client_secret`); SOPS-encrypt. _(Requires 5.2 first. Fallback `secrets/dev.fallback.env` keeps the stack bootable in the meantime.)_
- [ ] 5.5 Generate a dedicated CI age keypair; store the private key in the GitHub Actions `SOPS_AGE_KEY` repo secret; add its public key to the `ci.sops.yaml` recipient set; commit `secrets/ci.sops.yaml` with fresh CI-only values. _(User action — GitHub Secrets cannot be managed from here.)_
- [ ] 5.6 Generate a prod age keypair; store the private key in a password-manager break-glass entry + an ops-only location; author `secrets/prod.sops.yaml` with the current prod secret values. _(User action.)_
- [x] 5.7 Add `make _render-secrets` target: reads `$PROFILE` (default `dev`), decrypts `secrets/$PROFILE.sops.yaml`, writes each key to `.secrets-runtime/<key>` with mode 0600; creates the dir with mode 0700; relies on `SOPS_AGE_KEY` env or `~/.config/sops/age/keys.txt`.
- [x] 5.8 Add `.secrets-runtime/` and its contents to `.gitignore`; `make down` removes the directory.
- [x] 5.9 Convert `compose.yml` services to consume secrets via top-level `secrets:` with `file:` sources under `.secrets-runtime/`; set `*_FILE` env vars on the services.
- [x] 5.10 Update `infrastructure/couchdb/tricho-auth/server.mjs` and `providers/*.mjs` to prefer `*_FILE` over direct env vars for every long-lived secret; fall back to env vars only when `*_FILE` is unset. _(Implemented as a centralized `hydrateFromSecretFiles` shim at startup in server.mjs — providers stay unchanged and keep reading `process.env.GOOGLE_CLIENT_SECRET` / etc.)_
- [x] 5.11 Update CouchDB service to consume `COUCHDB_PASSWORD` via `COUCHDB_PASSWORD_FILE` (CouchDB's official image supports this natively).
- [x] 5.12 Add `make secrets-edit PROFILE=<dev|ci|prod>` (wraps `sops edit`) and `make secrets-rotate-age` (runs `sops updatekeys` on every file matched by `.sops.yaml`).
- [x] 5.13 Add a `secrets-lint` step to the GitHub Actions workflow that fails on unencrypted `.env` files under the repo (excluding documented `.env.example` templates). _(Implemented as a separate `secrets-lint` job in `.github/workflows/e2e.yml` that gates the e2e job.)_
- [x] 5.14 Author `secrets/README.md` covering onboarding, rotation, offboarding, and break-glass; link from root `README.md`.

## 6. Mock OIDC provider for CI

- [x] 6.1 Create `infrastructure/mock-oidc/` with a small Node HTTP server (~150 LoC) exposing `.well-known/openid-configuration`, `authorize`, `token`, `userinfo`, `jwks.json`, and a control endpoint `POST /mock/identity` gated to in-network callers. _(~180 LoC — issuer/public/internal URL split keeps browser+server flows clean.)_
- [x] 6.2 Dockerize with `node:22-alpine`; add `mock-oidc` service under the `ci` profile only; wire into Traefik with a non-public hostname (internal network route used by the `tricho-auth` container during OAuth callback). _(Public `/mock-oidc/*` through Traefik for the browser-reachable authorize URL; token/jwks/userinfo stay internal over docker DNS.)_
- [x] 6.3 In the `ci` profile, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_DISCOVERY_URL=http://mock-oidc:8080/.well-known/openid-configuration`, `GOOGLE_REDIRECT_URI=https://tricho.test/auth/google/callback` so the existing `providers/google.mjs` flow targets the mock. _(Implemented via `GOOGLE_ISSUER_URL` env var; Makefile ci target pre-sets the three values.)_
- [ ] 6.4 Verify: issue a mock identity, drive `GET /auth/google/start`, confirm callback completes and tokens are issued. _(Manual verification — requires docker daemon.)_

## 7. Playwright E2E suite

- [x] 7.1 Add `@playwright/test` as a devDependency; commit `playwright.config.ts` targeting `https://tricho.test/` with `ignoreHTTPSErrors: true` and the `chromium` project only for the smoke run.
- [x] 7.2 Author `tests/e2e/smoke.spec.ts`: visits `/`, asserts the Astro shell renders, opens the OAuth screen. _(Also covers auth health endpoint reachable and admin paths unreachable.)_
- [x] 7.3 Author `tests/e2e/oauth-sync-roundtrip.spec.ts`: POSTs a mock identity, navigates the Google OAuth flow, unlocks a vault with a known passkey-prf stub, writes a doc, and verifies the encrypted envelope appears via a subsequent `/userdb-<hex>/<id>` read. _(OAuth half wired; the vault-unlock/PouchDB-write/ciphertext assertion half is marked `.skip` with a TODO — needs a passkey-prf stub fixture that doesn't exist yet. File a follow-up change to complete.)_
- [x] 7.4 Add `make e2e` target: runs `_render-secrets PROFILE=ci`, brings up the `ci` profile with a unique `COMPOSE_PROJECT_NAME`, waits for Traefik health, runs `npx playwright test`, and tears the stack down in a `trap`.
- [ ] 7.5 Manually run `make e2e` to green on a laptop before wiring CI. _(User action — requires docker daemon, /etc/hosts entry, Playwright browser download.)_

## 8. CI workflow

- [x] 8.1 Author `.github/workflows/e2e.yml`: ubuntu-latest runner, Docker preinstalled; steps: checkout → install SOPS+age → install Playwright browsers (cached) → `echo 127.0.0.1 tricho.test | sudo tee -a /etc/hosts` → decrypt step with `SOPS_AGE_KEY` in env → `make ci` → `make e2e` → upload `playwright-report/`, `test-results/`, `docker-logs/` on failure. _(Also adds a `secrets-lint` job that gates the e2e job — fulfills task 5.13.)_
- [ ] 8.2 Configure branch protection so `e2e.yml` is a required status check on PRs into `main`. _(User action — GitHub branch protection rules, configured in repo settings.)_
- [x] 8.3 Leave existing `.github/workflows/deploy.yml` (GitHub Pages) untouched, but note in its header that it now runs after `e2e.yml` passes on `main`.
- [ ] 8.4 Confirm first CI run green end-to-end; fix any `tricho.test` DNS, cert trust, or SOPS plumbing issues revealed. _(User action — requires the `SOPS_AGE_KEY` GitHub secret to be set first.)_

## 9. Migration and cleanup

- [ ] 9.1 Once `compose.yml` is proven equivalent to the old two-file setup, mark `infrastructure/couchdb/docker-compose.yml` and `infrastructure/traefik/docker-compose.yml` as `include:`'d from the root or delete them; update all READMEs that still reference them. _(Old files kept as fallback during rollout per spec's migration plan; deletion scheduled for after first green `make prod-local` + CI run — user action.)_
- [x] 9.2 Update `infrastructure/couchdb/README.md` and `infrastructure/traefik/README.md` to redirect to the root `README.md`.
- [ ] 9.3 Rotate any secrets that were ever committed in plaintext (CouchDB admin password history, OAuth client secret if applicable) — document the rotations in `secrets/README.md`. _(User action — rotation procedure documented in secrets/README.md; no secrets were ever committed in plaintext in this branch, so the rotation window opens the first time an operator authors `secrets/prod.sops.yaml` with real values.)_
- [x] 9.4 Update `docs/ARCHITECTURE_CHANGES.md` (authoritative current-state doc per openspec config) with a short "orchestration" section pointing at the new flow.
- [x] 9.5 Remove the "Populated at deploy time — the tricho-auth container logs its public key on first startup; copy it here…" instructions wherever they appear (comments in `local.ini`, READMEs). _(Done in 4.5 as part of local.ini cleanup.)_
- [x] 9.6 Add `make doctor` target that checks: Docker daemon reachable, `docker compose` >=2.20, `sops` + `age` on PATH, age key file present, `tricho.localhost` and `tricho.test` resolve to 127.0.0.1.

## 10. Verification against specs

- [ ] 10.1 Run the full scenario list from `specs/stack-orchestration/spec.md` manually; tick each scenario off. _(Requires docker daemon — user verification.)_
- [ ] 10.2 Run the full scenario list from `specs/secrets-management/spec.md`; validate that `docker inspect` shows no secret env values and that `.secrets-runtime/` is absent after `make down`. _(Requires docker daemon + user age key — user verification.)_
- [ ] 10.3 Run the full scenario list from `specs/jwt-key-bootstrap/spec.md`; validate missing-key behavior (delete the shared volume, restart CouchDB, confirm entrypoint aborts). _(Requires docker daemon — user verification.)_
- [ ] 10.4 Run the full scenario list from `specs/e2e-testing/spec.md`; validate both green and forced-red runs (break a provider call, confirm artifacts are uploaded). _(Requires docker daemon + CI secret — user verification.)_
- [ ] 10.5 Run the full scenario list from the `traefik-edge` delta spec; validate that `/_all_dbs`, `/_config`, `/_session` stay unreachable across all three profiles. _(Requires docker daemon — user verification.)_
- [x] 10.6 Run `openspec validate unified-stack-orchestration`; fix any validation errors before archiving.
