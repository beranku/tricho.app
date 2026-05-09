# Proposal: add-server-deploy-stack

## Why

The server-side stack — CouchDB, `tricho-auth` proxy, edge Traefik — has no production deployment path today. Frontend ships continuously to Cloudflare Pages, but the backend exists only as a local/CI compose topology. That blocks (a) running real `live-sync` against a browser-trusted HTTPS subdomain, (b) provisioning the paid plans whose value proposition is sync (`Pro`, `Max`), and (c) iterating on the backend with the same `dev`-branch reflex the frontend already enjoys.

We have a target server (`o3.tricho.app`, Ubuntu 24.04 ARM64, SSH-reachable). We need a GitOps pipeline that brings the server up, keeps it patched, and deploys both `prod` (`sync.tricho.app`) and `dev` (`sync.dev.tricho.app`) side-by-side on it — without disturbing the existing `make dev | ci | prod-local` developer workflow.

## What Changes

- **Add** host bootstrap (Ubuntu 24.04 ARM64): Docker engine + compose plugin, SOPS, age, jq, swap, `/srv/tricho/*` data dirs, `ufw` baseline, hardened `daemon.json` (`no-new-privileges: true`, `userland-proxy: false`, log rotation).
- **Add** self-hosted GitHub Actions runner deployment: JIT registration tokens (`/actions/runners/generate-jitconfig`), `--ephemeral` mode, dedicated `ghrunner` user, hardened systemd unit (`NoNewPrivileges`, `ProtectSystem=strict`, `ReadWritePaths` whitelisted, `LogNamespace`), pinned runner version (`--disableupdate` + Renovate).
- **Add** server image pipeline: GHCR (`ghcr.io/beranku/tricho-{auth,couchdb}`), immutable `sha-<full-sha>` primary tag + mutable `dev`/`prod` aliases, cosign keyless signing in build, cosign verify before pull on the deploy host, native multi-arch build on `ubuntu-24.04-arm` runner.
- **Add** shared edge Traefik on the deploy host as its own compose project (`tricho-edge`), with Let's Encrypt (HTTP-01), `external: true, attachable: true` network `tricho-edge`, ACME directory bind on `/srv/tricho/edge/acme`, file-provider middleware for HSTS / security-headers / rate-limit, JSON access log with `Authorization`/`Cookie` redaction.
- **Add** per-environment stack project (`tricho-sync-prod`, `tricho-sync-dev`) running CouchDB + `tricho-auth` only — **no PWA** on the server. Project name → DNS / volume / network prefix isolation; private `internal` network per env; CouchDB never touches the `tricho-edge` network.
- **Add** new SOPS profiles `secrets/sync-prod.sops.yaml` and `secrets/sync-dev.sops.yaml`, per-server age keypair (private root-only on host, public in `.sops.yaml`), `SOPS_AGE_KEY` injected via GitHub Environment secrets (not repository secrets).
- **Add** workflows: `build-server-images.yml` (matrix build + sign + push), `deploy-server.yml` (reusable, `workflow_call` + `workflow_dispatch` + `push:dev`), `server-bootstrap.yml` (idempotent reinstall/upgrade through the runner). Concurrency `group: deploy-${env}-${runner}` with `cancel-in-progress: false`.
- **Add** deploy DoD: `compose up --wait` green AND external HTTPS smoke (`/auth/health`, `/_up`) AND a JWT-authed data-path probe; rollback via previous SHA cached in `/opt/tricho/IMAGE_TAG.current` and re-up.
- **Add** backup + DR: restic (encrypted, dedup) to off-site (B2 / rsync.net) daily; optional continuous CouchDB replication to a warm-standby; monthly automated restore drill into a throwaway `restoretest` project. Backups MUST be encrypted because CouchDB on disk holds plaintext metadata (`vaultId`, `docId`, OAuth `sub`, `_users`).
- **Add** runbook `docs/server-deploy.md` (first-run SSH bootstrap, redeploy, secrets rotation, second server, troubleshooting).
- **Modify** `Makefile` — `_render-secrets` accepts a `PROFILE=` argument so the deploy workflow can render `sync-prod` / `sync-dev` without disturbing `dev` / `ci`.
- **Modify** `docs/build-and-deploy.md`, `docs/secrets.md`, `CLAUDE.md` — pointers to the new runbook; new SOPS profiles and per-server age-key onboarding.
- **Does NOT modify** root `compose.yml` or `infrastructure/{couchdb,traefik,pwa,mock-oidc}/`. The new layout lives entirely under `infrastructure/server/` and reuses the existing Dockerfiles + entrypoint shim + tricho-auth code unchanged.

## Capabilities

### New Capabilities

- `server-host-bootstrap`: Ubuntu 24.04 ARM64 host preparation, hardened Docker daemon, SOPS+age toolchain, persistent data layout under `/srv/tricho/`, and JIT-token + ephemeral self-hosted runner registered as a hardened systemd unit.
- `server-image-pipeline`: GHCR-based image build, signing (cosign keyless via GitHub OIDC), tagging, and verified pull. Covers both `tricho-auth` and the `couchdb` wrapper image. Native ARM64 build, no QEMU emulation in the deploy path.
- `server-stack-deploy`: Shared `tricho-edge` Traefik project + per-environment `tricho-sync-<env>` stacks (CouchDB + `tricho-auth`, no PWA) co-resident on a single host. Deploy workflows (`workflow_dispatch` + `push:dev`), GitHub Environment gating with required reviewer for `production`, `compose up --wait` + external smoke + data-path probe Definition of Done, atomic SHA rollback.
- `server-backup-restore`: Encrypted off-site backup of CouchDB data + Traefik ACME store via restic; optional continuous CouchDB replication to a warm-standby; monthly automated restore drill into an isolated compose project. Explicit acknowledgement that on-disk CouchDB state holds plaintext metadata even though payloads are ciphertext.

