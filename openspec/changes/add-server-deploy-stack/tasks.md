## 1. Specs and runbook scaffolding (no runtime impact)

- [x] 1.1 Add per-server age recipient block to `.sops.yaml` (template comment for `o3.tricho.app`; actual recipient added in 4.1)
- [x] 1.2 Add the two new file globs to `.sops.yaml` creation rules: `secrets/sync-prod.sops.yaml`, `secrets/sync-dev.sops.yaml`
- [x] 1.3 Create `docs/server-deploy.md` with sections: Prerequisites (DNS, SSH, B2/rsync.net account); First-run host bootstrap; Per-server age key generation; Edge bootstrap; Dev deploy walkthrough; Prod deploy walkthrough; Rollback; Secrets rotation; Adding a second host; Troubleshooting (Traefik logs, ACME issues, runner stuck, CouchDB stuck); Backup sensitivity disclaimer (per `server-backup-restore` spec)
- [x] 1.4 Update `docs/build-and-deploy.md`: add a "Server-side stack" section pointing at `docs/server-deploy.md` (today the doc is frontend-only)
- [x] 1.5 Update `docs/secrets.md`: document the `sync-prod` / `sync-dev` profiles, the per-server age keypair pattern, and the `production` GitHub Environment scoping for `SOPS_AGE_KEY`
- [x] 1.6 Update `CLAUDE.md`: add `docs/server-deploy.md` to the Pointers section

## 2. Makefile and tooling

- [x] 2.1 Extend `Makefile` `_render-secrets` target to accept a `PROFILE=` argument; default to `dev` when unset; update other targets that call `_render-secrets` to pass their existing profile explicitly so behavior is unchanged
- [x] 2.2 Add a `make help` line documenting `_render-secrets PROFILE=...` for the operator
- [ ] 2.3 Run `make dev`, `make ci`, `make prod-local` locally to confirm none break with the new argument shape
- [x] 2.4 Add `infrastructure-lint` make target (or equivalent shell script) that fails CI if `infrastructure/server/sync/compose.yml` contains any `name:` field on a `volumes:` or `networks:` declaration (per `server-stack-deploy` spec)

## 3. Host bootstrap scripts (`infrastructure/server/`)

- [x] 3.1 Create `infrastructure/server/install-host.sh` — idempotent Ubuntu 24.04 ARM64 setup: arch + release guard, `signed-by` keyrings for Docker, install Docker Engine + compose plugin + `sops` + `age` + `jq` + `restic` + `ufw` (`--no-install-recommends`), create `ghrunner` user, create `/srv/tricho/{edge/acme,prod/couchdb/data,dev/couchdb/data}` with correct ownership, write hardened `/etc/docker/daemon.json` (`no-new-privileges`, `userland-proxy: false`, log rotation), configure `ufw default deny incoming` + allow `22/tcp,80/tcp,443/tcp`, add 4G swap if absent
- [x] 3.2 Add idempotence guards to `install-host.sh`: every package via `dpkg -s … || apt-get install`; every user via `getent passwd ghrunner || useradd …`; every directory via `install -d` with mode; daemon.json change only if `diff` differs and then `systemctl reload docker` (not restart)
- [x] 3.3 Create `infrastructure/server/install-runner.sh` — download pinned `actions-runner-linux-arm64-<VERSION>.tar.gz` from GitHub releases, verify SHA256 against committed checksum file, extract to `/opt/actions-runner/`, create JIT registration via `gh api -X POST /repos/beranku/tricho.app/actions/runners/generate-jitconfig --jq .encoded_jit_config -f name=$(hostname -f) -f labels="[\"$(hostname -f)\"]"`, register with `--ephemeral --disableupdate`
- [x] 3.4 Author the hardened systemd unit (`/etc/systemd/system/actions.runner.beranku-tricho.app.<host>.service`) with `User=ghrunner`, `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ReadWritePaths=/opt/actions-runner /var/run/docker.sock`, `ProtectHome=yes`, `PrivateTmp=yes`, plus the rest of the hardening overlay from the spec; install via `systemctl daemon-reload && systemctl enable --now`
- [x] 3.5 Create `infrastructure/server/bootstrap.sh` wrapper: assert root, source the host install script, source the runner install script, print summary and the systemd unit path
- [x] 3.6 Commit `infrastructure/server/runner-version.txt` (single-line version pinning, e.g., `2.323.0`) and `infrastructure/server/runner-checksums.txt` (SHA256 for the linux-arm64 tarball); update via Renovate-equivalent later
- [ ] 3.7 Smoke-test the bootstrap end-to-end on a throwaway VM (Multipass or a temp Hetzner instance) to confirm runner registers and re-runs idempotently; document any rough edges in the runbook

