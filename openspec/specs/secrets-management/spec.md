# secrets-management Specification

## Purpose

The contract for how TrichoApp stores, distributes, and rotates long-lived secrets. Encrypts everything at rest in the repo via SOPS + age, delivers it to containers as file-mounted Docker secrets at runtime, and documents key onboarding/offboarding/rotation so an operator never has to reverse-engineer the flow. Secrets in plaintext `.env` files — committed or otherwise — are explicitly disallowed.

Source files: `.sops.yaml`, `secrets/`, `secrets/README.md`, `secrets/dev.fallback.env`, `Makefile` (`_render-secrets`).

## Requirements

### Requirement: SOPS + age is the only at-rest secret format
Every secret committed to the repository MUST be encrypted with SOPS using age recipients. Plain-text secrets in `.env*` files MUST NOT be committed. The repository MUST contain a `.sops.yaml` creation-rules file that maps `secrets/*.sops.yaml` to the set of age recipient public keys allowed to decrypt it.

#### Scenario: CI fails on a leaked plaintext secret
- GIVEN a commit that adds a plaintext `.env` with `COUCHDB_PASSWORD=…` at the repo root or under `infrastructure/`
- WHEN CI runs the `secrets-lint` step
- THEN the step exits non-zero and names the offending file and line

#### Scenario: A new recipient rotation updates every secret
- GIVEN `make secrets-rotate-age` is run after editing `.sops.yaml`
- WHEN it finishes
- THEN every file matched by the rotation rules has been re-encrypted to the new recipient set
- AND `sops --decrypt` of each file still returns the original plaintext

### Requirement: Runtime delivery uses Docker Compose `secrets:`
Secrets with long lifetimes (`COUCHDB_PASSWORD`, `GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_SECRET`, JWT private key, cookie HMAC secret) MUST be delivered to containers as file-mounted Docker secrets under `/run/secrets/*`, not as environment variables. Services MUST read them via file path; any environment variable used for a secret is a bug.

#### Scenario: Inspecting container env shows no secret material
- GIVEN the stack running with any profile
- WHEN `docker inspect tricho_auth | jq '.[].Config.Env'` is executed
- THEN none of the above secret values appears in the list
- AND `ls /run/secrets/` inside the container shows the expected file set

#### Scenario: tricho-auth reads the JWT private key from a file
- GIVEN `TRICHO_AUTH_JWT_PRIVATE_KEY_PATH=/run/secrets/jwt_private.pem`
- WHEN `tricho-auth` starts
- THEN it loads the PEM from that path
- AND does not fall back to the in-memory generator

### Requirement: Local age key path is documented and enforced
The developer's age private key MUST live at `~/.config/sops/age/keys.txt` (Linux/macOS) or `%AppData%/sops/age/keys.txt` (Windows), matching the SOPS default lookup. The `Makefile` MUST check for the file's existence before any target that requires decryption and fail with a message pointing at the setup docs.

#### Scenario: Missing local key blocks `make dev`
- GIVEN a developer without `~/.config/sops/age/keys.txt`
- WHEN they run `make dev`
- THEN the target aborts before invoking `docker compose`
- AND stderr includes the expected path and the `make secrets-onboard` follow-up command

### Requirement: CI decryption uses the `SOPS_AGE_KEY` environment variable

CI workflows MUST inject the age private key material via the `SOPS_AGE_KEY` GitHub Actions secret. The key MUST NOT be written to the filesystem in plain form longer than the job step that consumes it, and it MUST NOT be echoed into workflow logs (no `set -x`, no `echo $SOPS_AGE_KEY`).

For workflows that deploy to the `production` server-deploy environment, `SOPS_AGE_KEY` MUST be a **GitHub Environment secret** scoped to the `production` environment (which carries a required-reviewer protection rule), NOT a repository secret. For workflows that deploy to the `dev` server-deploy environment, `SOPS_AGE_KEY` MUST be a Github Environment secret scoped to the `dev` environment. The secret value used for `dev` deploys MAY be different from the one used for `production` deploys (and SHOULD be, when the per-server age keypair model in "Per-server age keypair for deploy hosts" is used). For non-deploy workflows (e.g., the `e2e` workflow that decrypts `secrets/ci.sops.yaml`), `SOPS_AGE_KEY` MAY remain a repository-scoped secret.

#### Scenario: CI runs a SOPS decrypt

- **GIVEN** the `e2e` workflow with `SOPS_AGE_KEY` configured as a repository secret
- **WHEN** the "decrypt secrets" step runs
- **THEN** `sops --decrypt secrets/ci.sops.yaml` succeeds
- **AND** the subsequent `up -d` step finds `/run/secrets/*` populated in each container

#### Scenario: A dropped secret fails the job visibly

- **GIVEN** the `SOPS_AGE_KEY` secret is unset on the runner
- **WHEN** the decrypt step runs
- **THEN** the job exits with a clear "no age key available" message
- **AND** no container is started

