## Context

Tricho.app has transitioned from a "PR-oriented" mental model (every change goes through a PR; PR previews are the integration test surface) to a single-developer "direct push to `dev`, promote to `main`" flow. This is documented in `docs/DEVELOPER.md` ("Day-to-day development (solo flow)") and enforced operationally by:

- `ci.yml` — triggers on push to `dev` and `main` (and on PRs against `main`); deploys to a per-branch Cloudflare Pages alias (`dev.tricho.app`, `tricho.app`, or `<branch>.tricho.pages.dev` for PRs).
- `promote-dev-to-main.yml` — a `workflow_dispatch` action that fast-forwards `main` to `dev`'s tip, tags `prod-YYYY-MM-DD-<shortsha>`, and dispatches `ci.yml` on `main` to run the production deploy.

Two existing specs still encode the old PR-as-primary-mechanism worldview:

- `openspec/specs/cloudflare-pages-deploy/spec.md` MUSTs that "every pull request opened against `main` MUST trigger a deploy to a unique preview URL" and "MUST be posted as a comment on the PR". Both are accurate descriptions of capabilities the system retains, but they're not the *load-bearing* deploy path anymore.
- `openspec/specs/e2e-testing/spec.md` frames its CI behavior in terms of `tests.yml` and `e2e.yml` (workflow files that no longer exist; e2e logic lives elsewhere) and uses "GIVEN a PR" framing for scenarios that fire on any CI run.

The risk of leaving these as-is isn't that the system breaks — both specs are vacuously satisfied today — but that an outside reader of the specs draws the wrong conclusion about how releases happen and what triggers what.

## Goals / Non-Goals

**Goals:**

- Specs accurately describe the operational reality: `dev`-branch deploys are MUST-level (this is the everyday staging target), PR-only behaviors are SHOULD-level (capability preserved but no longer load-bearing).
- e2e scenarios are phrased in terms of the actual CI triggers (push to `dev`, push to `main`, PR), not "GIVEN a PR" alone.
- No code or workflow changes — the system already does what the new spec text describes; we're correcting the *description*, not changing behavior.

**Non-Goals:**

- Removing PR support. PRs continue to work end-to-end; previews and comments are preserved as SHOULD-level capabilities.
- Changes to `ci.yml`, `promote-dev-to-main.yml`, or any infrastructure. Those are already correct.
- Updating the `Purpose` section of `e2e-testing/spec.md` (which references `tests.yml`). That string is wrong but lives outside the Requirements section. A follow-up change can address Purpose-section drift across all specs as a doc-cleanup pass.
- Touching specs that are PR-flavored but not actually changing (e.g., `passkey-prf-unlock`, `vault-keystore`) — none of those have PR-centric requirements; their "PR" hits in the audit were red herrings.

## Decisions

### Decision 1: REMOVE the PR-preview MUST + ADD two replacements (rather than MODIFY)

The existing "PR runs deploy a unique preview URL and post the link as a PR comment" requirement bundles two things — branch-aliased preview deploys, and PR-comment posting — and both change in different ways. Rather than rewrite that requirement in place, we REMOVE it and ADD two cleaner replacements:

1. **"Branch-aliased deploys for `dev`, `main`, and PR branches"** (MUST) — describes the actual deploy targeting (`dev` → `dev.tricho.app`, `main` → `tricho.app`, PR branches → preview URL).
2. **"PR runs SHOULD post a preview-URL comment"** (SHOULD) — preserves the comment-posting capability without making it load-bearing.

**Alternatives considered:**

- *MODIFIED in place.* Cleaner change history, but the new requirement is shaped differently enough that a rewrite-in-place loses the natural split between "where deploys go" (MUST) and "what gets posted on a PR" (SHOULD). REMOVE + ADD reflects the conceptual restructuring.
- *Three separate requirements (`dev` deploy, `main` deploy, PR preview).* Overkill — the unifying concept is "deploy `--branch` is set from the git ref name", which fits cleanly in one MUST.

### Decision 2: MODIFY the path-filter requirement to include push-to-`dev`

The current path-filter requirement's scenarios are all "GIVEN a PR that modifies …". The path-filter logic actually runs on every CI invocation including pushes to `dev` (this is what makes solo-flow CI fast — a `web/`-only commit on `dev` skips `test-app`). Reframing the scenarios in terms of "a change" instead of "a PR" makes the spec accurate without changing behavior.

The requirement's MUST-level "deploy job MUST run on every PR and on every push to `main`" is also too narrow — it omits pushes to `dev`, which are exactly when staging deploys happen. We extend it to cover all three.

### Decision 3: e2e-testing — fix workflow filenames and broaden triggers in MODIFIED requirements

The "CI workflow produces actionable artifacts on failure" requirement names `.github/workflows/e2e.yml`, which doesn't exist. Operationally, e2e runs via `ci.yml` (or via `make e2e` locally; CI orchestration uses ci.yml). We rename the file reference and broaden triggers to push-to-`dev` (already the case operationally; the spec just doesn't say so).

### Decision 4: Don't touch the `Purpose` section of `e2e-testing/spec.md`

The Purpose section says `Source files: ... .github/workflows/tests.yml`. `tests.yml` was deleted; the actual file is `ci.yml`. This is wrong but is outside the Requirements section, and OpenSpec deltas operate on Requirements. Fixing Purpose-section drift across all specs is its own change — not blocked by this one.

## Risks / Trade-offs

- **Risk: REMOVING a MUST-level requirement reads as a regression.** Mitigation: the REMOVED block names the replacement requirements explicitly so readers can confirm capability is preserved (downgraded, not deleted). The proposal calls out that this is a description-fix, not a behavior-change.
- **Risk: SHOULD-level requirements drift further over time** (e.g., PR-comment posting silently breaks, no MUST-level test catches it). Mitigation: out of scope for this change. If PR-comment posting becomes important again, future change can re-promote it. Today's reality is that it's not exercised.
- **Trade-off: The path-filter scenarios become slightly less concrete** when reframed from "PR that modifies …" to "a change that modifies …". The scenario is still testable (path filter behavior is observable on any CI run), but loses the implicit "and the PR is what triggered it" framing.

## Migration Plan

This is a documentation-only change. Apply order:

1. Update `openspec/specs/cloudflare-pages-deploy/spec.md`: REMOVE the old PR-preview requirement, ADD the two replacements, MODIFY the path-filter requirement.
2. Update `openspec/specs/e2e-testing/spec.md`: MODIFY the affected requirements.
3. Archive this change via `openspec-archive-change` once both specs are merged.

No rollback plan needed — these are doc edits with no operational impact.

## Open Questions

- *Should the new "Branch-aliased deploys" requirement enumerate exact host names (`dev.tricho.app`, `tricho.app`)?* Tentatively yes — the host-to-branch mapping is already part of the operational contract (Cloudflare custom domain settings) and naming it in the spec keeps the contract checkable.
- *Should the SHOULD-level PR-preview requirement specify what to do when posting fails (silent skip vs hard fail)?* Tentatively silent skip, since PR posting is a convenience, not a gate. Out of scope to spec further.
