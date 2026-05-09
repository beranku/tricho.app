# Design: add-server-deploy-stack

## Context

Tricho.app today: frontend on Cloudflare Pages, backend (`tricho-auth`, CouchDB, Traefik) only as a local/CI compose topology under `compose.yml` profiles `dev`, `ci`, `prod-local`. There is no production deployment of the backend. The infrastructure code itself (Dockerfiles, entrypoint shim with JWT key handoff, `tricho-auth/server.mjs` secret hydration, Traefik file-provider middleware, SOPS+age secrets pipeline, healthchecks) is already production-grade — the gap is the orchestration *around* it: a server, a runner, image distribution, deploy workflows, backup, runbook.

Constraints:
- Solo project, `beranku/tricho.app` (private). One operator.
- Target: `o3.tricho.app`, Ubuntu 24.04 ARM64, SSH-reachable.
- Both `prod` and `dev` server stacks co-resident on this single host initially; design must scale to a second/third host without rework.
- Czech-only product, but specs and infrastructure code are English (matching the rest of `openspec/specs/`).
- Existing `make dev | ci | prod-local` developer workflow MUST keep working untouched.
- Hard invariants from `CLAUDE.md`: zero-knowledge server, no password recovery, secrets via SOPS+age, sync entitlement gating in `tricho-auth`, server hosts NO PWA assets (PWA is on CF Pages).

Stakeholders: solo operator (deploy authority + reviewer); end users on `tricho.app` whose sync availability depends on this stack.

## Goals / Non-Goals

**Goals:**
- One-command first-time bootstrap of a new deploy host (`scp bootstrap.sh && ssh sudo bash`).
- Idempotent re-bootstrap (`server-bootstrap` workflow re-runs `install-host.sh` after the runner exists).
- Two parallel environments (`prod`, `dev`) on one host, isolated by docker-compose project name + per-env private network + per-env data path.
- Single shared edge Traefik on the host (one ACME store, one cert pool, `:80/:443` bound once).
- `dev` branch push → automatic deploy to `sync.dev.tricho.app`. `prod` deploy → manual `workflow_dispatch` only, with required-reviewer gate via GitHub Environment.
- Image build is native ARM64 on `ubuntu-24.04-arm` GitHub-hosted runner; deploy is on `o3.tricho.app` self-hosted runner. Build and deploy are separate jobs; the deploy job only ever consumes images already pushed.
- Atomic rollback to previous SHA in <30 seconds.
- Encrypted off-site backups, restore drill validated monthly.
- All server-side secrets at-rest via SOPS+age; `SOPS_AGE_KEY` for `production` deploys is a GitHub Environment secret with reviewer gate.

**Non-Goals:**
- Kubernetes, Nomad, ECS — overkill for a single-host single-tenant deploy.
- Vault / Infisical — SOPS+age is sufficient; revisit at multi-operator scale.
- Multi-region / multi-host high availability — out of scope for v1; design must not preclude it.
- Server-side decryption of payloads, anywhere, ever.
- Hosting PWA assets on the deploy host — PWA stays on CF Pages.
- Auto-deploying `main` to production — kept manual to retain a human gate.
- Nightly cron deploys — no benefit over `dev`-on-push; introduces drift while operator is asleep.
- Custom Linux distro / immutable OS / NixOS — Ubuntu 24.04 LTS is the operator's chosen baseline.

## Decisions

### D1. Self-hosted runner: JIT + ephemeral, not persistent

**Decision.** Runner registers per-job via `POST /repos/beranku/tricho.app/actions/runners/generate-jitconfig` (single-use, 1 h TTL, single-job binding) and runs in `--ephemeral` mode (one job → exit → re-register).

**Why.** GitHub's secure-use docs are explicit that long-lived runners on the same host as production services are a backdoor risk; ephemeral mode defeats cross-job persistence (planted binaries, residual state). JIT supersedes legacy registration tokens — strictly better, no downside.

**Alternatives considered.**
- *Persistent runner with long-lived token* — what `../infra/runners/` does. Simpler bootstrap, weaker security posture; cross-job persistence is a real concern when the runner shares the kernel with production services.
- *GitHub-hosted runners only, deploy via SSH from cloud runner* — no host runner to harden, but adds an SSH key as a long-lived production credential and forces the deploy job to do its image pull / signature verify over WAN twice (cloud → host). Rejected on cost and complexity.
- *Tailscale + Actions reach the host as remote Docker context* — pushes the runner-on-prod-host problem somewhere else, doesn't solve it.