### Modified Capabilities

- `traefik-edge`: The current spec mandates *same origin for PWA + CouchDB + auth* on a single hostname (true for `make dev | ci | prod-local`). The new server-deploy topology hosts the PWA on Cloudflare Pages (`tricho.app` / `dev.tricho.app`) and the sync stack on `sync.tricho.app` / `sync.dev.tricho.app` — same registrable site, different origin. The capability scope MUST be split: same-origin requirement applies only to the single-host stack-orchestration profile; the server-deploy profile uses a sync-only hostname with `Access-Control-Allow-Origin` and credentialed CORS allowlisted to the matching CF Pages origin, and cookies set with `Domain=tricho.app` + `SameSite=Lax`. The "unmatched path serves the PWA" requirement does NOT apply to the server-deploy edge — the server has no PWA fall-through.
- `secrets-management`: Adds two new at-rest profiles (`secrets/sync-prod.sops.yaml`, `secrets/sync-dev.sops.yaml`), the per-server age keypair pattern (private root-only on host, public in `.sops.yaml`), and the requirement that the `SOPS_AGE_KEY` material in GitHub Actions for production deploys be a **GitHub Environment secret** (gated by required reviewers), not a repository secret. The `Makefile`'s `_render-secrets` target gains a `PROFILE=` argument so a workflow can decrypt one profile per deploy step.

## Impact

**Affected code & files**

- New: `infrastructure/server/` tree (host bootstrap scripts, edge compose, sync compose, per-env config, smoke / rollback scripts).
- New: `secrets/sync-prod.sops.yaml`, `secrets/sync-dev.sops.yaml`.
- New: `.github/workflows/{build-server-images.yml,deploy-server.yml,server-bootstrap.yml}`.
- New: `openspec/specs/{server-host-bootstrap,server-image-pipeline,server-stack-deploy,server-backup-restore}/spec.md`.
- New: `docs/server-deploy.md`.
- Modified: `Makefile` (one target signature: `_render-secrets PROFILE=`). Dev-default behavior unchanged.
- Modified: `.sops.yaml` (per-server age recipient block, plus the two new file globs).
- Modified: `docs/build-and-deploy.md`, `docs/secrets.md`, `CLAUDE.md`.
- Modified: `openspec/specs/{traefik-edge,secrets-management}/spec.md` (delta files in this change).

**Zero-knowledge invariants — explicit impact statement**

The server-deploy capability does NOT broaden what the server can see. The `tricho-auth` proxy keeps its current role: it validates JWT + subscription + `paidUntil` and forwards to per-user CouchDB, never decrypting payloads. The new spec MUST contain a guarding requirement that:

- The server's runtime configuration MUST NOT introduce any plaintext data path. No keystore unlock helpers, no server-side decryption shims, no plaintext logging.
- Backups are of *ciphertext payloads + plaintext metadata* and MUST be encrypted at rest by restic (xchacha20-poly1305) and over the wire (B2/rsync.net TLS).
- Runner workspaces never receive the user-facing DEK or Recovery Secret. The only secret material that reaches the runner is the deployment-side SOPS age key + GHCR pull credentials.
- The cosign verify step on the deploy host is the only mechanism that proves the running binary matches the workflow that built it; bypassing it would let a malicious image reach `tricho-auth`.

**External systems and dependencies**

- **GHCR**: new packages `tricho-auth`, `tricho-couchdb` under `beranku` org. Pull credentials use the runner's `GITHUB_TOKEN` — no new long-lived credential.
- **Cloudflare DNS**: two new A/AAAA records (`sync.tricho.app`, `sync.dev.tricho.app` → `o3.tricho.app` IP), set up outside this change but called out in the runbook.
- **Let's Encrypt**: two new certificates issued via HTTP-01 by the shared Traefik. ACME directory persisted on host (`/srv/tricho/edge/acme`) — survives stack redeploys; rate limits respected by reusing the same volume.
- **Off-site backup target** (B2 or rsync.net): one new bucket / account; credentials live as host-local restic password file outside the repo.
- **Sigstore / Fulcio / Rekor**: cosign keyless trust chain. No private key material to manage.

**Rollback steps**

If this change goes wrong, the project remains in the "frontend on CF Pages, server-side runs locally only" state it is in today.

1. **Workflow rollback** — disable the new workflows via `.github/workflows/*.yml.disabled` rename (no actions removed from the runner). The runner remains registered; nothing automatic reaches the server.
2. **Stack rollback** — `infrastructure/server/sync/down.sh <env>` stops the per-env stack while leaving data volumes (`/srv/tricho/<env>/couchdb/data`) intact. `infrastructure/server/edge/down.sh` stops Traefik and releases ports 80/443. Frontend on CF Pages is unaffected.
3. **Image rollback** — the deploy workflow caches the previous successful SHA in `/opt/tricho/IMAGE_TAG.current`; `IMAGE_TAG=<prev-sha> infrastructure/server/sync/up.sh <env>` reverts to the prior image without rebuilding. Tags in GHCR are immutable.
4. **Capability rollback** — if the architectural split between local `traefik-edge` and server-deploy proves wrong, the `traefik-edge` modification is a strict relaxation: reverting it leaves local stack orchestration on its current tighter contract; only the new server-deploy specs become non-applicable.
5. **Host rollback** — uninstall the runner with `./svc.sh uninstall && ./config.sh remove --token <fresh>`; `docker compose -p tricho-edge down -v` and `docker compose -p tricho-sync-<env> down` evict containers. `/srv/tricho/` is left in place for inspection or removed manually.
