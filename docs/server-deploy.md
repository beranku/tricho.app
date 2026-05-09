# Server-side deploy runbook

How tricho.app's server-side stack — `tricho-auth` proxy + CouchDB + the shared edge Traefik — gets onto a real production host. Behavioural specs live under `openspec/specs/server-host-bootstrap/`, `server-image-pipeline/`, `server-stack-deploy/`, `server-backup-restore/`, `traefik-edge/`, and `secrets-management/`.

The frontend (PWA + marketing site) is **not** covered here. It ships continuously to Cloudflare Pages — see `docs/build-and-deploy.md`.

## Topology at a glance

```
┌────────────────── Cloudflare Pages (frontend) ──────────────────┐
│   tricho.app  ←→  dist (PWA + web)                              │
│   dev.tricho.app  ←→  dist (dev branch)                         │
└─────────────────────────────────────────────────────────────────┘
                            │ cross-origin fetch
                            ▼
┌────────────────── Deploy host (e.g. o3.tricho.app) ─────────────┐
│  ┌────────────── docker compose project: tricho-edge ────────┐  │
│  │   Traefik v3 (Let's Encrypt, :80/:443)                    │  │
│  │   external network: tricho-edge                           │  │
│  │   ACME bind: /srv/tricho/edge/acme/                       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                    │ tricho-edge network                        │
│  ┌─────────── tricho-sync-prod ─────────┬──── tricho-sync-dev ─┐│
│  │ tricho-auth → couchdb (private net)  │  same shape, dev env ││
│  │ Host: sync.tricho.app                │  Host: sync.dev.…    ││
│  │ data: /srv/tricho/prod/couchdb/data  │  /srv/tricho/dev/…   ││
│  └──────────────────────────────────────┴──────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

The PWA on Cloudflare Pages reaches the sync stack across origins (`tricho.app` ↔ `sync.tricho.app`) — same registrable site, different origin. CORS + cookie scope are configured for that pattern; see `openspec/specs/traefik-edge/spec.md`.

## Prerequisites

Before bootstrapping the first host:

- A deploy host: Ubuntu 24.04 ARM64, SSH-reachable, with a fully-qualified hostname (e.g., `o3.tricho.app`). 4 GB+ RAM, 40 GB+ disk.
- DNS records under your control:
  - `sync.tricho.app` A/AAAA → host IP
  - `sync.dev.tricho.app` A/AAAA → host IP
  - The host's hostname must resolve too (for Let's Encrypt's HTTP-01 challenge to work).
- Operator's age private key at `~/.config/sops/age/keys.txt` (the one that already decrypts `secrets/dev.sops.yaml`).
- A `gh` CLI session authenticated for the `beranku` org with `repo, admin:org` scopes — needed to mint runner JIT tokens and to set GitHub Environment secrets.
- An off-site backup target — Backblaze B2 bucket or rsync.net account. Decide before §"Backup + restore".

## First-run host bootstrap (manual SSH)

The host has no GitHub Actions runner yet, so bootstrap goes via SSH. Once the runner exists, future re-bootstraps run through the `server-bootstrap.yml` workflow.

```bash
# From the operator's laptop, in this repository.
HOST=o3.tricho.app

# 1) Copy the bootstrap into /tmp on the host.
rsync -avz --delete \
  infrastructure/server/ \
  ubuntu@$HOST:/tmp/tricho-server/

# 2) Mint a JIT runner registration token (1h TTL, single-use).
JITCONFIG=$(gh api -X POST \
  /repos/beranku/tricho.app/actions/runners/generate-jitconfig \
  -f name="$HOST" \
  -f labels="[\"$HOST\"]" \
  -f runner_group_id=1 \
  --jq .encoded_jit_config)

