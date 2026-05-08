## Context

Tricho.app uses a two-branch model: `dev` is the staging branch (auto-deployed to `dev.tricho.app` via `ci.yml`), `main` is production (auto-deployed to `tricho.app`). Both branches run the same `ci.yml` test/build/deploy pipeline; the only difference is which Cloudflare Pages branch alias the deploy targets.

Promotion from `dev` to `main` has historically gone through GitHub PRs. The repo's recent history records a recovery commit — `e8ff12d "Merge main into dev to resolve squash-merge divergence"` — which means a PR was squash-merged into `main`, generating a new commit object on `main` whose tree matched but whose SHA did not match the `dev` tip. Subsequent work on `dev` then conflicted with `main`, requiring a back-merge of `main` into `dev`. Both `--squash` and the merge-commit strategy generate a new SHA on `main`, breaking the invariant we want: **the SHA on `main` after a release is byte-identical to the `dev` SHA that was tested on staging**.

The repo is, in practice, single-developer (Jan), and `dev` is treated as a continuously-rebaseable working trunk. There is no external contributor flow that requires PR review. The "release" is therefore a one-person, one-button event, and the failure modes we need to defend against are:
- accidental promotion (clicked the wrong button),
- promotion of a SHA whose CI on `dev` was red,
- promotion that introduces non-linear history (merge commits between the old `main` and new `main`),
- promotion that diverges (a hand-edit on `main` that `dev` doesn't know about).

CI on push to `main` already runs the full pipeline (test-web, test-app, test-backend, build, validate, deploy) so the act of fast-forwarding `main` is itself the production deploy trigger. The promotion workflow does **not** deploy; it only moves a ref.

## Goals / Non-Goals

**Goals:**
- One button in the GitHub Actions UI promotes `dev` → `main` for a production release. No PR, no merge dialog, no strategy choice.
- After a successful promotion, `git rev-parse main == git rev-parse dev` at the moment of the push (modulo any `dev` advance after the push). The two refs point at the same commit object, so the production deploy uses the *same* artifacts that were tested on staging.
- The workflow refuses to run if any precondition fails, with an actionable error message in the run summary explaining what to do.
- A release tag `prod-YYYY-MM-DD-<shortsha>` is created on the released SHA so we can `git log` the production timeline at a glance.

**Non-Goals:**
- Automatic rollback. Rollback today is a manual Cloudflare-dashboard action (or a re-run of the production deploy on a previous SHA), and that's fine for the current scale.
- Automatic semver tagging of the PWA. `release-app.yml` already handles `app-v*` tags on a separate axis (PWA version, independent of when production is promoted).
- Multi-branch / multi-environment promotion. There is exactly one staging (`dev`) and one production (`main`) and that's by design.
- Slack/email notifications. The GitHub Actions run page is the source of truth; CF Pages emails on deploy.
- Branch-protection enforcement in code. Recommended (linear history + disallow squash/merge on `main`) but applied via GitHub repo settings UI, not via this workflow.

## Decisions

### Decision 1: Manual `workflow_dispatch` trigger, single workflow file

Use `on: workflow_dispatch` with one `inputs.confirm` text field. The user clicks Run workflow, types `RELEASE`, and clicks Run.

**Why over alternatives:**
- *Auto-promote on every push to `dev`* — rejected. Every commit isn't a release; the human-in-the-loop is the whole point of "fool-proof".
- *Schedule (cron) auto-promote* — rejected for the same reason; releases should be intentional.
- *Promote-by-tag (push a `release/*` tag → workflow runs)* — rejected as a UX downgrade. "Open Actions tab and click Run" is simpler than "remember the tag format and `git tag && git push --tags`". A tag is created *as a result* of promotion, not as the trigger.
- *Open a "release PR" automatically and require manual merge* — rejected. The whole point is to remove PR-based promotion since it caused the squash-merge divergence in the first place.

The `confirm: RELEASE` input is the fool-proofing: GitHub's "Run workflow" button is one click away from the Actions tab, and a stray click without typing the token will fail the precondition and abort. Cheap insurance.

### Decision 2: Server-side fast-forward push, never a merge

Implementation: `git push origin <dev-sha>:refs/heads/main` with no force flag.

This is semantically equivalent to `git checkout main && git merge --ff-only dev && git push`, but skips the local working-tree manipulation and lets the GitHub server itself enforce fast-forward-only — if `main` has commits `dev` doesn't, the push is rejected with `(non-fast-forward)` and the workflow fails. There is no opportunity to silently rewrite or generate a new commit.

**Why over alternatives:**
- *Squash-merge via `gh pr merge --squash`* — rejected. This is exactly the historical footgun. Squash creates a new SHA, breaks dev↔main parity, and forces a back-merge into `dev` for next release.
- *Merge commit via `git merge --no-ff`* — rejected. Creates a merge commit on `main` not present on `dev`, breaking the parity invariant and adding diff noise.
- *Rebase `dev` onto `main` inside the workflow, then FF* — rejected as default. If `dev` is already linearly atop `main` (the desired state), a rebase is a no-op. If `dev` is *not* linearly atop `main`, an automated rebase pushed back to `dev` would force-push and could surprise other clones. Better to fail loudly and let the human fix it locally.
- *`git push --force-with-lease` to handle divergence* — rejected. Force-push to `main` is a one-way ticket to lost commits. The workflow MUST never use `--force` or `--force-with-lease` against `main`.

### Decision 3: Four pre-flight gates, all must pass

Before the push:

1. **`dev` is strictly ahead of `main`** (`git rev-list --count main..dev` ≥ 1). Refuses to release "nothing".
2. **`main` is an ancestor of `dev`** (`git merge-base --is-ancestor main dev`). Refuses to release if `main` has diverged from `dev` — points the user at "rebase dev onto main locally first".
3. **No merge commits in `main..dev`** (`git rev-list --merges main..dev` is empty). Enforces the linear-history invariant locally even if branch protection isn't enabled in repo settings.
4. **CI green on `dev` tip** — query the GitHub API for the latest `CI/CD` workflow run on `dev`'s commit SHA via `gh run list --workflow=ci.yml --branch=dev --status=success --json headSha,conclusion --limit=20` and check that the dev tip SHA appears with `conclusion=success`. Refuses to release a red SHA.

The confirmation token is gate 0 (checked first; if `inputs.confirm != 'RELEASE'`, abort with a clear message).

**Why gate 4 (CI status) is non-negotiable:** even though the production deploy on `main` would re-run CI itself, releasing a SHA whose staging deploy is currently broken gives 5–10 minutes of broken production while the new pipeline runs. By gating on staging CI being already-green, we make the production push a confirmation of an already-tested artifact.

### Decision 4: Tag the released SHA

After a successful push, create an annotated tag `prod-YYYY-MM-DD-<shortsha>` (e.g. `prod-2026-04-28-a811a2f`) on the released commit. Push the tag.

**Why tag at all:** without tags, `git log main` is the only way to identify when each release happened, and the ordering depends on commit dates which are not always promotion dates (a commit can sit on `dev` for a week before promotion). A tag at promotion time is a reliable bookmark.

**Why this tag format:**
- `prod-` prefix disambiguates from `app-v*` (PWA semver tags). The two namespaces don't collide and we can `git tag --list 'prod-*'` to list the production timeline.
- Date-prefixed sorts naturally in `git tag --list 'prod-*' --sort=-v:refname`.
- Including the short SHA makes the tag self-documenting in run summaries.

**Why not a sequential `release-NNN`:** would require querying the existing tags to compute the next number, which is racy and adds a dependency on git history. The date+sha form is collision-free and stateless.

### Decision 5: Use `GITHUB_TOKEN` with `contents: write` only

The workflow needs to push to `main` and create a tag. That's `contents: write` on the default `GITHUB_TOKEN`, scoped to this workflow run only. No PAT, no SOPS-encrypted secret.

**Branch-protection caveat:** if "Require linear history" or "Require status checks" rules are enabled on `main`, the default `GITHUB_TOKEN` may be denied the push. The proposal explicitly recommends "Require linear history" — that rule is *consistent* with FF-only push and should not block. If "Require pull requests before merging" is enabled, the workflow push will be denied; in that case the recommendation in the proposal is to **disable** that rule for the single-developer flow, since the workflow's gates replace PR review.

## Risks / Trade-offs

- **[Risk] Accidental click of "Run workflow" promotes a half-finished change.**
  → Mitigation: required `confirm: RELEASE` text input. A single click without typing the token aborts immediately. Run summary on abort tells the user what was missing.

- **[Risk] CI status check is racy** — the workflow could see "green" for a SHA whose CI is in fact flaky (passed once, would fail on retry).
  → Mitigation: we rely on the most recent run for the SHA, which is the same artifact already deployed to staging. If staging is broken in practice, the user notices and doesn't promote. We don't try to re-run CI inline; that would slow the workflow from seconds to minutes for no real safety win.

- **[Risk] Hand-edits on `main` (e.g. a hotfix committed directly to `main`) cause gate 2 to fail.**
  → Mitigation: gate 2 fails fast with a clear message: "main has commits dev doesn't have; rebase dev onto main locally and retry". This is the correct behavior — releasing without picking up the hotfix into `dev` first would silently drop it.

- **[Risk] The `dev` tip moves between gate evaluation and the push** (a commit lands on `dev` mid-workflow).
  → Mitigation: capture `dev`'s SHA at the start of the workflow into a variable, run all gates against that captured SHA, and push *that captured SHA* (`git push origin <captured-sha>:refs/heads/main`), not `dev:main`. The pushed SHA is then the released SHA, and any newer commits on `dev` are simply the next release.

- **[Risk] Branch-protection rules block the workflow push and the failure mode is opaque.**
  → Mitigation: documented in the runbook. If push is rejected with "protected branch" error, the user disables "Require pull requests before merging" or adds the workflow's `GITHUB_TOKEN` identity to the bypass list. We do NOT bypass with `--force`.

- **[Trade-off] The workflow trusts the human gate (typing `RELEASE`) instead of a stronger second-actor approval.**
  → Acceptable. The repo is single-developer; a four-eyes principle would add ceremony without adding safety. If a second contributor joins, we revisit and switch to GitHub Environments + required reviewer.

- **[Trade-off] No automatic rollback workflow.**
  → Acceptable. Rollback is rare, and the CF Pages dashboard already supports re-publishing any previous deployment in two clicks. Adding a rollback workflow before we've ever needed one is YAGNI.

## Migration Plan

This change is purely additive — no existing workflow, branch, or deploy step is modified.

**Deploy steps:**
1. Land `.github/workflows/promote-dev-to-main.yml` on `dev` via normal commit.
2. Promote to `main` either (a) one last time via the legacy "merge PR" route, or (b) `git push origin dev:main` from a local checkout (the workflow itself can't promote its own first version because it doesn't yet exist on `main`).
3. After the workflow exists on `main`, all subsequent releases use the workflow.
4. Update repo settings (one-time, manual): enable "Require linear history" on `main`; disable "Allow squash merging" and "Allow merge commits" for PRs targeting `main`.

**Rollback:**
- The workflow is non-destructive; if it has bugs, delete the workflow file. Production releases revert to `git push origin dev:main` from a local checkout.
- If a *promotion* itself was wrong (released the wrong SHA), redeploy a previous deployment via the Cloudflare Pages dashboard. This is unchanged from today.

## Open Questions

- Should the workflow also create a GitHub Release (in addition to the tag) at the released SHA? Argument for: gives a copy-pasteable changelog (commits in `prev-main..new-main`) on the Releases page. Argument against: `release-app.yml` already does releases for the PWA semver axis, and a duplicate "production releases" timeline could confuse. **Tentative answer: tag only, no GitHub Release**. Revisit if the tag list proves insufficient for changelog purposes.
- Should the runbook live in `docs/DEVELOPER.md` or a new `docs/RELEASES.md`? **Tentative answer: section in `docs/DEVELOPER.md`** — keeps doc surface area small, and "how to release" is a developer concern.