**Threat model delta.** Without ephemeral mode, an attacker with a one-time RCE in any workflow run could plant a daemon, sniff future runs, or hop to the host's Docker socket. With JIT + ephemeral, each run starts from the same registered-and-discarded baseline, and `/opt/actions-runner/_work` is wiped between jobs. The Docker socket bind is still privilege-equivalent to root on the host, so the runner user MUST be a dedicated unprivileged account, the systemd unit MUST drop capabilities and lock down the filesystem (see D2), and only the deploy workflow is allowed to call into Docker.

### D2. systemd hardening overlay for the runner

**Decision.** Replace the default `actions.runner.<...>.service` with a unit overlay that sets:

```ini
User=ghrunner
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/opt/actions-runner /var/run/docker.sock
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictNamespaces=yes
LockPersonality=yes
SystemCallArchitectures=native
LogNamespace=ghrunner
```

**Why.** GitHub ships a deliberately minimal unit. `systemd-analyze security` rates the default as "UNSAFE"; the overlay above moves it into "OK". Each line addresses a specific class of post-RCE escalation: `NoNewPrivileges` blocks setuid binaries; `ProtectSystem=strict` makes everything outside `/var`, `/tmp`, and explicit `ReadWritePaths` read-only; `ProtectKernelModules` prevents loading rootkits; `LogNamespace` isolates the runner's journal so log-poisoning attacks don't leak into the host's main journal.

**Alternatives considered.** Rootless Docker (the runner uses its own user-namespaced daemon) would be stricter but breaks Compose patterns we already use (file-mounted secrets paths, `docker.sock` mounting for Traefik). Defer to v2.

**Threat model delta.** Pre-overlay: a compromised workflow run that escapes container has full read access to `/etc`, can write to `/usr/local/bin`, can probe `/dev` directly. Post-overlay: the workflow process is filesystem-confined to `/opt/actions-runner` and `/var/run/docker.sock`, with no privilege-escalation path short of a kernel CVE. The Docker socket is still the soft underbelly — see D3.

### D3. Build / deploy job split, cosign verify on host

**Decision.** Two jobs:
1. `build` — runs on GitHub-hosted `ubuntu-24.04-arm`, builds `linux/arm64` image, signs keyless with cosign (GitHub OIDC), pushes to GHCR with tags `sha-<full-sha>` (immutable), `<env>` (mutable alias).
2. `deploy` — runs on the self-hosted runner, `cosign verify --certificate-identity-regexp '^https://github\.com/beranku/tricho\.app/' --certificate-oidc-issuer https://token.actions.githubusercontent.com` on the digest, then `docker compose pull` + `up --wait`.

The deploy job NEVER builds. The runner host has no `docker buildx` setup tasks in its workflows.

**Why.** Build privilege ≠ deploy privilege. Compromise of either job has a smaller blast radius than a combined "build-and-deploy" job. cosign verify on the deploy host is the atomic check that the image about to run was produced by the GitHub workflow we expect — defending against a compromised PAT, a typo'd image tag, or a malicious image with a colliding tag.

**Alternatives considered.**
- *Build native on the self-hosted runner.* Faster (no QEMU, no upload), but conflates build privilege with deploy privilege; a malicious dependency in `npm ci` then has Docker socket access. Rejected.
- *Skip cosign — trust GHCR + GitHub auth.* Adequate against most threat models, but cosign is now low-cost (10 lines, keyless), and it pins the artifact to the specific workflow file + commit SHA via the OIDC certificate identity. Worth the friction.
- *Sign with a long-lived KMS key.* More effort, no real benefit at this scale.

**Threat model delta.** Pre-cosign: an attacker with GHCR push perms (e.g., compromised `GITHUB_TOKEN`) can replace `:sha-abc...` with a malicious image. Post-cosign: even with push perms, the attacker cannot forge an OIDC-issued Sigstore certificate naming this repo + workflow file, so `cosign verify` rejects on the host. The remaining attack is "compromise the build workflow itself", which is mitigated by D1+D2 + branch protection on `main`.

