## ADDED Requirements

### Requirement: Branch-aliased deploys for `dev`, `main`, and PR branches

The CI workflow MUST set the Cloudflare Pages deploy `--branch` flag from the deploying git ref so each branch gets a stable Cloudflare Pages alias. Pushes to `dev` MUST deploy to the `dev` branch alias (`dev.tricho.app`, the staging target in the solo direct-to-`dev` development flow). Pushes to `main` MUST deploy to the production branch alias (`tricho.app`). Pull request runs MUST deploy to a per-branch preview alias (`<branch>.tricho.pages.dev`). The host-to-branch mapping for `dev.tricho.app` and `tricho.app` MUST be configured as Cloudflare Pages custom domains targeting the corresponding branch alias.

#### Scenario: Push to `dev` deploys to the staging branch alias

- **GIVEN** a push lands on `dev`
- **WHEN** the deploy step in `ci.yml` runs
- **THEN** the wrangler invocation includes `--branch=dev`
- **AND** the deploy is reachable at `https://dev.tricho.app/` once the Cloudflare Pages alias has propagated

#### Scenario: Push to `main` deploys to the production branch alias

- **GIVEN** a push lands on `main` (typically via the `Promote dev → main` workflow dispatching `ci.yml`)
- **WHEN** the deploy step in `ci.yml` runs
- **THEN** the wrangler invocation includes `--branch=main`
- **AND** the deploy is reachable at `https://tricho.app/`

#### Scenario: PR run deploys to a per-branch preview alias

- **GIVEN** a pull request is opened against `main` from feature branch `feat/x`
- **WHEN** the deploy step in `ci.yml` runs for the PR
- **THEN** the wrangler invocation includes `--branch=feat-x` (or the equivalent slugged branch name)
- **AND** the deploy is reachable at the per-branch preview URL Cloudflare assigns

### Requirement: PR runs SHOULD post a preview-URL comment

When a pull request triggers a deploy, the CI workflow SHOULD post a comment on the PR (via `actions/github-script` or equivalent). When such a comment is posted, it MUST contain the deployment URL, the branch alias URL, and the commit short-SHA, so a reviewer can click through both the marketing site and the app shell on the preview. The workflow MUST NOT fail if comment posting fails (e.g., GitHub API rate limit, transient outage); comment posting is a convenience, not a release gate. PR comment posting is NOT required for pushes to `dev` or `main` since those have stable, well-known URLs (`dev.tricho.app`, `tricho.app`) discoverable from the repository documentation.

#### Scenario: PR run posts a preview-URL comment

- **GIVEN** a pull request is opened against `main`
- **WHEN** `ci.yml` finishes a successful preview deploy
- **THEN** a comment is posted on the PR containing the deployment URL, branch alias URL, and short-SHA

#### Scenario: PR-comment posting failure does not fail the workflow

- **GIVEN** the GitHub API rejects the comment-creation request (rate limit, transient outage)
- **WHEN** the comment-posting step runs
- **THEN** the workflow continues to a successful conclusion
- **AND** the deploy itself is not retried or rolled back

## MODIFIED Requirements

### Requirement: Path-filtered tests skip the unaffected side

The CI workflow MUST run `dorny/paths-filter@v3` (or equivalent) as the first job to detect which sides changed. Jobs MUST be gated:

- `test-web`: runs when any of `web/**`, `shared/**`, `scripts/**`, `_headers`, `_redirects`, `.github/workflows/**` changed.
- `test-app`: runs when any of `app/**`, `shared/**`, `scripts/**`, `_headers`, `_redirects`, `.github/workflows/**` changed.

A change touching only `web/**` MUST skip `test-app` and vice versa. A change to `shared/**` or `scripts/**` MUST trigger both sides. The deploy job MUST run on every push to `dev`, every push to `main`, and every pull request, regardless of which paths changed.

#### Scenario: web-only change skips app tests

- **GIVEN** a change (push to `dev`, push to `main`, or PR) that modifies only files under `web/`
- **WHEN** `ci.yml` runs
- **THEN** the `test-web` job runs and passes
- **AND** the `test-app` job is skipped (status `skipped` in the workflow run)
- **AND** the deploy job still runs

#### Scenario: app-only change skips web tests

- **GIVEN** a change that modifies only files under `app/`
- **WHEN** `ci.yml` runs
- **THEN** `test-app` runs
- **AND** `test-web` is skipped
- **AND** the deploy job still runs

#### Scenario: shared change runs both sides

- **GIVEN** a change that modifies `shared/manifest.webmanifest`
- **WHEN** `ci.yml` runs
- **THEN** both `test-web` and `test-app` run

## REMOVED Requirements

### Requirement: PR runs deploy a unique preview URL and post the link as a PR comment

**Reason**: The original requirement bundled two distinct behaviors (branch-aliased preview deploys and PR-comment posting) and made both MUST-level under a PR-centric framing. With the move to a single-developer direct-push-to-`dev` flow, pull requests are no longer the everyday integration mechanism and `dev.tricho.app` is the load-bearing staging target. The capability split is now described by two replacement requirements that match operational reality.

**Migration**: Replaced by **Branch-aliased deploys for `dev`, `main`, and PR branches** (MUST-level — covers the deploy targeting for all three ref types) and **PR runs SHOULD post a preview-URL comment** (SHOULD-level — preserves the comment-posting capability without making it load-bearing). No code, workflow, or infrastructure change is required; `ci.yml` already exhibits the behavior the replacements describe.
