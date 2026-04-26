## ADDED Requirements

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

### Requirement: PR runs deploy a unique preview URL and post the link as a PR comment

Every pull request opened against `main` MUST trigger a deploy to a unique Cloudflare Pages preview URL (Cloudflare creates one per branch + commit hash). The URL MUST be posted as a comment on the PR by `actions/github-script` (or equivalent) so reviewers can click through both the marketing site and the app shell on the preview before approving. The PR comment MUST include the deployment URL, the branch alias URL, and the commit SHA (short).

#### Scenario: Opening a PR triggers a preview deploy
- **GIVEN** a feature branch is pushed and a PR is opened against `main`
- **WHEN** the `ci.yml` workflow runs
- **THEN** the deploy step succeeds with a non-empty `deployment-url` output
- **AND** a comment is posted on the PR containing that URL

#### Scenario: Subsequent pushes to the PR update the comment or post a new one
- **GIVEN** an existing PR with a preview URL comment
- **WHEN** a new commit is pushed to the same branch
- **THEN** a new deploy completes
- **AND** the PR comment thread reflects the new deployment URL (either updated comment or new comment)

### Requirement: Path-filtered tests skip the unaffected side

The CI workflow MUST run `dorny/paths-filter@v3` (or equivalent) as the first job to detect which sides changed. Jobs MUST be gated:

- `test-web`: runs when any of `web/**`, `shared/**`, `scripts/**`, `_headers`, `_redirects`, `.github/workflows/**` changed.
- `test-app`: runs when any of `app/**`, `shared/**`, `scripts/**`, `_headers`, `_redirects`, `.github/workflows/**` changed.

A change touching only `web/**` MUST skip `test-app` and vice versa. A change to `shared/**` or `scripts/**` MUST trigger both sides. The deploy job MUST run on every PR and on every push to `main` regardless of which paths changed.

#### Scenario: web-only PR skips app tests
- **GIVEN** a PR that modifies only files under `web/`
- **WHEN** `ci.yml` runs
- **THEN** the `test-web` job runs and passes
- **AND** the `test-app` job is skipped (status `skipped` in the workflow run)
- **AND** the deploy job still runs

#### Scenario: app-only PR skips web tests
- **GIVEN** a PR that modifies only files under `app/`
- **WHEN** `ci.yml` runs
- **THEN** `test-app` runs
- **AND** `test-web` is skipped
- **AND** the deploy job still runs

#### Scenario: shared change runs both sides
- **GIVEN** a PR that modifies `shared/manifest.webmanifest`
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