# 3) Run bootstrap on the host.
ssh ubuntu@$HOST "sudo RUNNER_JIT_CONFIG='$JITCONFIG' bash /tmp/tricho-server/bootstrap.sh"
```

Verify:

```bash
ssh ubuntu@$HOST 'systemctl is-active actions.runner.beranku-tricho.app.*.service'   # → active
gh api /repos/beranku/tricho.app/actions/runners --jq '.runners[] | select(.name=="o3.tricho.app")'
```

The runner registers with label `<hostname>` and runs in `--ephemeral` mode — each completed job exits and re-registers.

## Per-server age key

Each deploy host owns a unique age keypair. Private key root-only on the host; public key added to `.sops.yaml` and committed.

```bash
# On the host (one-shot, requires root).
ssh ubuntu@$HOST 'sudo install -d -m 0700 /etc/sops/age && sudo age-keygen -o /etc/sops/age/o3.tricho.app.key && sudo chmod 0600 /etc/sops/age/o3.tricho.app.key'

# Read the public key.
ssh ubuntu@$HOST 'sudo grep "# public key:" /etc/sops/age/o3.tricho.app.key | sed "s/.*: //"'
# → age1xxx…

# Locally, in this repo: paste the public key into .sops.yaml under both
# secrets/sync-prod.sops.yaml and secrets/sync-dev.sops.yaml rules.
$EDITOR .sops.yaml
make secrets-rotate-age      # re-encrypts every existing SOPS file with the new recipient set
git commit -am "ops: add o3.tricho.app age recipient"
```

If the host is ever decommissioned, remove its public key from `.sops.yaml`, re-run `make secrets-rotate-age`, then rotate any downstream secret value the host knew.

## Edge bootstrap

The shared `tricho-edge` Traefik runs as its own compose project, persistent across stack deploys.

```bash
gh workflow run server-bootstrap.yml \
  -f RUNNER_LABEL=o3.tricho.app \
  -f MODE=edge-up
```

Verify:

```bash
ssh ubuntu@$HOST 'docker compose -p tricho-edge ps'
# → traefik   running (healthy)

# DNS + cert sanity (each subdomain hits the edge):
curl -I https://sync.dev.tricho.app/      # → 404 from Traefik (no router yet) but valid LE cert
curl -I https://sync.tricho.app/          # → ditto
```

If the cert isn't issued, check Traefik logs:

```bash
ssh ubuntu@$HOST 'docker compose -p tricho-edge logs --tail=200 traefik'
```

For staging (avoid LE prod rate limits during fixup), set `TRAEFIK_USE_LE_STAGING=1` in the workflow input.

## Dev deploy walkthrough

Push to `dev` triggers `deploy-server.yml` automatically with `ENVIRONMENT=dev`.

```bash
git switch dev
git commit --allow-empty -m "deploy: dev sync redeploy"
git push
```

Watch the workflow:

```bash
gh run watch
```

The deploy step's Definition of Done (three gates) all live in the workflow output:

1. `docker compose up -d --wait --wait-timeout 60` — every service healthy.
2. `curl -fsS https://sync.dev.tricho.app/auth/health` returns 200 with `X-Build-Sha:` matching the deploying SHA.
3. JWT-authed data-path probe.

Browser smoke: open `https://dev.tricho.app/app/`, log in, watch the network tab show requests against `https://sync.dev.tricho.app/auth/...` succeeding with credentialed CORS.

## Prod deploy walkthrough

Production deploys are manual only. There is no auto-deploy on push to `main`.

```bash
gh workflow run deploy-server.yml \
  -f ENVIRONMENT=prod \
  -f RUNNER_LABEL=o3.tricho.app
```

The `production` GitHub Environment carries a required-reviewer gate; the run pauses for operator approval before the deploy job touches the host. After approval the same three DoD gates run.

Confirm the dev stack is unaffected:

```bash
ssh ubuntu@$HOST 'docker compose -p tricho-sync-dev ps'   # still healthy
```

## Rollback

The deploy step caches the previously-successful SHA in `/opt/tricho/IMAGE_TAG.<env>.current` on the host. On a failed deploy, the script restores this SHA and re-`up`s automatically; the workflow run still ends in failure, and the stack is in its prior-known-good state.

Manual rollback (no failed deploy in flight, just want to revert):

