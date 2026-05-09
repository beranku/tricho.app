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
- **Cloud-provider ingress for ports 80 and 443.** On Oracle Cloud, edit the VCN's Security List (or the instance's NSG) to add stateful ingress rules: `Source 0.0.0.0/0`, `IP Protocol TCP`, `Destination Port 80` and `443`. The host's own iptables/ufw rules are not enough on cloud providers that wrap the instance in a virtual firewall.
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

# 2) Mint a runner registration token (~1h TTL).
RUNNER_TOKEN=$(gh api -X POST \
  /repos/beranku/tricho.app/actions/runners/registration-token \
  --jq .token)

# 3) Run bootstrap on the host.
ssh ubuntu@$HOST "sudo RUNNER_REGISTRATION_TOKEN='$RUNNER_TOKEN' bash /tmp/tricho-server/bootstrap.sh"
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

If `.runner` / `.credentials` files were lost, re-mint a registration token (`gh api -X POST .../actions/runners/registration-token --jq .token`) and re-run `install-runner.sh` with `RUNNER_REGISTRATION_TOKEN=<token>` to re-configure.

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

### Verifying cross-origin login from a real browser

End-to-end test through Google's identity provider, no PWA install required:

1. Open `https://dev.tricho.app/app/` (or `https://tricho.app/app/` for prod). The welcome wizard should render in <1 s. If it stays stuck on "Loading keystore…", the PWA's CSP at `_headers` line 86–87 is rejecting Astro's inline hydration scripts — see "CSP must allow inline scripts in /app/*" in the gotchas.
2. Skip the install gate by navigating directly to `https://sync.dev.tricho.app/auth/google/start`. The browser should follow a 302 to `https://accounts.google.com/...` showing "Sign in — to continue to **tricho.app**". The query string MUST contain the right `client_id`, `redirect_uri`, `code_challenge` (PKCE), `state`, `nonce`.
3. Optionally complete sign-in. After Google redirects back to `https://sync.dev.tricho.app/auth/google/callback`, `tricho-auth` validates the code, exchanges for an ID token, and 302s the user to `https://dev.tricho.app/app/#auth=...`. The PWA's `consumePendingOAuthResult()` reads the hash, sets a session cookie with `Domain=tricho.app`, `SameSite=Lax`, and the welcome wizard advances to Step 3 (Encryption). If anything in this chain breaks, the most common culprits are: `redirect_uri` mismatch with what's whitelisted in Google Cloud Console; CSP `connect-src` not allowing the sync host; cookie `Domain` not covering both PWA and sync hosts.

### Verifying OAuth wiring without a browser

After populating `GOOGLE_CLIENT_ID` (in `infrastructure/server/sync/config/<env>/.env`) and `google_client_secret` (via `make secrets-edit PROFILE=sync-<env>`) and redeploying, you can confirm the OAuth wiring is correct from the command line:

```bash
curl -sS -D - -o /dev/null https://sync.dev.tricho.app/auth/google/start | head -10
```

Expected: HTTP 302 with a `location:` header pointing at `https://accounts.google.com/o/oauth2/v2/auth?…`. The query string MUST contain:

- `client_id` — matches your Google Cloud Console OAuth client ID
- `redirect_uri=https%3A%2F%2Fsync.<env>.tricho.app%2Fauth%2Fgoogle%2Fcallback` (URL-encoded; must match the Authorized redirect URI you whitelisted in the Console exactly)
- `state`, `nonce`, `code_challenge` (CSRF + replay + PKCE protection)
- `scope=openid+email+profile`, `response_type=code`

If `client_id` is wrong or absent, the env render is broken — check that `make _render-secrets PROFILE=sync-<env>` writes a non-empty `.secrets-runtime/google_client_secret`. If `redirect_uri` doesn't match what's in the Google Console, Google will return `redirect_uri_mismatch` after the user signs in — fix in the Console (single-client setups should list all four sync host URIs).

### Known shakedown gotchas (recorded May 2026)

These are the issues that surfaced during the first dev deployment to `o3.tricho.app`. The bootstrap scripts and workflows now handle them — captured here so a future operator hitting the same symptom can recognize it.

- **Cloud-provider VCN ingress** must allow tcp/80 + tcp/443 on the subnet — the host's iptables/ufw rules are not enough on Oracle Cloud (or any provider that wraps the instance in a virtual firewall). Symptom: `curl https://sync.<env>.tricho.app/` times out, but `curl http://localhost/` from the host works. Fix in the cloud console, not on the host.
- **Docker Engine 29.x raised the minimum API version to 1.40**. Traefik v3.x's embedded Docker SDK negotiates v1.24, so the docker provider fails with "client version 1.24 is too old". `install-host.sh` now writes `"min-api-version": "1.24"` to `/etc/docker/daemon.json` to keep older clients working. Drop this when Traefik ships a newer SDK.
- **macOS `._*` AppleDouble files leak into bind mounts** when transferring the bootstrap tree from a Mac via `tar` over SSH. Traefik's file provider then chokes ("yaml: control characters are not allowed") and the entire dynamic config fails to load. `infrastructure/server/edge/up.sh` should keep the dynamic dir clean. If you hit this, `sudo rm -f /tmp/tricho-bootstrap/infrastructure/server/edge/dynamic/._*` and recreate.
- **`PrivateTmp=yes` on the runner systemd unit** isolates `/tmp`, but processes spawned via `make`/`bash` subshells sometimes see "mktemp: No such file or directory". The deploy workflow pins `TMPDIR=${runner.temp}` so secret rendering survives.
- **Runner version churn**: GitHub deprecates `actions/runner` versions on a ~30-day cadence. v2.323.0 was rejected on first registration with "version is deprecated and cannot receive messages." Keep `infrastructure/server/runner-version.txt` current via Renovate or manual review.
- **HEAD requests to `/auth/health` return 404**. tricho-auth's router only handles GET; a `curl -I` smoke test from the operator's laptop will mislead. The deploy workflow's `smoke.sh` uses `curl -fsS` (GET) which works correctly.
- **Compose `name:` on `external: true` networks/volumes** is required to refer to externally-managed resources (the `tricho-edge` network in our case). The `infrastructure-lint` script knows to allow this and only flags `name:` on internal resources.
- **PWA "Loading keystore…" stuck on first cross-origin deploy.** The `/app/*` Content-Security-Policy in `_headers` originally listed `script-src 'self' 'wasm-unsafe-eval'` (no `'unsafe-inline'`), which silently blocked Astro Islands' four inline `<script>` blocks (SW reg, theme/locale bootstrap, `window.Astro` setup, `astro-island` custom element definition). With those blocked, hydration never started and the SSR fallback "Loading keystore…" stayed on screen forever. CSP must include `'unsafe-inline'` for `script-src` until a nonce/hash-based migration ships, AND `connect-src` must include both sync hosts so the PWA can credentialed-fetch cross-origin against `sync.tricho.app` / `sync.dev.tricho.app`. The bug was visible in the browser only as a stuck loading state; CSP violations went to the console (which is sometimes blocked by aggressive privacy extensions, so first-symptom is just the static text).
- **`indexedDB.open(db_name)` without a version** silently creates the DB at version 1 with no object stores and races with the app's `indexedDB.open(db_name, DB_VERSION)` call, leaving the DB in an inconsistent state where transactions throw `NotFoundError: One of the specified object stores was not found`. The error is caught by the app's outer `try/catch` so the welcome flow still renders, but client-side keystore is broken. Fix in browser: DevTools → Application → Storage → "Clear site data" → reload. Hardening idea: add an `onblocked` handler to `openKeyStoreDb` so future debug snippets can't race-create.

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
