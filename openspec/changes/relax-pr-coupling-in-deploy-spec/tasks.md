## 1. Apply spec deltas to live specs

- [x] 1.1 In `openspec/specs/cloudflare-pages-deploy/spec.md`, REMOVE the existing requirement "PR runs deploy a unique preview URL and post the link as a PR comment" (heading + all scenarios).
- [x] 1.2 In the same file, ADD the new requirement "Branch-aliased deploys for `dev`, `main`, and PR branches" with its three scenarios (push-to-`dev`, push-to-`main`, PR run), as written in `specs/cloudflare-pages-deploy/spec.md` of this change.
- [x] 1.3 In the same file, ADD the new SHOULD-level requirement "PR runs SHOULD post a preview-URL comment" with its two scenarios (happy path, posting failure). *(Tightened wording during apply: kept "post or not" as SHOULD, but elevated the comment-content schema and the must-not-fail-workflow-on-post-failure clauses to MUST so the requirement satisfies `openspec validate`'s SHALL/MUST-presence rule. Mirrored the wording change into this change's delta to keep proposal record and applied spec in sync.)*
- [x] 1.4 In the same file, MODIFY the requirement "Path-filtered tests skip the unaffected side": broaden the deploy-job-must-run clause to include pushes to `dev`, and reframe the three scenarios from "PR" to "change".
- [x] 1.5 In `openspec/specs/e2e-testing/spec.md`, MODIFY "CI workflow produces actionable artifacts on failure": rename the workflow file reference from `.github/workflows/e2e.yml` to `.github/workflows/ci.yml`, broaden triggers to include push-to-`dev`, and reframe the failing scenario in terms of "any failing CI run" rather than "PR whose change breaks X".
- [x] 1.6 In the same file, MODIFY "E2E boot is hermetic and reproducible": reframe the parallelism scenario from "two pull requests triggering `e2e.yml` concurrently" to "two CI runs triggered concurrently".
- [x] 1.7 In the same file, MODIFY "Two-browser-context harness is the convention for cross-device specs": reframe the second scenario from "GIVEN a PR adding a `tests/e2e/*.spec.ts`" to "GIVEN a commit on `dev` (or a PR) adding a `tests/e2e/*.spec.ts`", and rename "contributor" to "developer" in the first scenario for solo-flow consistency.

## 2. Validate

- [x] 2.1 Run `openspec validate cloudflare-pages-deploy` and `openspec validate e2e-testing` (or whatever the project's validation entry point is) and confirm no errors. If the command doesn't exist, manually verify each requirement still has at least one `#### Scenario:` heading and that no requirement names are duplicated. *(Both pass `openspec validate`. Initial run flagged "PR runs SHOULD post a preview-URL comment" for missing SHALL/MUST — fixed in 1.3 by promoting comment-content + non-failure clauses to MUST while keeping the post-or-not stance as SHOULD.)*
- [x] 2.2 Read both modified spec files top-to-bottom and confirm: (a) MUST/SHALL/SHOULD usage is consistent with the new SHOULD-level downgrade for PR-comment posting; (b) all scenarios match the four-hashtag header format; (c) no requirement was orphaned (i.e., no requirement now has zero scenarios). *(Verified via grep + awk pass: zero `### Scenario:` (3-hashtag) headers, zero requirements with no scenarios, zero duplicate requirement names. cloudflare-pages-deploy now has 10 requirements (was 9; net +1 from REMOVED 1 + ADDED 2).)*

## 3. Archive

- [ ] 3.1 Once both spec files are merged on `main`, run `openspec-archive-change relax-pr-coupling-in-deploy-spec` to move this change directory to `openspec/changes/archive/<date>-relax-pr-coupling-in-deploy-spec/`.
- [ ] 3.2 Verify the live spec files in `openspec/specs/cloudflare-pages-deploy/spec.md` and `openspec/specs/e2e-testing/spec.md` reflect the deltas after archive.
