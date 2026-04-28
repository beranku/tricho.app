## ADDED Requirements

### Requirement: Production releases promote `dev` to `main` via a manual `workflow_dispatch` GitHub Action

The repository SHALL provide a single GitHub Actions workflow file at `.github/workflows/promote-dev-to-main.yml` that promotes the current `dev` tip to `main`. The workflow MUST be triggered exclusively by `workflow_dispatch` (the "Run workflow" button in the GitHub Actions UI). The workflow MUST NOT be triggered by `push`, `pull_request`, `schedule`, or any other event. The workflow MUST accept a single required string input `confirm` and MUST abort, with status `failure` and a clear message in the run summary, when `confirm` is not equal to the literal string `RELEASE`.

#### Scenario: Manual run with correct confirmation token proceeds past gate 0
- **WHEN** a user opens the GitHub Actions tab, selects "Promote dev to main", types `RELEASE` into the `confirm` input, and clicks "Run workflow"
- **THEN** the workflow starts and proceeds to evaluate the remaining preflight gates (linearity, ahead-of-main, CI green)

#### Scenario: Manual run with empty or wrong confirmation token aborts immediately
- **WHEN** a user clicks "Run workflow" without typing `RELEASE` (empty input or any other string)
- **THEN** the workflow fails at the first step with a message identifying the missing/wrong confirmation token
- **AND** no `git push` is performed
- **AND** no tag is created

#### Scenario: Push events to `dev` or `main` do not trigger the promotion workflow
- **WHEN** any commit is pushed to `dev` or `main`
- **THEN** the `promote-dev-to-main.yml` workflow does not run
- **AND** only `ci.yml` (and `release-app.yml` for matching tags) runs as today

### Requirement: Promotion preflight enforces linear history, ahead-of-main, and green staging CI

Before any push to `main`, the workflow MUST evaluate the following preflight gates against the SHA captured from `origin/dev` at the start of the workflow run. ALL gates MUST pass; if any gate fails, the workflow MUST abort with a `failure` status and a run-summary message naming the failing gate and the remediation step. The workflow MUST NOT push to `main`, MUST NOT create a tag, and MUST NOT modify any ref when a preflight gate fails.

The gates are:

1. **ahead-of-main** — `git rev-list --count origin/main..<dev-sha>` returns a value ≥ 1. If the value is 0, the gate fails with the message "dev has no commits ahead of main; nothing to release".
2. **linear-ancestor** — `git merge-base --is-ancestor origin/main <dev-sha>` exits 0. If it exits non-zero, the gate fails with the message "main has commits not on dev; rebase dev onto main locally and retry".
3. **no-merge-commits** — `git rev-list --merges origin/main..<dev-sha>` produces no output. If it produces any SHA, the gate fails with the message "merge commits found in main..dev; rebase dev to a linear history and retry".
4. **ci-green** — the most recent `CI/CD` workflow run on the `dev` branch, queried via the GitHub API for the captured `<dev-sha>`, has `conclusion=success`. If no successful run exists for that SHA, the gate fails with the message "no successful CI run for dev SHA <sha>; wait for staging CI or fix the failure".

#### Scenario: dev is empty relative to main → ahead-of-main gate fails
- **GIVEN** `origin/dev` and `origin/main` point to the same SHA
- **WHEN** the promotion workflow runs (with confirmation token set correctly)
- **THEN** the workflow fails on the ahead-of-main gate
- **AND** the run summary contains the message "dev has no commits ahead of main; nothing to release"
- **AND** no push or tag is performed

#### Scenario: main has diverged from dev → linear-ancestor gate fails
- **GIVEN** `origin/main` contains at least one commit not present on `origin/dev` (e.g. a hand-edit on `main`)
- **WHEN** the promotion workflow runs
- **THEN** the workflow fails on the linear-ancestor gate
- **AND** the run summary names the gate and instructs the user to rebase `dev` onto `main` locally
- **AND** no push or tag is performed

#### Scenario: dev contains a merge commit → no-merge-commits gate fails
- **GIVEN** the range `origin/main..origin/dev` includes one or more merge commits
- **WHEN** the promotion workflow runs
- **THEN** the workflow fails on the no-merge-commits gate
- **AND** the run summary instructs the user to rebase `dev` to a linear history
- **AND** no push or tag is performed

#### Scenario: staging CI is red → ci-green gate fails
- **GIVEN** the latest `CI/CD` workflow run for `origin/dev`'s tip SHA has `conclusion != 'success'` (failure, cancelled, or in-progress)
- **WHEN** the promotion workflow runs
- **THEN** the workflow fails on the ci-green gate
- **AND** the run summary identifies the failing CI run by URL or ID
- **AND** no push or tag is performed

#### Scenario: All gates pass with a normal linear dev → workflow proceeds to push
- **GIVEN** `dev` is N commits (N ≥ 1) ahead of `main`, fully linear, and the dev tip SHA has a successful `CI/CD` run
- **WHEN** the promotion workflow runs
- **THEN** the workflow proceeds past all preflight gates and performs the fast-forward push step

### Requirement: Promotion uses a fast-forward-only push and never rewrites history

The promotion workflow MUST advance `main` to the captured `dev` SHA via a server-side fast-forward push of the form `git push origin <captured-dev-sha>:refs/heads/main`. The push command MUST NOT include `--force`, `--force-with-lease`, `+`, or any other flag or refspec syntax that allows non-fast-forward updates. If the GitHub server rejects the push as non-fast-forward, the workflow MUST treat that as a failure and exit without retry; the workflow MUST NOT attempt to merge, rebase, or rewrite history to make the push succeed.

