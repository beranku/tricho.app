# cloudflare-pages-deploy Specification

## Purpose
TBD - created by archiving change marketing-site-and-pwa-split. Update Purpose after archive.
## Requirements
### Requirement: Single Cloudflare Pages project named `tricho` deploys the merged dist

The repository MUST deploy to one Cloudflare Pages project named `tricho`, created via `wrangler pages project create tricho --production-branch=main` as a Direct Upload project (no Cloudflare-side Git integration). All deploys MUST come from GitHub Actions invoking `wrangler pages deploy dist --project-name=tricho`. The Cloudflare Pages project MUST own one production custom domain (`tricho.app`) and one redirect-only custom domain (`www.tricho.app` 301 → apex).

#### Scenario: Production deploy targets the tricho project
- **GIVEN** a push to `main`
- **WHEN** the deploy step in `ci.yml` runs
- **THEN** the wrangler invocation includes `--project-name=tricho`
- **AND** the deploy targets the production branch (`main`)

#### Scenario: Custom domain serves the production deploy
- **GIVEN** a successful production deploy
- **WHEN** `https://tricho.app/` is fetched from the public internet
- **THEN** the response is served by Cloudflare Pages with the contents of the latest production deployment

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

### Requirement: Deploy is atomic; rollback is one click in the Cloudflare dashboard

Each deploy MUST upload a complete `dist/` snapshot. The deploy MUST NOT mutate the live site incrementally; partial-upload + cutover semantics MUST be Cloudflare's responsibility (which they handle via content-addressed storage). The deploy MUST set `--commit-hash=${{ github.sha }}` so each Cloudflare Pages deployment record is traceable to the Git commit that produced it. Rollback MUST be possible via the Cloudflare dashboard's "Rollback to this deployment" button on any prior deployment record.

#### Scenario: Deploy passes commit hash for traceability
- **GIVEN** a CI run for commit `abc1234`
- **WHEN** the wrangler deploy invocation is constructed
- **THEN** the command includes `--commit-hash=abc1234<rest of sha>`

#### Scenario: Rollback to previous deployment restores the previous site
- **GIVEN** the operator clicks "Rollback to this deployment" on the most recent prior deployment in the Cloudflare dashboard
- **WHEN** the rollback completes (within seconds)
- **THEN** `https://tricho.app/` serves the rolled-back deployment's content
- **AND** no GitHub Actions run is required

### Requirement: Required GitHub Actions secrets are CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID

The CI workflow MUST consume two repository secrets: `CLOUDFLARE_API_TOKEN` (a token scoped to "Cloudflare Pages — Edit" for the target Cloudflare account, no other scopes) and `CLOUDFLARE_ACCOUNT_ID`. The README MUST document how to create the token (Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token) and how to find the account ID (Cloudflare dashboard sidebar). No other Cloudflare credentials MUST be required by the workflow. Neither secret MUST be committed to the repository or logged at any verbosity level.

#### Scenario: Workflow consumes only the two named secrets
- **GIVEN** `.github/workflows/ci.yml`
- **WHEN** `${{ secrets.* }}` references are extracted
- **THEN** only `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (plus `GITHUB_TOKEN` for PR-comment posting) are referenced

#### Scenario: README documents the secrets
- **GIVEN** the project README
- **WHEN** the deployment section is read
- **THEN** it names both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and explains how to obtain each

### Requirement: GitHub Pages is decommissioned as the deploy target

The previous GitHub Pages workflow (`.github/workflows/deploy.yml`) MUST be removed. The repo-root `CNAME` file (used only by GitHub Pages) MUST be removed. GitHub Pages MUST be disabled in the GitHub repository settings post-cutover (operator action). After cutover, no production traffic MUST be served by GitHub Pages.

#### Scenario: Old deploy workflow is gone
- **GIVEN** the post-merge state
- **WHEN** `.github/workflows/` is listed
- **THEN** `deploy.yml` (the GitHub Pages deploy workflow) does not exist
- **AND** `ci.yml` (the new Cloudflare Pages workflow) exists

#### Scenario: CNAME file is removed
- **GIVEN** the post-merge state
- **WHEN** the repo root is listed
- **THEN** no `CNAME` file is present at the root

### Requirement: Concurrency cancels in-flight PR builds; main builds are not cancelled

The CI workflow MUST set `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: ${{ github.event_name == 'pull_request' }} }`. PR runs MUST cancel any in-flight prior run on the same PR when a new push lands. Pushes to `main` MUST NOT cancel any in-flight `main` build.

#### Scenario: New PR push cancels prior PR run
- **GIVEN** an in-flight PR run
- **WHEN** a new commit is pushed to the same PR branch
- **THEN** the prior in-flight run is cancelled
- **AND** the new run starts immediately

#### Scenario: New main push does not cancel an in-flight main run
- **GIVEN** an in-flight `main` deploy
- **WHEN** a second commit lands on `main`
- **THEN** both runs proceed to completion
- **AND** the second deploy supersedes the first when it finishes

### Requirement: Branch protection on main requires CI checks

After cutover, the operator MUST enable branch protection on `main` requiring the status checks `Test web`, `Test app`, and `Build merged dist & deploy` to pass before merge, requiring linear history, and restricting direct pushes to `main`. The README MUST document this as an operator action in the deployment section.

#### Scenario: README documents branch protection requirements
- **GIVEN** the project README
- **WHEN** the deployment section is read
- **THEN** it lists required status checks and explains the operator must configure branch protection

### Requirement: Build job uses Node 22 and caches the per-package npm cache

Both `test-web` and `test-app` jobs MUST use `actions/setup-node@v4` with `node-version: 22` and `cache: npm` and `cache-dependency-path` pointing at the per-package `package-lock.json`. The build job MAY install only what it needs (`npm ci` per package).

#### Scenario: Test-web job uses the web lockfile for npm cache
- **GIVEN** `.github/workflows/ci.yml`
- **WHEN** the `test-web` job's setup-node step is inspected
- **THEN** `cache-dependency-path` is `web/package-lock.json`

#### Scenario: Test-app job uses the app lockfile for npm cache
- **GIVEN** `.github/workflows/ci.yml`
- **WHEN** the `test-app` job's setup-node step is inspected
- **THEN** `cache-dependency-path` is `app/package-lock.json`
