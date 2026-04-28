## 1. Workflow file

- [x] 1.1 Create `.github/workflows/promote-dev-to-main.yml` with `on: workflow_dispatch` and a single required string input `confirm` (description: "Type RELEASE to confirm production promotion").
- [x] 1.2 Set top-level `permissions:` to exactly `contents: write` (and nothing else).
- [x] 1.3 Add `concurrency:` group `promote-dev-to-main` with `cancel-in-progress: false` so two concurrent clicks don't race.
- [x] 1.4 Single `release` job with `runs-on: ubuntu-latest` and a meaningful `name:` ("Promote dev → main").

## 2. Preflight gates

- [x] 2.1 First step: validate `inputs.confirm == 'RELEASE'`; abort with `echo "::error::confirm input must be 'RELEASE'"` and `exit 1` otherwise.
- [x] 2.2 `actions/checkout@v4` with `fetch-depth: 0` and `ref: dev` so we have full history of both branches; explicitly fetch `origin/main` afterwards (`git fetch origin main:refs/remotes/origin/main`).
- [x] 2.3 Capture the dev tip SHA into `DEV_SHA=$(git rev-parse origin/dev)` and export it via `$GITHUB_ENV` for later steps; also capture `SHORT_SHA=${DEV_SHA:0:7}`.
- [x] 2.4 Gate "ahead-of-main": fail if `git rev-list --count origin/main..$DEV_SHA` is `0`.
- [x] 2.5 Gate "linear-ancestor": fail if `git merge-base --is-ancestor origin/main $DEV_SHA` exits non-zero, with remediation message instructing local rebase.
- [x] 2.6 Gate "no-merge-commits": fail if `git rev-list --merges origin/main..$DEV_SHA` produces any output.
- [x] 2.7 Gate "ci-green": use `gh run list --workflow=ci.yml --branch=dev --status=success --json headSha,conclusion,databaseId,url --limit=20` and fail if `$DEV_SHA` is not present in the result; print the CI run URL in the failure message when the SHA was found but unsuccessful.

## 3. Promotion push

- [x] 3.1 Configure git identity: `git config user.name "github-actions[bot]"` and `user.email "41898282+github-actions[bot]@users.noreply.github.com"`.
- [x] 3.2 Push `git push origin "${DEV_SHA}:refs/heads/main"` (no `--force`, no `+`) so the GitHub server enforces fast-forward-only.
- [x] 3.3 On non-fast-forward rejection, surface the git error in `::error::` and exit 1 — do NOT retry with force.

## 4. Tagging and summary

- [x] 4.1 Compute `TAG="prod-$(date -u +%Y-%m-%d)-${SHORT_SHA}"`.
- [x] 4.2 Skip tag creation if `git ls-remote --exit-code --tags origin "$TAG"` succeeds (tag already exists); otherwise create annotated tag `git tag -a "$TAG" "$DEV_SHA" -m "Production release $TAG"` and `git push origin "$TAG"`.
- [x] 4.3 Append a one-line summary to `$GITHUB_STEP_SUMMARY` containing: released SHA (full + short), tag name, and the production URL `https://tricho.app/`. Format suggestion: a small markdown table.

## 5. Documentation

- [x] 5.1 Add a "Production releases" section to `docs/DEVELOPER.md` describing the one-button flow: "Actions → Promote dev to main → Run workflow → type RELEASE → Run".
- [x] 5.2 Document the four preflight gates and the recovery step for each (most importantly: "rebase dev onto main locally, push, retry").
- [x] 5.3 Document the recommended (manual) GitHub repo settings: enable "Require linear history" on `main`; disable "Allow squash merging" and "Allow merge commits" for PRs targeting `main`.
- [x] 5.4 Cross-link the new section from `README.md` if a "Releasing" section exists, or add a short pointer if not.

## 6. First-run bootstrap *(operator/manual — not implementable from this session)*

- [ ] 6.1 Land the workflow file on `dev` via a normal commit on a feature branch + PR (or direct push) — same as any other change.
- [ ] 6.2 Perform the *first* promotion manually: from a local checkout, run `git push origin dev:main` (one-time bootstrap, since the workflow can't yet promote itself before it exists on `main`).
- [ ] 6.3 Verify on `main` that `.github/workflows/promote-dev-to-main.yml` is present, then trigger the workflow once with a no-op release on top (or wait for the next genuine release) to confirm the gates fire as expected.

## 7. Verification *(operator/manual — requires running the workflow against the live repo)*

- [ ] 7.1 Manually verify "happy path": dev linearly ahead of main, ci.yml green, run workflow with `confirm=RELEASE` → main advances to dev's SHA, tag created, ci.yml on main triggers a production deploy to `tricho.app`.
- [ ] 7.2 Manually verify "wrong token": run workflow with `confirm=` (empty) → fails at gate 0.
- [ ] 7.3 Manually verify "nothing to release": with main == dev, run workflow → fails on ahead-of-main gate.
- [ ] 7.4 Manually verify "linearity": create a throwaway scenario (e.g. local commit on main not on dev, pushed to a test branch standing in for main on a fork) → confirm linear-ancestor gate fails. Acceptable to skip if low-risk; document the recovery step regardless.
- [ ] 7.5 Manually verify "ci-red": commit a deliberately-failing change to dev, wait for ci.yml red on dev, run workflow → fails on ci-green gate. Then revert the failing commit before proceeding.
- [ ] 7.6 Confirm `git rev-parse origin/main` after a successful release equals the captured dev SHA (parity invariant).
- [ ] 7.7 Confirm a production tag `prod-YYYY-MM-DD-<shortsha>` exists on `origin` and points at the released SHA.
