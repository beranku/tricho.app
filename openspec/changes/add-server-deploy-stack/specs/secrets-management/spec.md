## MODIFIED Requirements

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

## ADDED Requirements

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