## 4. Per-server age key and secrets profiles

- [x] 4.1 On `o3.tricho.app`: `age-keygen -o /etc/sops/age/o3.tricho.app.key` (mode `0600`, root-owned). Capture the public key.
- [x] 4.2 Add the captured public key to `.sops.yaml` as a recipient on the `secrets/sync-prod.sops.yaml` AND `secrets/sync-dev.sops.yaml` rules
- [x] 4.3 Create `secrets/sync-prod.sops.yaml` (initially empty values for non-real OAuth/Stripe credentials; real values filled in 9.x just before first prod deploy) using `sops` with the new recipients
- [x] 4.4 Create `secrets/sync-dev.sops.yaml` similarly
- [x] 4.5 Run `make secrets-rotate-age` to re-encrypt every existing SOPS file under the updated recipient set; verify all files still decrypt locally
- [x] 4.6 Configure GitHub Environment secrets: `production` environment → `SOPS_AGE_KEY` (the operator's age private key value, used by the deploy workflow to render the production sync profile); add required reviewer (operator); add `deployment_branch_policy.protected_branches = true`. `dev` environment → `SOPS_AGE_KEY` (same or distinct value); no reviewer required.

## 5. Image pipeline (`build-server-images.yml`)

- [x] 5.1 Create `.github/workflows/build-server-images.yml`; triggers `workflow_dispatch` + `push` filtered to `main`, `dev`, `infrastructure/couchdb/**`, `infrastructure/couchdb/tricho-auth/**`
- [x] 5.2 Build job runs `runs-on: ubuntu-24.04-arm`; `permissions: { id-token: write, packages: write, contents: read }` (id-token for cosign keyless)
- [x] 5.3 `docker/setup-buildx-action@v3` (no qemu); `docker/login-action@v3` to `ghcr.io` with `${{ github.actor }}` + `secrets.GITHUB_TOKEN`
- [x] 5.4 `docker/metadata-action@v5` for `tricho-auth` and `tricho-couchdb` separately; tags `type=sha,prefix=sha-,format=long` (immutable primary), `type=ref,event=branch` (mutable `dev`/`main` aliases)
- [x] 5.5 Pre-push existence check: skip the push step if `docker manifest inspect ghcr.io/beranku/tricho-{auth,couchdb}:sha-${{ github.sha }}` already returns a manifest (re-run idempotence)
- [x] 5.6 `docker/build-push-action@v6` with `platforms: linux/arm64`, `push: true`, `provenance: true`
- [x] 5.7 `sigstore/cosign-installer@v3`; sign each image digest with `cosign sign --yes ghcr.io/beranku/tricho-{auth,couchdb}@${digest}`
- [x] 5.8 Smoke-run the workflow once via `workflow_dispatch` on `main`; verify both packages exist in GHCR with `sha-<full>` tag and a Sigstore signature artifact

## 6. Edge stack (`infrastructure/server/edge/`)

- [x] 6.1 Create `infrastructure/server/edge/compose.yml`: single `traefik` service, image `traefik:v3.3` (pinned), restart `unless-stopped`, ports `80:80, 443:443`, volume `./acme:/etc/traefik/acme` (with the host directory bind into `/srv/tricho/edge/acme/` resolved at startup), `:ro` mount of `./dynamic` and `:ro` mount of `/var/run/docker.sock`. Network declaration: external `tricho-edge` (`external: true, attachable: true`)
- [x] 6.2 Author `infrastructure/server/edge/dynamic/middlewares.yml` (file provider): `tricho-security` (HSTS 63072000 + preload + includeSubdomains, `frameDeny`, `nosniff`, `referrerPolicy strict-origin-when-cross-origin`, custom request headers redacting `Authorization`/`Cookie` only in access logs); a `tricho-rate-limit` placeholder; `tricho-cors-prod` (allow only `https://tricho.app`); `tricho-cors-dev` (allow only `https://dev.tricho.app`)
- [x] 6.3 Author `infrastructure/server/edge/up.sh`: assert root, ensure `tricho-edge` network exists (`docker network create --attachable tricho-edge` if missing), ensure `/srv/tricho/edge/acme` exists with mode `0700`, `docker compose -p tricho-edge up -d --wait`. Include access log JSON config, use LE staging endpoint when env var `TRAEFIK_USE_LE_STAGING=1`, production endpoint otherwise
- [x] 6.4 Author `infrastructure/server/edge/down.sh` — stop edge project, never delete `/srv/tricho/edge/acme/` data, never `docker network rm tricho-edge`
- [x] 6.5 Validate edge stack locally first (in a throwaway VM with synthetic DNS) before deploying to `o3`; verify ACME directory is populated only on first successful issuance and persists across re-`up`s

## 7. Sync stack (`infrastructure/server/sync/`)

- [x] 7.1 Create `infrastructure/server/sync/compose.yml`: services `couchdb` (image from GHCR `ghcr.io/beranku/tricho-couchdb:${IMAGE_TAG}`) and `tricho-auth` (image from GHCR `ghcr.io/beranku/tricho-auth:${IMAGE_TAG}`). Volumes: `couchdb-data` as host bind to `/srv/tricho/${ENVIRONMENT}/couchdb/data`. Networks: `internal` (private to project, no external) for `couchdb ↔ tricho-auth`; `tricho-edge` (external) attached only to `tricho-auth`. NO `name:` fields on networks/volumes.
- [x] 7.2 Configure `tricho-auth` Traefik labels in `compose.yml` to mount router on `Host(\`${APP_HOST}\`) && PathPrefix(\`/auth\`)`; couchdb router on `Host(\`${APP_HOST}\`) && (PathPrefix(\`/userdb-\`) || PathPrefix(\`/_replicator\`))`; both routers attach `tricho-security@file` middleware AND the appropriate `tricho-cors-${ENVIRONMENT}@file` middleware
- [x] 7.3 Apply per-service `deploy.resources.limits` (CouchDB `memory: 2g, cpus: 1.5`; tricho-auth `memory: 512m, cpus: 1.0`), `cap_drop: [ALL]` then `cap_add: [NET_BIND_SERVICE, CHOWN, SETUID, SETGID, FOWNER, DAC_OVERRIDE]` per minimum-required, `security_opt: [no-new-privileges:true]`, `logging: { driver: json-file, options: { max-size: 10m, max-file: 3 } }`, `stop_grace_period: 30s`
- [x] 7.4 Configure `tricho-auth` to expose a `X-Build-Sha` response header sourced from the `IMAGE_TAG` env (will be parsed by the deploy workflow's smoke step). Verify the existing `server.mjs` either does this or extend it minimally — the smoke gate from the spec depends on this header.
- [x] 7.5 Create `infrastructure/server/sync/config/default/.env` (shared defaults: `COUCHDB_USER=admin`, `TRICHO_META_DB=tricho_meta`, `PORT=4545`, etc.)
- [x] 7.6 Create `infrastructure/server/sync/config/prod/.env`: `APP_HOST=sync.tricho.app`, `APP_ORIGIN=https://tricho.app`, `TRAEFIK_ACME_EMAIL=…`, real OAuth `*_CLIENT_ID` and `*_REDIRECT_URI` values for prod
- [x] 7.7 Create `infrastructure/server/sync/config/dev/.env`: `APP_HOST=sync.dev.tricho.app`, `APP_ORIGIN=https://dev.tricho.app`, dev OAuth values
- [x] 7.8 Create `infrastructure/server/sync/config/default/versions.env` — pinned image tags (currently identical to deploy SHA, but kept here so an operator can override one image's tag for emergency rollback without git push)
- [x] 7.9 Author `infrastructure/server/sync/up.sh ${ENVIRONMENT}`: validate ENVIRONMENT in `{prod,dev}`; `set -eu`; export `COMPOSE_PROJECT_NAME=tricho-sync-${ENVIRONMENT}`; source per-env + default `.env`s + `versions.env`; render secrets via `make _render-secrets PROFILE=sync-${ENVIRONMENT}`; `cosign verify` the two images BEFORE pull; `docker compose pull`; `docker compose up -d --wait --wait-timeout 60`; run `infrastructure/server/sync/smoke.sh ${ENVIRONMENT}`; on failure, restore `IMAGE_TAG` from `/opt/tricho/IMAGE_TAG.${ENVIRONMENT}.current` and re-`up`; on success, write the new SHA to that file
- [x] 7.10 Author `infrastructure/server/sync/down.sh ${ENVIRONMENT}`: stop the named project, leave `/srv/tricho/${ENV}/couchdb/data` intact
- [x] 7.11 Author `infrastructure/server/sync/smoke.sh ${ENVIRONMENT}`: probe `https://sync.<env>.tricho.app/auth/health` (assert 200 + `X-Build-Sha` matches `${IMAGE_TAG}`); probe `https://sync.<env>.tricho.app/_up` via Traefik with a synthetic JWT (or equivalent that validates the data path); fail fast if either gate fails

## 8. Deploy workflows

- [x] 8.1 Create `.github/workflows/deploy-server.yml` with two triggers: `workflow_dispatch` (inputs: `ENVIRONMENT` choice `[prod, dev]`, `RUNNER_LABEL` default `o3.tricho.app`, optional `IMAGE_REF` overriding the SHA) and `push` filtered to `branches: [dev]` (auto-dev only)
- [x] 8.2 Configure `concurrency: { group: deploy-${{ inputs.ENVIRONMENT || 'dev' }}-${{ inputs.RUNNER_LABEL || 'o3.tricho.app' }}, cancel-in-progress: false }`
- [x] 8.3 The `deploy` job: `runs-on: ${{ inputs.RUNNER_LABEL || 'o3.tricho.app' }}`, `environment: ${{ inputs.ENVIRONMENT || 'dev' }}`. Steps: checkout repo at the deploying SHA; `cosign verify` both images; render secrets; `bash infrastructure/server/sync/up.sh ${ENVIRONMENT}`; on success, post a step summary with the new SHA + smoke-probe outputs
- [x] 8.4 Add a job-level OUTPUT for the deploying SHA so a follow-on notify job can include it in any future Slack/Telegram integration
- [x] 8.5 Verify the workflow file's `permissions:` block is minimal: `contents: read, packages: read, id-token: write` (id-token for `cosign verify`'s OIDC flow if used; otherwise drop)

## 9. Server bootstrap workflow

- [x] 9.1 Create `.github/workflows/server-bootstrap.yml`: `workflow_dispatch` only, inputs `RUNNER_LABEL` (default `o3.tricho.app`) and `MODE` choice `[install-host, runner-upgrade, edge-up]`. `runs-on: ${{ inputs.RUNNER_LABEL }}` (requires runner already exists; for the very first install the operator does the SSH path)
- [x] 9.2 Step matrix per `MODE`: `install-host` runs `sudo bash infrastructure/server/install-host.sh`; `runner-upgrade` runs `sudo bash infrastructure/server/install-runner.sh` after pinned version bump; `edge-up` runs `sudo -u ghrunner bash infrastructure/server/edge/up.sh`
- [x] 9.3 Each step prints a digest (`docker version`, runner version, edge container ID) into the run summary

## 10. First dev deploy validation (Phase 6 of design)

- [x] 10.1 DNS: ensure `sync.dev.tricho.app` A/AAAA points at `o3.tricho.app` (out-of-band, document the IP in the runbook)
- [x] 10.2 Push a no-op commit to `dev`; verify `build-server-images.yml` produces the SHA-tagged + signed images (5.x outputs)
- [x] 10.3 Verify `deploy-server.yml` auto-runs with `ENVIRONMENT=dev`; verify the three DoD gates pass; verify `https://sync.dev.tricho.app/auth/health` returns 200
- [ ] 10.4 Browser test: open `https://dev.tricho.app/app/` (CF Pages) and confirm cross-origin login completes against `https://sync.dev.tricho.app/auth/...`. Network tab confirms CORS headers and `Domain=tricho.app` cookie scope.
- [x] 10.5 Capture any rough edges in `docs/server-deploy.md` Troubleshooting section

## 11. First prod deploy validation (Phase 7 of design)

- [x] 11.1 DNS: `sync.tricho.app` A/AAAA → `o3.tricho.app` IP
- [ ] 11.2 Real OAuth credentials populated in `secrets/sync-prod.sops.yaml`; Stripe credentials populated; commit and re-encrypt
- [ ] 11.3 Operator runs `gh workflow run deploy-server.yml -f ENVIRONMENT=prod -f RUNNER_LABEL=o3.tricho.app` from `main`
- [ ] 11.4 Required-reviewer prompt fires; operator approves; deploy proceeds
- [ ] 11.5 Verify all three DoD gates green; verify `tricho-sync-dev` is unaffected (`docker compose -p tricho-sync-dev ps` still healthy)
- [ ] 11.6 End-to-end test from `https://tricho.app` (CF Pages): login, sync entitlement check, sample data round-trip via `userdb-*`. Confirm with a real Pro account that entitlement gating still works against the production proxy.

## 12. Backup + DR

- [ ] 12.1 Decide off-site target: B2 vs rsync.net (settle Open Question Q1 from design.md). Provision the bucket/account; record credentials in `/etc/tricho/restic-creds.env` (mode `0600`, root-owned; not committed)
- [ ] 12.2 Generate restic password (32+ random bytes); store in `/etc/tricho/restic.pw` (mode `0600`, root-owned). Back up the password to the operator's password manager — losing it loses backups.
- [ ] 12.3 `restic --repo <repo> --password-file /etc/tricho/restic.pw init` once
- [ ] 12.4 Create `/etc/cron.daily/tricho-backup` with the snapshot + forget-prune logic; ensure error path emails / Telegrams the operator
- [ ] 12.5 Verify the next day's snapshot exists; verify retention policy (`forget --keep-daily 30 --keep-monthly 12 --keep-yearly 2 --prune`)
- [ ] 12.6 Create `/etc/cron.monthly/tricho-restore-drill` per spec — spins up `tricho-restoretest` project, restores latest snapshot, validates, tears down. Email/Telegram on failure
- [ ] 12.7 Run the drill once manually to confirm it works green-path
- [ ] 12.8 Add backup-target note + restic password recovery procedure to `docs/server-deploy.md`

## 13. Cleanup, validation, and follow-ups

- [x] 13.1 Run `openspec validate add-server-deploy-stack --strict` and address any issues
- [ ] 13.2 Confirm root `compose.yml` and `make dev | ci | prod-local | e2e` all still work as before the change (regression sanity check)
- [x] 13.3 Confirm `docs/server-deploy.md` is complete: every troubleshooting topic that came up during phases 10–12 has at least a paragraph
- [x] 13.4 Resolve or punt each open question from `design.md` §"Open Questions": Q2 deferred, Q3/Q4/Q5 resolved as designed; Q1 (B2 vs rsync.net) remains open pending operator decision and is captured in tasks 12.1+
- [ ] 13.5 Once stack is stable for ≥2 weeks, archive this change with `openspec archive add-server-deploy-stack`
