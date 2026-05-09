## ADDED Requirements

### Requirement: Server-side images published to GHCR under the project namespace

The repository MUST publish two server-side container images to GHCR:
- `ghcr.io/beranku/tricho-auth` — built from `infrastructure/couchdb/tricho-auth/Dockerfile`.
- `ghcr.io/beranku/tricho-couchdb` — built from `infrastructure/couchdb/Dockerfile`.

Both packages MUST be linked to the `beranku/tricho.app` repository for visibility and `GITHUB_TOKEN`-based pull authentication. Images MUST NOT be pushed to Docker Hub or any other registry. The PWA image is OUT of scope for this pipeline (PWA ships to Cloudflare Pages).

#### Scenario: Both packages exist in GHCR after first build

- **GIVEN** the `build-server-images.yml` workflow run on `main`
- **WHEN** the run completes
- **THEN** `https://ghcr.io/v2/beranku/tricho-auth/manifests/sha-<sha>` returns 200 with a manifest
- **AND** `https://ghcr.io/v2/beranku/tricho-couchdb/manifests/sha-<sha>` likewise

#### Scenario: PWA image is not built by this pipeline

- **GIVEN** the `build-server-images.yml` workflow definition
- **WHEN** the workflow file is read
- **THEN** no job builds an image whose source includes `infrastructure/pwa/Dockerfile`
- **AND** no `ghcr.io/beranku/tricho-pwa` package exists

### Requirement: Immutable SHA tag is the only deploy-consumable tag

Each image build MUST tag with `sha-<full-git-sha>` (40-character hex). This tag MUST be treated as immutable — the build workflow MUST refuse to overwrite an existing `sha-<sha>` tag for the same repository (re-running the workflow on the same commit MUST detect the prior tag and exit success without re-pushing). The build MAY additionally apply mutable aliases `dev` (on `dev` branch builds) and `prod` (on `main` branch builds) for human browsing only. Deploy workflows MUST consume only `sha-<sha>` tags; deploys against `dev`, `prod`, or `latest` aliases MUST be rejected.

#### Scenario: Re-running a build for the same SHA is a no-op

- **GIVEN** an image already pushed for commit `abc123…`
- **WHEN** the build workflow re-runs on the same SHA
- **THEN** the workflow detects the existing tag and exits 0
- **AND** no new manifest is pushed
- **AND** no Sigstore log entry is added

#### Scenario: Deploy step rejects a mutable tag

- **GIVEN** an operator dispatches `deploy-server.yml` with `IMAGE_REF=dev`
- **WHEN** the deploy step validates the image reference
- **THEN** the deploy aborts with a clear error naming the rejected tag and the required `sha-<full-sha>` form

### Requirement: Cosign keyless signing in build, mandatory verify on deploy host

The build job MUST sign every pushed image (both `tricho-auth` and `tricho-couchdb`) using `cosign sign` in keyless mode via GitHub OIDC (`https://token.actions.githubusercontent.com`). Signatures MUST be stored in Rekor and the relevant signature OCI artifact MUST land in GHCR alongside the image. The deploy workflow MUST run `cosign verify` on every image before pulling, asserting:

- `--certificate-oidc-issuer https://token.actions.githubusercontent.com`
- `--certificate-identity-regexp '^https://github\.com/beranku/tricho\.app/\.github/workflows/build-server-images\.yml@refs/heads/(main|dev)$'`

A `cosign verify` failure MUST abort the deploy before any `docker compose pull` is attempted. Bypass via `--insecure-ignore-tlog` or `--insecure-ignore-sct` MUST NOT appear in any committed workflow file; an operator who needs an emergency override MUST do so by manual SSH and document the reason.

#### Scenario: Unsigned image is rejected by the deploy host

- **GIVEN** an image manifest pushed without a Sigstore signature
- **WHEN** the deploy step runs `cosign verify`
- **THEN** the verify step exits non-zero
- **AND** no `docker compose pull` is invoked
- **AND** the running stack is unchanged

#### Scenario: Image signed by a different repository's workflow is rejected

- **GIVEN** an image whose Sigstore certificate identity points at a fork or a different repo
- **WHEN** the deploy step runs `cosign verify` with the strict identity regex
- **THEN** the verify step exits non-zero
- **AND** the deploy aborts before any container is restarted

#### Scenario: Successful verify proceeds to pull

- **GIVEN** an image signed by the `build-server-images.yml` workflow on `main`
- **WHEN** the deploy step runs `cosign verify`
- **THEN** the step exits 0
- **AND** the workflow proceeds to `docker compose pull` and `up`

### Requirement: Native ARM64 build, no QEMU emulation in the deploy path

The build workflow MUST run on a native ARM64 runner (`runs-on: ubuntu-24.04-arm`). It MUST NOT use `docker/setup-qemu-action` or any other emulation layer to produce the deploy artifact. If a multi-architecture manifest is needed in the future, additional native-architecture runners MUST be added matrix-style and merged via `docker buildx imagetools create`; QEMU MUST NOT be used as a shortcut.

#### Scenario: Build runner architecture matches deploy target

- **GIVEN** the `build-server-images.yml` workflow file
- **WHEN** the file is read
- **THEN** every `build` job declares `runs-on: ubuntu-24.04-arm` (or another native ARM64 image)
- **AND** no step invokes `docker/setup-qemu-action`

#### Scenario: Built image's architecture matches the host

- **GIVEN** an image pushed by the build workflow
- **WHEN** the deploy host runs `docker manifest inspect` against the `sha-<sha>` tag
- **THEN** the manifest's `architecture` field is `arm64`
- **AND** no `linux/amd64` or `linux/arm/v7` variant is present (until the spec is extended for multi-arch)

### Requirement: Build job is strictly separate from deploy job

The build and the deploy MUST be implemented as separate workflow jobs (or separate workflows). The deploy job MUST NOT contain a `docker build` or `docker buildx` invocation — it consumes only already-pushed, already-signed images by digest or by `sha-<sha>` tag. The runner host MUST NOT have buildx setup steps in any workflow that runs on its label.

#### Scenario: Deploy workflow has no build steps

- **GIVEN** the `deploy-server.yml` workflow file
- **WHEN** the file is read
- **THEN** no step invokes `docker build`, `docker buildx build`, or `docker/build-push-action`
- **AND** all image references resolve via `sha-<sha>` tags or digests already in GHCR