#### Scenario: Production deploy requires the environment-scoped key

- **GIVEN** the `deploy-server.yml` workflow dispatched for `ENVIRONMENT=prod`
- **WHEN** the workflow attempts to enter the `production` environment
- **THEN** the `production` environment's required-reviewer rule fires before any decrypt runs
- **AND** `SOPS_AGE_KEY` is read from the `production` environment's secret store, not the repository's
- **AND** the same workflow file dispatched for `ENVIRONMENT=dev` reads `SOPS_AGE_KEY` from the `dev` environment's secret store instead

#### Scenario: A workflow attempting to read the prod key from outside the prod environment fails

- **GIVEN** a workflow run that does NOT declare `environment: production`
- **WHEN** it tries to access `secrets.SOPS_AGE_KEY` in a context where only the `production` environment scope holds the value
- **THEN** the secret resolves to empty
- **AND** any subsequent decrypt step fails with "no age key available" before any container is started

### Requirement: New SOPS profiles for server-deploy environments

The repository MUST contain `secrets/sync-prod.sops.yaml` and `secrets/sync-dev.sops.yaml`, encrypted to the recipients listed in `.sops.yaml` for each profile. Each file MUST hold the full server-side runtime secret set: `couchdb_password`, `cookie_secret`, `jwt_private_pem`, `google_client_secret`, `apple_client_secret`, plus any Stripe credentials configured for that environment. The `Makefile`'s `_render-secrets` target MUST accept a `PROFILE=` argument so a deploy step can request rendering of one specific profile (e.g., `make _render-secrets PROFILE=sync-prod`); when `PROFILE=` is omitted, the target MUST default to `dev` so existing developer workflows (`make dev | ci | prod-local`) continue to work unchanged.

#### Scenario: Render produces the prod sync set

- **GIVEN** an operator (or the deploy workflow) running `make _render-secrets PROFILE=sync-prod`
- **WHEN** the target completes
- **THEN** `.secrets-runtime/couchdb_password`, `.secrets-runtime/cookie_secret`, `.secrets-runtime/jwt_private_pem`, etc., exist with mode `0600`
- **AND** their contents match the decrypted values from `secrets/sync-prod.sops.yaml`
- **AND** no values from `secrets/sync-dev.sops.yaml` or any other profile have leaked into the rendered files

#### Scenario: Default PROFILE preserves existing developer flow

- **GIVEN** a developer running `make dev` on a clean checkout
- **WHEN** the make pipeline reaches `_render-secrets`
- **THEN** the target renders the `dev` profile (no `PROFILE=` argument needed)
- **AND** `make ci`, `make prod-local`, and `make e2e` likewise resolve to their existing behavior with no per-target flag changes

### Requirement: Per-server age keypair for deploy hosts

Each production deploy host MUST own a unique age keypair. The private key MUST live on the host at `/etc/sops/age/<hostname>.key` (mode `0600`, owned by root) — never copied off the host, never committed, never echoed to logs. The corresponding public key MUST be added to `.sops.yaml` as a recipient on the relevant `secrets/sync-*.sops.yaml` creation rules. When a host is decommissioned, its public key MUST be removed from `.sops.yaml` AND every encrypted file MUST be re-encrypted via `make secrets-rotate-age` so the decommissioned host's private key no longer decrypts any secret.

#### Scenario: Host can decrypt its own secrets

- **GIVEN** the `o3.tricho.app` host with `/etc/sops/age/o3.tricho.app.key` present
- **WHEN** the deploy workflow's render step runs with `SOPS_AGE_KEY_FILE=/etc/sops/age/o3.tricho.app.key`
- **THEN** `sops --decrypt secrets/sync-prod.sops.yaml` and `secrets/sync-dev.sops.yaml` both succeed
- **AND** the rendered runtime files match expected values

#### Scenario: Decommissioned host cannot decrypt after rotation

- **GIVEN** the operator has decommissioned a host, removed its public key from `.sops.yaml`, and run `make secrets-rotate-age`
- **WHEN** an attacker who copied the decommissioned host's private key tries `sops --decrypt secrets/sync-prod.sops.yaml`
- **THEN** decryption fails with "no key could decrypt the data"
- **AND** rotating downstream secret values (the remediation step) is documented in the runbook

### Requirement: Rotation and audit are documented procedures
The repository MUST document in `secrets/README.md` how to (a) onboard a new developer (generate age key, append public key to `.sops.yaml`, run `secrets-rotate-age`), (b) offboard a developer (remove their public key, rotate every encrypted file, rotate every downstream secret value), and (c) rotate a single secret (e.g., CouchDB admin password) including the follow-up `docker compose restart` commands.

#### Scenario: Offboarding leaves no residual access
- GIVEN the offboarding procedure has been followed for recipient `alice`
- WHEN `sops` is used with alice's old age key
- THEN no file under `secrets/` can be decrypted
- AND the audit log entry (commit message on the rotation commit) references the removed recipient