The captured `dev` SHA used in the push refspec MUST be the SHA recorded at the start of the workflow run (i.e. the same SHA the preflight gates evaluated). The workflow MUST NOT push `dev:main` by branch name (which would be susceptible to a TOCTOU race if `dev` advances mid-run).

#### Scenario: All gates pass and remote accepts fast-forward → main now points at dev's SHA
- **GIVEN** preflight gates have all passed for captured SHA `<S>`
- **WHEN** the workflow runs `git push origin <S>:refs/heads/main`
- **THEN** the push succeeds
- **AND** `git rev-parse origin/main` after the push returns `<S>`
- **AND** the commit object on `main` is byte-identical to the commit object on `dev` at SHA `<S>`

#### Scenario: Server rejects non-fast-forward push → workflow fails without rewriting
- **GIVEN** between gate evaluation and the push, `main` advances to a SHA that is not an ancestor of `<S>` (rare, e.g. a concurrent hand-edit)
- **WHEN** the workflow attempts `git push origin <S>:refs/heads/main`
- **THEN** the GitHub server rejects the push as non-fast-forward
- **AND** the workflow exits with `failure` status
- **AND** the workflow does NOT retry with `--force` or any other escalation
- **AND** no tag is created

#### Scenario: dev advances mid-workflow → released SHA is the captured one, not the latest
- **GIVEN** the workflow captured SHA `<S>` for `dev` at the start of the run
- **WHEN** a new commit lands on `dev` (advancing `dev` to `<S2>`) before the push step executes
- **THEN** the workflow pushes `<S>:refs/heads/main`, not `<S2>:refs/heads/main`
- **AND** the resulting `main` points at `<S>`
- **AND** `<S2>` remains the next release candidate, available on `dev` for the next promotion

### Requirement: A successful promotion creates a dated production tag on the released SHA

After a successful fast-forward push to `main`, the workflow SHALL create an annotated git tag of the form `prod-YYYY-MM-DD-<shortsha>` on the captured dev SHA, where `YYYY-MM-DD` is the workflow run date in UTC and `<shortsha>` is the first 7 characters of the captured dev SHA. The workflow MUST push the tag to `origin`. The workflow MUST emit a single-line summary to the run page containing: the released SHA, the created tag, and the production URL (`https://tricho.app/`).

If the tag already exists (e.g. an earlier failed run created it), the workflow MUST skip tag creation and continue without error, since the tag's purpose is post-hoc traceability and idempotency is preferable to noisy failure.

The workflow MUST NOT create a GitHub Release object (the `release-app.yml` workflow owns the PWA-semver release axis; production-promotion tags are a separate, lighter-weight timeline).

#### Scenario: Successful promotion creates and pushes a production tag
- **GIVEN** preflight gates have passed and the fast-forward push has succeeded for SHA `a811a2f...`
- **WHEN** the tag step runs on the date 2026-04-28 UTC
- **THEN** an annotated tag `prod-2026-04-28-a811a2f` exists on commit `a811a2f...`
- **AND** the tag is present on `origin` (visible in `git ls-remote --tags origin`)
- **AND** the run summary contains the tag name, the released SHA, and `https://tricho.app/`

#### Scenario: Tag already exists from a previous run → skip without failing
- **GIVEN** a tag `prod-2026-04-28-a811a2f` already exists on `origin` from a prior run
- **WHEN** the tag step runs again for the same SHA on the same date
- **THEN** the step succeeds without re-creating the tag
- **AND** the workflow run is marked successful

#### Scenario: No GitHub Release is created
- **GIVEN** a successful promotion
- **WHEN** the workflow finishes
- **THEN** the GitHub Releases page shows no new release for the prod-* tag (only `app-v*` releases continue to appear, owned by `release-app.yml`)

### Requirement: The promotion workflow uses only the default `GITHUB_TOKEN` with minimal permissions

The promotion workflow MUST request only the GitHub Actions permissions it needs and MUST NOT use any external secret. Specifically, the workflow YAML's `permissions:` block SHALL grant `contents: write` (required to push to `main` and create the tag) and SHALL NOT grant any other permission (no `actions: write`, `packages: write`, `id-token: write`, etc.). The workflow MUST NOT reference `secrets.CLOUDFLARE_API_TOKEN`, `secrets.CLOUDFLARE_ACCOUNT_ID`, any SOPS-decrypted secret, or any personal access token.

The Cloudflare Pages production deploy is triggered as a side effect of the resulting push to `main`, which causes `ci.yml` to run; the promotion workflow does NOT call `wrangler` or any deploy command directly.

#### Scenario: Workflow file declares only contents:write
- **GIVEN** the file `.github/workflows/promote-dev-to-main.yml`
- **WHEN** its `permissions:` block is read
- **THEN** the only entry is `contents: write` (or equivalently, all other permissions are explicitly `none`)

#### Scenario: Workflow file does not reference Cloudflare or third-party secrets
- **GIVEN** the file `.github/workflows/promote-dev-to-main.yml`
- **WHEN** the file is grepped for `secrets.`
- **THEN** the only matches (if any) are `secrets.GITHUB_TOKEN` (the default token), and no `secrets.CLOUDFLARE_*` or other external secret is referenced

#### Scenario: A successful promotion deploys to production via the existing ci.yml
- **GIVEN** a successful promotion has fast-forwarded `main` to a new SHA
- **WHEN** the resulting push event fires
- **THEN** the existing `ci.yml` workflow runs on `main`
- **AND** the existing build-and-deploy job deploys `dist/` to Cloudflare Pages with `--branch=main`
- **AND** the promotion workflow itself contains no deploy step