```bash
ssh ubuntu@$HOST 'cat /opt/tricho/IMAGE_TAG.prod.current'
# pick a known-good SHA from git log

gh workflow run deploy-server.yml \
  -f ENVIRONMENT=prod \
  -f RUNNER_LABEL=o3.tricho.app \
  -f IMAGE_REF=sha-<full-good-sha>
```

Image tags in GHCR are immutable, so the rollback target is guaranteed to still exist.

## Secrets rotation

A single secret value (e.g., `couchdb_password`) rotates per the existing project flow:

```bash
make secrets-edit PROFILE=sync-prod
# edit the value, save, exit. SOPS re-encrypts on save.
git commit -am "ops: rotate sync-prod couchdb_password"
git push
```

On next deploy the new value lands on the host. CouchDB needs a restart to pick up `couchdb_password`; the deploy's `up -d` does this automatically. For an immediate rotation without waiting for a deploy:

```bash
gh workflow run deploy-server.yml -f ENVIRONMENT=prod -f RUNNER_LABEL=o3.tricho.app
```

Per-recipient rotation (when adding/removing an age recipient) goes through `make secrets-rotate-age` — see `docs/secrets.md`.

## Adding a second host

Capacity outgrows one host, or you want isolation between dev and prod, or a warm-standby. The bootstrap is host-symmetric:

1. Provision the new host (Ubuntu 24.04 ARM64, DNS, SSH).
2. SSH bootstrap as in §"First-run host bootstrap" but with the new hostname (e.g., `o4.tricho.app`).
3. Generate per-host age key, add public key to `.sops.yaml`, `make secrets-rotate-age`.
4. Re-point DNS for whichever environment(s) the new host serves (e.g., `sync.tricho.app` → new host IP). Existing certs migrate via fresh ACME issuance on the new host.
5. Fire `gh workflow run deploy-server.yml -f RUNNER_LABEL=<new-host>` and validate.
6. Tear down the old environment on the original host: `ssh oldhost 'sudo bash infrastructure/server/sync/down.sh prod'`.

## Backup + restore

### Off-site target

Pick one — the runbook supports both:

- **Backblaze B2** — pay-per-GB, no minimum, restic-friendly. Cheapest for small data.
- **rsync.net** — flat fee, restic on a special low-cost plan. Already used by some operators.

Provision the bucket / account out-of-band. Record credentials on the host:

```bash
ssh ubuntu@$HOST 'sudo install -d -m 0700 /etc/tricho && sudo $EDITOR /etc/tricho/restic-creds.env'
# B2 example:
#   B2_ACCOUNT_ID=...
#   B2_ACCOUNT_KEY=...
#   RESTIC_REPOSITORY=b2:tricho-backup:o3
# rsync.net example:
#   RESTIC_REPOSITORY=sftp:tricho@xxx.rsync.net:tricho-backup
```

### Restic password

```bash
ssh ubuntu@$HOST 'sudo bash -c "openssl rand -hex 32 > /etc/tricho/restic.pw && chmod 0600 /etc/tricho/restic.pw"'
ssh ubuntu@$HOST 'sudo cat /etc/tricho/restic.pw'
# COPY this value into your password manager. Losing it loses the backups.

ssh ubuntu@$HOST 'sudo bash -c "set -a; . /etc/tricho/restic-creds.env; restic --password-file /etc/tricho/restic.pw init"'
```

### Backup sensitivity

**Backups contain plaintext metadata** even though user payloads are ciphertext: `vaultId`, `docId`, OAuth `sub` claims, the CouchDB `_users` table, sizes, revision counts. The project's zero-knowledge claim covers payload bodies, not metadata. Treat the restic password and off-site credentials with the same sensitivity as the SOPS age private keys: stored only on the deploy host, mode `0600`, root-owned, never committed, never echoed to logs.

### Daily snapshot + retention

The bootstrap installs `/etc/cron.daily/tricho-backup`. Verify the next-day snapshot:

```bash
ssh ubuntu@$HOST 'sudo bash -c "set -a; . /etc/tricho/restic-creds.env; restic --password-file /etc/tricho/restic.pw snapshots --latest 5"'
```

Retention policy: 30 daily, 12 monthly, 2 yearly snapshots (`forget --keep-daily 30 --keep-monthly 12 --keep-yearly 2 --prune`).