### D4. Shared edge Traefik, attachable network, ACME directory bind

**Decision.** Edge Traefik runs as its own compose project (`tricho-edge`), creates `tricho-edge` network with `external: true, attachable: true`, mounts ACME state from `/srv/tricho/edge/acme` (host directory bind, `0700`, owned by Traefik's container UID). Per-env stacks (`tricho-sync-prod`, `tricho-sync-dev`) join `tricho-edge` *plus* a project-private network for CouchDB ↔ tricho-auth traffic.

Middleware (HSTS, security-headers, rate-limit, redact-headers in access log) lives in the file provider at `/etc/traefik/dynamic/*.yml`. Per-service routers come from docker labels on `tricho-auth` and `couchdb` containers in their per-env compose.

**Why.** One host, one `:80/:443` binding — physically can't run two Traefiks. ACME state in a host directory (not a docker volume) means rebuilding the edge project doesn't risk certificate loss; rebuilding doesn't trigger rate-limit-relevant new orders. Directory bind (not file bind) avoids the "Docker recreates missing host file as a directory and silently nukes acme.json" footgun the community has hit repeatedly.

**Alternatives considered.**
- *Two Traefiks on different ports* — public-facing services on non-standard ports is a non-starter.
- *Caddy instead of Traefik* — would force a different middleware syntax for `tricho-security` than the rest of the stack uses. No benefit.
- *ACME in a named docker volume* — hidden under `/var/lib/docker/volumes/`, harder to backup, and doomed to be wiped by a misplaced `docker volume prune`. Rejected.

**Threat model delta.** No change to TLS posture vs. `prod-local`. The cross-origin server-deploy variant introduces a new CORS surface (see D6) but the channel itself is the same Let's Encrypt issued chain.

### D5. Per-environment isolation: `COMPOSE_PROJECT_NAME` + zero `name:`-pinned resources

**Decision.** Set `COMPOSE_PROJECT_NAME=tricho-sync-${ENV}` in the deploy step. Compose auto-prefixes containers, networks, volumes, DNS aliases. `infrastructure/server/sync/compose.yml` MUST NOT pin any `name:` on its volumes or networks. CouchDB data path is a host bind to `/srv/tricho/${ENV}/couchdb/data` — explicit, operator-legible, untouched by `compose down -v`.

**Why.** `COMPOSE_PROJECT_NAME` is the only built-in isolation primitive that costs nothing. Pinned `name:` resources break it silently — `prod` and `dev` would share a volume, exfiltrating data across environments on first restart. Bind mounts on `/srv/tricho/<env>/...` make backup, restore, and "where is this data" trivially answerable from a shell session, which matters more than the few-percent abstraction Docker named volumes offer.

**Alternatives considered.**
- *Named volumes with explicit project prefix* — works but requires templating volume names, and the operator-legibility argument still favors `/srv` paths.
- *Two hosts (one per env)* — eventual goal, not v1. The design must remain compatible (the workflow's `RUNNER_LABEL` input is the per-host knob).

**Threat model delta.** Cross-env data leakage is now a configuration error caught by code review (any `name:` in `infrastructure/server/sync/compose.yml`) rather than a runtime accident.

### D6. Cross-origin sync: relax `traefik-edge` same-origin requirement

**Decision.** The existing `traefik-edge` capability requires PWA + auth + CouchDB to share a hostname. The server-deploy topology breaks that — PWA on CF Pages (`tricho.app`, `dev.tricho.app`), sync on `sync.tricho.app`, `sync.dev.tricho.app`. Keep the existing requirement scoped to "single-host stack-orchestration profile". Add: when the PWA is hosted separately, the edge MUST set `Access-Control-Allow-Origin: https://<paired-pwa-host>` exactly (not `*`), `Access-Control-Allow-Credentials: true`, and `Vary: Origin`. Cookies set by `tricho-auth` MUST use `Domain=tricho.app` (registrable apex) + `SameSite=Lax` so they survive the cross-origin PWA → sync navigation.

**Why.** Same-origin was a simplification, not a security primitive — the security comes from JWT validation + entitlement gating in `tricho-auth`, not from the URL scheme. Cross-site sync subdomain is the standard pattern (`api.example.com` / `app.example.com`); deviating buys nothing.

**Alternatives considered.**
- *Tunnel sync requests through CF Pages worker → server* — adds Cloudflare to the data path, latency hit, and a new place where credentials can be observed. No.
- *Host PWA on the deploy server too* — duplicates the static-file serving CF Pages does for free, and forces co-locating cache headers logic in two places.

**Threat model delta.** Pre: same-origin meant the browser implicitly trusted the relationship; cookies were `SameSite=Strict`-eligible. Post: the relationship is explicit in `Access-Control-Allow-Origin` (allowlisted by environment) and `Domain=tricho.app` cookie scope. CSRF defense moves from "browser policy" to "explicit origin allowlist + JWT-bound CSRF token in `tricho-auth`'s state mutation routes" — this requirement is added to the `traefik-edge` modification.

### D7. SOPS+age remains the at-rest secret format; environment-scoped CI key

**Decision.** New profiles `secrets/sync-prod.sops.yaml`, `secrets/sync-dev.sops.yaml` (paralleling existing `dev`/`ci`). Each is recipient-encrypted to: the operator's age key, **and** a per-server age key (private file root-only on the deploy host, public in `.sops.yaml`). The deploy workflow injects `SOPS_AGE_KEY` from a GitHub **Environment secret** (`production` env: required reviewer; `dev` env: no review). At-rest in the runner workspace, the key file lives only for the duration of the render step, mode `0600`, in `.secrets-runtime/` which `make _render-secrets` populates.

**Why.** SOPS+age is the project standard; introducing Vault/Infisical for one new use case is unjustified. Environment secrets give the production deploy a human approval gate for free — repository secrets don't, they're granted by any workflow run. Per-server age keys mean revoking a compromised host doesn't require rotating every operator's local key.

**Alternatives considered.**
- *Repository secret `SOPS_AGE_KEY`* — simpler but loses the reviewer gate.
- *Inject decrypted secrets directly into env via `gh secret set`* — defeats the SOPS+age abstraction and tools.
- *On-host key fetch from a KV store at deploy time* — adds a dependency.

**Threat model delta.** Pre-this-design: there is no CI deploy at all; secrets only live on operator's laptop. Post: a `production`-scoped `SOPS_AGE_KEY` exists in GitHub. Mitigations: environment-scoped (not repo-scoped), reviewer-gated, encrypted in transit, written to disk only inside the runner's `_work/` (wiped each ephemeral run), and the workflow's `set -x` is forbidden in any step that can echo it.

### D8. Backup: restic primary, optional CouchDB replication secondary

**Decision.** Daily restic backup (host cron, not in-container) to off-site (B2 or rsync.net) of `/srv/tricho/{prod,dev}/couchdb/data` and `/srv/tricho/edge/acme`. Optional: continuous CouchDB `_replicator`-driven replication to a warm-standby CouchDB on a second box, one-way (production → standby). Monthly automated restore drill via a host cron that:

1. Spins up `COMPOSE_PROJECT_NAME=tricho-restoretest` from `infrastructure/server/sync/compose.yml`.
2. Restores the most recent restic snapshot into its data path.
3. Runs `couchdb-fauxton`'s integrity check + a few `_all_dbs` / `_session` smoke calls.
4. Tears down. Emails / Telegrams the operator on failure.

**Why.** Two-track because they cover orthogonal failure modes: restic recovers from "host died, restore from cold storage"; replication recovers from "user accidentally dropped a database" with second-level RPO. CouchDB's append-only on-disk format makes online file backup safe without quiescing. Untested backups are theoretical — the restore drill is what makes them real.

**Threat model delta.** Backups contain plaintext metadata (vaultId, docId, OAuth `sub`, `_users` table). MUST be encrypted at rest (restic does this with xchacha20-poly1305) and in transit (B2/rsync.net TLS). The restic password file lives only on the deploy host as a root-mode-0600 file; loss of the host means loss of decryptability — that's an explicit acceptance, restic password recovery is a human-side procedure documented in the runbook.

### D9. Deploy DoD: `--wait` + external smoke + data-path probe

**Decision.** A deploy step is "green" iff *all* of:
1. `docker compose up -d --wait --wait-timeout 60` exits 0 (every container's `healthcheck:` is healthy).
2. `curl -fsS https://sync.<env>.tricho.app/auth/health` returns 200 with a `X-Build-Sha` header matching the deploying SHA.
3. `curl -fsS -H "Authorization: Bearer <test-jwt>" https://sync.<env>.tricho.app/auth/_session` returns the expected JSON.

If any check fails, the deploy script restores `IMAGE_TAG=<previous-sha>` from `/opt/tricho/IMAGE_TAG.current` and re-`up`s. Only after a green deploy does the script overwrite `IMAGE_TAG.current` with the new SHA.

**Why.** The container healthcheck answers "is the process up?", which is necessary but not sufficient. The external smoke validates DNS + Traefik routing + cert validity end-to-end. The data-path probe validates that JWT validation + the proxy → CouchDB path actually works — the failure mode where everything is "healthy" but the proxy returns 502 to authed users would otherwise go undetected until a user complains.

**Alternatives considered.** Add Prometheus + alerting for richer signals — orthogonal to the deploy gate; can be added later in a separate change without revisiting this DoD.

## Risks / Trade-offs

- **[Risk] Runner-on-host means runner compromise → host compromise.** → Mitigated by D1 (ephemeral) + D2 (systemd hardening) + D3 (cosign verify) + private repo (no fork PRs). Residual risk: kernel CVE in the userns or Docker socket layer. Accepted; alternatives (cloud runner + SSH) move the credential rather than removing it.

- **[Risk] Single host = single failure domain.** → Mitigated by D8 (off-site backup, monthly restore drill). NOT mitigated for availability: a host outage takes both `prod` and `dev` sync down. Accepted for v1; the runbook documents how to add a second host without rework (DNS swap + restore from restic).

- **[Risk] cosign keyless + Sigstore root-of-trust availability.** → Sigstore has a transparent log (Rekor) and managed CA (Fulcio); both have had occasional outages. If Fulcio is down, the build job's `cosign sign` fails and we can't deploy. Mitigation: build job retries; emergency override via temporary `--insecure-ignore-tlog` flag is documented but requires a manual operator decision (not automatic).

- **[Risk] ACME rate limits during testing.** → 50 certs / domain / week, 5 dupes / week. Mitigation: ACME storage is a host directory bind (D4) so redeploy never re-issues; staging environment is `sync.dev.tricho.app` which is a different domain leaf, so rate-limit blast doesn't take prod down. Initial smoke testing uses LE staging CA via env-var override before swapping to production CA.

- **[Risk] CouchDB single-node restart blip.** → 1–3 second window where sync requests fail. Mitigation: PouchDB on the client retries cleanly; documented as feature ("≤5s sync pause during deploy"), not bug. CouchDB clustering is rejected (operational cost ≫ benefit at this scale).

- **[Risk] `_render-secrets` `PROFILE=` arg breaks existing developer flow.** → Mitigated by defaulting `PROFILE=dev` so `make dev | ci | prod-local` continues to work without operator change. Tested in `tasks.md`.

- **[Risk] Capability split between `traefik-edge` (local) and `server-stack-deploy` (server) duplicates middleware definitions.** → Accepted: middleware files are per-deployment (`infrastructure/traefik/dynamic/` for local, `infrastructure/server/edge/dynamic/` for server). Drift is bounded by code review. Alternative was a single shared dynamic config — rejected because the server profile needs cross-origin CORS rules that must NOT leak into the local same-origin profile.

- **[Trade-off] Docker socket bind into Traefik = root-equivalent.** Acceptable for the edge proxy that already needs to enumerate containers. Mitigated by `:ro` mount, no Docker API write paths in any Traefik config. Long-term option: Traefik with a socket-proxy sidecar (e.g. `tecnativa/docker-socket-proxy`); deferred to a separate change once observability is in place.

- **[Trade-off] Manual prod deploy is slower than auto-from-`main`.** Friction is intentional — every prod sync deploy is operator-acknowledged. Auto-from-`main` is a one-line change to add later if/when the operator wants it; reverting the other direction would be harder.

## Migration Plan

This is an additive change: nothing is being removed or behaviourally altered for existing users. Migration is purely build-out.

**Phase 0 — DNS & accounts (operator, manual, before any code merges).**
- Cloudflare DNS: `sync.tricho.app` and `sync.dev.tricho.app` A/AAAA records → `o3.tricho.app` IP.
- B2 bucket or rsync.net account for restic.
- Verify SSH access to `o3.tricho.app`.

**Phase 1 — Specs & docs (this change, no runtime impact).**
- Land OpenSpec proposal + new specs + modifications to `traefik-edge` and `secrets-management`.
- Land `docs/server-deploy.md` runbook.
- Land Makefile `_render-secrets PROFILE=` (default `dev` keeps existing flow working).

**Phase 2 — Host bootstrap (one-shot, manual).**
- `scp infrastructure/server/bootstrap.sh ubuntu@o3.tricho.app:/tmp/`.
- `ssh ubuntu@o3.tricho.app sudo bash /tmp/bootstrap.sh`.
- Verify `systemctl status actions.runner.beranku-tricho.app.o3.service` is active.
- Verify runner registered in GitHub Settings with label `o3.tricho.app`.

**Phase 3 — Per-server age key generation (manual).**
- On `o3.tricho.app`: `age-keygen -o /etc/sops/age/o3.key` (root-only, mode 0600).
- Copy public key into `.sops.yaml` (commit), reencrypt all SOPS files locally with `make secrets-rotate-age`.

**Phase 4 — Image build pipeline.**
- Land `.github/workflows/build-server-images.yml`.
- Trigger once via `workflow_dispatch`; verify GHCR has `tricho-auth` and `tricho-couchdb` packages with `:sha-<full>` tags + cosign signatures.

**Phase 5 — Edge bootstrap.**
- `gh workflow run server-bootstrap.yml -f RUNNER_LABEL=o3.tricho.app -f MODE=edge-up`.
- Verify `docker network ls | grep tricho-edge`, `docker compose -p tricho-edge ps` healthy.
- Verify `https://sync.dev.tricho.app/` returns Traefik 404 (no router yet) with a valid LE cert.

**Phase 6 — Dev deploy (first real workload).**
- Author a no-op commit to `dev`; push.
- `deploy-server.yml` runs automatically with `ENVIRONMENT=dev`.
- Verify all DoD checks pass; verify cross-origin login from `https://dev.tricho.app` (PWA) → `https://sync.dev.tricho.app/auth/...` works in browser.

**Phase 7 — Prod deploy.**
- `gh workflow run deploy-server.yml -f ENVIRONMENT=prod -f RUNNER_LABEL=o3.tricho.app`.
- Required-reviewer gate fires; operator approves.
- Verify all DoD checks pass; verify `https://tricho.app` end-to-end against `https://sync.tricho.app/...`.

**Phase 8 — Backup rollout.**
- Restic init (manual one-shot on host).
- Daily cron lands; verify next-day snapshot.
- First monthly restore drill cron runs; verify alert path on injected failure.

**Rollback strategy** (per phase, summarised — full detail in `proposal.md`):
- Phases 1–4: revert PRs. No runtime impact.
- Phase 5: `infrastructure/server/edge/down.sh` releases ports 80/443.
- Phase 6+: see proposal §"Rollback steps". Image rollback via `IMAGE_TAG.current` is the primary recovery path.

## Open Questions

- **Q1.** What's the off-site backup target — B2, rsync.net, or both? Cost difference is small; choosing now keeps the runbook concrete. *Default if undecided: rsync.net (operator already has an account; restic-friendly plan).*
- **Q2.** Continuous CouchDB replication to a warm standby — implement in v1 or defer? *Default: defer. Restic + monthly drill is sufficient first-week posture; replication adds an operational dependency that's easier to land later.*
- **Q3.** Image registry — GHCR is the default; is there appetite for an org-level pull-secret rotation policy? *Default: defer. The runner uses `GITHUB_TOKEN`, which is per-job ephemeral by construction.*
- **Q4.** `tricho-couchdb` image: is the wrapper image (which adds `tricho-entrypoint.sh`) worth shipping as its own GHCR package, or should the deploy host build it locally from the same Dockerfile against the upstream `couchdb:3` base? *Default: ship as a package, for symmetry with `tricho-auth` and to keep cosign verification uniform.*
- **Q5.** Should the `prod` GitHub Environment forbid pushes from any branch other than `main`? Today there are no such workflow-side branch restrictions. *Default: yes — add `deployment_branch_policy: { protected_branches: true }` on the `production` environment so a hand-edited workflow run can't deploy `dev` to prod by mistake.*
