## ADDED Requirements

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

#### Scenario: CI runs a SOPS decrypt
- GIVEN the `e2e` workflow with `SOPS_AGE_KEY` configured
- WHEN the "decrypt secrets" step runs
- THEN `sops --decrypt secrets/ci.sops.yaml` succeeds
- AND the subsequent `up -d` step finds `/run/secrets/*` populated in each container

#### Scenario: A dropped secret fails the job visibly
- GIVEN the `SOPS_AGE_KEY` secret is unset on the runner
- WHEN the decrypt step runs
- THEN the job exits with a clear "no age key available" message
- AND no container is started

### Requirement: Rotation and audit are documented procedures
The repository MUST document in `secrets/README.md` how to (a) onboard a new developer (generate age key, append public key to `.sops.yaml`, run `secrets-rotate-age`), (b) offboard a developer (remove their public key, rotate every encrypted file, rotate every downstream secret value), and (c) rotate a single secret (e.g., CouchDB admin password) including the follow-up `docker compose restart` commands.

#### Scenario: Offboarding leaves no residual access
- GIVEN the offboarding procedure has been followed for recipient `alice`
- WHEN `sops` is used with alice's old age key
- THEN no file under `secrets/` can be decrypted
- AND the audit log entry (commit message on the rotation commit) references the removed recipient