### Monthly restore drill

`/etc/cron.monthly/tricho-restore-drill` validates restorability into a throwaway `tricho-restoretest` compose project. Failure paths the operator via the existing notification channel (email or Telegram). Run it manually once after install to confirm green-path:

```bash
ssh ubuntu@$HOST 'sudo /etc/cron.monthly/tricho-restore-drill'
```

## Troubleshooting

### Traefik logs are noisy / I want to find one host's traffic

Access logs are JSON. Filter:

```bash
ssh ubuntu@$HOST 'docker compose -p tricho-edge logs --tail=10000 traefik | jq -r "select(.RouterName | contains(\"sync.tricho.app\"))"'
```

Cookies and `Authorization` headers are redacted in access logs by middleware.

### Let's Encrypt rate-limit hit

Symptoms: `acme: error: 429 :: urn:ietf:params:acme:error:rateLimited`. ACME state lives in `/srv/tricho/edge/acme/` — never delete it. If you need to test cert issuance without consuming the prod rate limit:

```bash
gh workflow run server-bootstrap.yml -f RUNNER_LABEL=o3.tricho.app -f MODE=edge-up
# After setting TRAEFIK_USE_LE_STAGING=1 in the relevant config — see edge/up.sh.
```

### Runner stuck / not picking up jobs

```bash
ssh ubuntu@$HOST 'systemctl status actions.runner.beranku-tricho.app.*.service'
ssh ubuntu@$HOST 'sudo journalctl --namespace=ghrunner -u actions.runner.beranku-tricho.app.* -n 200'
```

If the runner won't re-register, the JIT token may have expired (1h TTL). Re-mint and re-bootstrap the runner via SSH (the runner-only path of `bootstrap.sh`).

### CouchDB stuck or unhealthy

```bash
ssh ubuntu@$HOST 'docker compose -p tricho-sync-prod logs --tail=200 couchdb'
ssh ubuntu@$HOST 'docker compose -p tricho-sync-prod exec couchdb curl -sf http://localhost:5984/_up'
```

CouchDB 3 storage is append-only; abrupt restarts are safe. Data is at `/srv/tricho/<env>/couchdb/data/` — surveying that path with `du -sh` gives a fast size sanity check.

### Cross-origin login fails in browser

Check that:

- `Access-Control-Allow-Origin: https://<paired-pwa-host>` (exact, not `*`) is on the response.
- `Access-Control-Allow-Credentials: true` is on the response.
- The cookie set by `tricho-auth` has `Domain=tricho.app`, `Secure`, `HttpOnly`, `SameSite=Lax`.

The Traefik file-provider middleware `tricho-cors-<env>@file` is what sets the CORS headers — see `infrastructure/server/edge/dynamic/middlewares.yml`.

### Deploy DoD smoke probe fails on `X-Build-Sha`

The header is emitted by `tricho-auth`'s `/health` route from the `IMAGE_TAG` env. If the header is absent, the running image was built before the X-Build-Sha change shipped — redeploy with the latest SHA.

### Force a fresh ACME order (last resort)

Only when you've already confirmed it's safe to consume the rate limit:

```bash
ssh ubuntu@$HOST 'sudo rm /srv/tricho/edge/acme/acme.json'
gh workflow run server-bootstrap.yml -f RUNNER_LABEL=o3.tricho.app -f MODE=edge-up
```

## Related docs

- `docs/build-and-deploy.md` — frontend (Cloudflare Pages) deploy.
- `docs/secrets.md` — SOPS + age workflow, recipient rotation.
- `secrets/README.md` — operator-side secret onboarding.
- `openspec/specs/server-host-bootstrap/spec.md` — host setup contract.
- `openspec/specs/server-image-pipeline/spec.md` — GHCR + cosign contract.
- `openspec/specs/server-stack-deploy/spec.md` — deploy lifecycle + DoD.
- `openspec/specs/server-backup-restore/spec.md` — backup contract.
- `openspec/specs/traefik-edge/spec.md` — edge proxy contract (single-host AND server-deploy variants).
