## Why

Promoting `dev` → `main` (i.e. shipping a production release on Cloudflare Pages) currently relies on opening a PR and merging it through the GitHub UI. The history shows this has bitten the project: commit `e8ff12d "Merge main into dev to resolve squash-merge divergence"` records the moment a squash-merge desynced `dev` from `main` and forced a recovery merge. The current options in the UI (squash, merge-commit, rebase-merge) all carry footguns for a single-developer Czech-only PWA whose CI pipeline is identical for both branches and where staging ↔ production parity is paramount.

The goal is a **single-click, fool-proof production release**: one button in the Actions tab that fast-forwards `main` to whatever SHA `dev` currently points at, refusing to run unless the result is a strictly linear history with green CI. This removes the squash-merge footgun entirely, keeps `dev` (staging) and `main` (production) pointing at *the exact same commit object* on every release, and eliminates per-release manual steps (no PR, no clicking merge, no choosing a strategy).

## What Changes

- Add a new GitHub Actions workflow `.github/workflows/promote-dev-to-main.yml` triggered by `workflow_dispatch` (manual, single-click in the GitHub UI).
- The workflow performs **only** a server-side fast-forward of `main` to `dev`'s tip. No squash, no merge commit, no force-push.
- Pre-flight gates that MUST all pass before the push happens:
  1. `dev` is strictly ahead of `main` (≥ 1 commit), and `main` is an ancestor of `dev` (i.e. fast-forward is possible without a rebase).
  2. The commit range `main..dev` contains no merge commits (linear history invariant).
  3. The latest CI run for `dev`'s tip SHA in the `CI/CD` workflow concluded `success`.
  4. A typed confirmation input matches a literal token (e.g. `RELEASE`) — protects against accidental clicks.
- The push uses `git push origin <dev-sha>:refs/heads/main` (no force flag), so the GitHub server itself rejects any non-fast-forward and the workflow fails loudly.
- After a successful promotion, the workflow tags the released SHA `prod-YYYY-MM-DD-<shortsha>` on `main` for traceability and posts a one-line summary to the workflow run (released SHA, tag, deployed URL).
- A short `docs/RELEASES.md` (or section in `docs/DEVELOPER.md`) documents the one-button flow and the recovery procedure when a gate fails (rebase `dev` onto `main` locally, push, retry).

Out of scope:
- No changes to `ci.yml` deploy logic — the existing push-to-`main` Cloudflare Pages production deploy remains the source of truth for what "released" means.
- No changes to `release-app.yml` (PWA semver tagging is a separate axis from prod promotion).
- No branch-protection rule changes in this proposal (recommendation noted in design.md but applied via repo settings, not code).
- No automatic rollback workflow (out of scope; rollback today is "redeploy previous main SHA via Cloudflare dashboard or `wrangler pages deployment` retry").

## Capabilities

### New Capabilities
- `release-promotion`: a manual, gated GitHub Actions workflow that fast-forwards `main` to `dev` for production releases, with linearity + green-CI + confirmation-token preconditions and a release tag on success.

### Modified Capabilities
*(none — `cloudflare-pages-deploy` is unchanged: it still deploys whatever lands on `main`. `app-release-versioning` is unchanged: PWA semver tags are independent of the prod-promotion tag.)*

## Impact

- **New file**: `.github/workflows/promote-dev-to-main.yml`.
- **New doc**: short release runbook (likely a section appended to `docs/DEVELOPER.md`, not a new top-level doc — keeps doc surface area small).
- **Repo settings (manual, out-of-band)**: recommend enabling "Require linear history" on `main` so the GitHub server enforces the linearity invariant even if someone bypasses the workflow. Recommend disabling "Allow merge commits" and "Allow squash merging" for PRs targeting `main`. These are settings changes, not code changes, but should be checked off as part of applying this change.
- **Secrets**: none. The workflow uses the default `GITHUB_TOKEN` with `contents: write` permission; no Cloudflare or third-party secrets are touched (Cloudflare deploy is triggered by the resulting push, handled by existing `ci.yml`).
- **Day-to-day workflow change**: developers (currently just one) keep working on `dev` as today. Releasing becomes "go to Actions → Promote dev to main → Run workflow → type RELEASE". Failed gates point at remediation in the workflow run summary.
