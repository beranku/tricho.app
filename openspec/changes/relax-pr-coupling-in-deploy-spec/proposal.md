## Why

Tricho.app is now operated as a single-developer project. The everyday integration flow is direct push to `dev` (auto-deployed to `dev.tricho.app` via `ci.yml`) followed by a `Promote dev → main` workflow_dispatch release; pull requests are no longer the everyday integration mechanism. Two existing capability specs — `cloudflare-pages-deploy` and `e2e-testing` — still encode SHALL/MUST requirements that are framed entirely around pull requests. Those requirements are not *broken* (they're vacuously satisfied when no PRs are opened), but they misdescribe the system: an outside reader of the specs would conclude that PR previews and PR-comment posting are the load-bearing flow, when the load-bearing flow is now the `dev`-branch staging deploy.

This change relaxes the PR coupling without removing PR support: previews and comments SHOULD still happen if a PR is opened, but the primary preview is `dev.tricho.app`, and e2e scenarios are reframed around the actual triggers (pushes to `dev`/`main` and the rare PR).

## What Changes

- **Reframe `cloudflare-pages-deploy`'s preview-deploy requirement.** The "every PR opened against `main` MUST trigger a preview" requirement is downgraded to SHOULD-level (preserved as a capability the system still has when used). A new MUST-level requirement is added that pushes to `dev` SHALL deploy to the `dev` branch alias on Cloudflare Pages (`dev.tricho.app`), since this is the canonical staging target in the solo flow.
- **Reframe `cloudflare-pages-deploy`'s PR-comment requirement.** The "MUST be posted as a comment on the PR" requirement is downgraded to SHOULD-level. The MUST-level invariant is reduced to "the deployment URL is discoverable" (Cloudflare Pages dashboard, GitHub run summary, or PR comment when a PR exists).
- **Reframe `e2e-testing`'s PR scenarios.** Scenarios currently phrased "GIVEN a PR whose change breaks X" are rewritten in terms of the actual CI trigger ("GIVEN a CI run on `dev` (or a PR) whose change breaks X"). The MUST-level requirement that e2e runs on every PR + push to `main` is preserved and extended to push to `dev`.
- **No code changes.** Both specs already match what `ci.yml` and the e2e workflow do today (they trigger on push to `dev`/`main` and on PRs). The deltas only adjust the *spec text* to describe the system as it actually operates.

## Capabilities

### New Capabilities

*(none)*

### Modified Capabilities

- `cloudflare-pages-deploy`: relax PR-preview and PR-comment requirements from MUST to SHOULD; add MUST-level requirement for `dev`-branch staging deploys on push to `dev`.
- `e2e-testing`: reframe PR-centric scenarios in terms of actual CI triggers (push to `dev`, push to `main`, or PR); preserve all existing MUST-level requirements about test execution, artifact upload, and parallelism.

## Impact

- **Specs**: `openspec/specs/cloudflare-pages-deploy/spec.md` and `openspec/specs/e2e-testing/spec.md` are rewritten to match operational reality.
- **No code, CI, or infrastructure change.** This is a documentation-only change. `ci.yml` already deploys on push to `dev`/`main` and on PRs; the e2e workflow already runs on the same triggers.
- **No third-party impact.** Cloudflare Pages preview behavior is unchanged. GitHub Actions permissions are unchanged.
- **No breaking changes.** All previously-mandated capabilities still exist; some are simply downgraded from MUST to SHOULD because they're no longer the everyday integration path.
