## Context

The "stuck on screen 1" report is two distinct problems wearing the same disguise:

1. **A copy regression.** `daily-schedule/spec.md` lines 79–92 has been a SHALL since the prototype: tapping the FAB or a free slot MUST open a placeholder bottom sheet that says `Plánování v příští verzi`. Commit `ff9e306` (paid plans + i18n migration) accidentally rewired `FabAddSheet` (`app/src/components/islands/MenuSheet.tsx:138-200`) to use `m.schedule_addAppointment()` for the title and `m.menu_promo_body()` for the body. The body is a generic promo string; for a first-time user this reads as a dead-end.

2. **An e2e-coverage gap.** None of the existing 22+ Playwright specs walks the diár empty state, the FAB, the settings tree, or the plan picker as a first-time user. The regression slipped past CI because no test asserted the placeholder copy.

The fix for (1) is a 5-line edit. The fix for (2) is a small, focused walkthrough suite that runs against both `make ci` (CI canonical) and `make dev-mock` (local dev with mock OIDC, ee53cfe) — drivable manually in real Chrome via the `claude-in-chrome` MCP for visual debugging and GIF capture.

## Goals / Non-Goals

**Goals:**
- Restore spec-aligned placeholder copy in `FabAddSheet`.
- Add a Playwright walkthrough that exercises every shipped feature as a first-time user, with explicit regression guards on placeholder/empty-state copy.
- Make the same specs runnable against `dev-mock` (HTTP, mock OIDC) for fast local iteration in Chrome MCP — no code changes between dev-mock and ci, just `E2E_BASE_URL`.
- Establish a test ↔ docs feedback loop: every test-execution turn refreshes `docs/testing.md` (and `app/tests/e2e/README.md`) with learnings, and reads them before the next run.

**Non-Goals:**
- Shipping the actual visit-creation form. It's deferred per `daily-schedule/spec.md:79-92` and stays deferred.
- Adding client-creation UI (also not shipped today).
- Adding diár empty-state copy beyond what the FAB sheet says. Out of scope for this round; can be a follow-up.
- New billing, sync, or recovery flows — already covered by existing specs.
- Touching server-side anything. Pure client-side + test-tier change.

## Decisions

**Decision 1: Bundle the copy fix and the regression-guard tests in one change.**

Alternatives considered: split the FabAddSheet copy fix into a tiny hotfix change and ship the e2e suite separately. Rejected because the walkthrough specs *are* the regression guard — keeping them in lock-step in a single PR means the SHALL, the implementation, and the proof are reviewed together. The cost of bundling is small (the diff is still under ~500 lines of test code plus a 5-line copy edit).

**Decision 2: No spec change to `daily-schedule`.**

`daily-schedule/spec.md:79-92` already requires the placeholder. The defect is that the code doesn't honor an existing SHALL. We align code to spec; we do not duplicate or restate the SHALL anywhere else.

**Decision 3: Modify `e2e-testing` (not `test-strategy`).**

`test-strategy` defines tier shapes/budgets/coverage thresholds. `e2e-testing` defines what the Playwright suite must cover end-to-end. The first-run walkthrough is a content requirement on the e2e suite — it belongs in `e2e-testing`. We add one new SHALL there; we don't touch `test-strategy`.

**Decision 4: Run the same specs against `dev-mock` and `ci` via `E2E_BASE_URL`.**

`app/playwright.config.ts` already reads `process.env.E2E_BASE_URL ?? 'https://tricho.test'`. The new specs MUST NOT hardcode `https://tricho.test` — they use `playwright`'s `page.goto('/')` so the baseURL flows through.

Rejected alternative: separate spec files per profile. Code duplication; drift risk.

**Decision 5: Reuse `openVaultAsTestUser` fixture for empty-vault state.**

Each spec invocation gets a unique `sub` via the existing fixture (`app/tests/e2e/fixtures/vault.ts`). That gives a deterministic "first-time user with empty vault" state for free. We do not invent a separate reset helper — the fixture already provides it.

**Decision 6: Add a thin composite spec only for GIF capture and smoke.**

The composite walks onboarding → diár → FAB → karta klientky → settings in one go. It exists for two reasons: (a) the per-feature specs run independently, but the composite proves the journey hangs together; (b) it's the natural target for `gif_creator` so the change ships with a visual demo. Composite assertions are deliberately thin — the per-feature specs do the heavy lifting.

**Decision 7: `make e2e-walkthrough` runs only the new specs, only against `dev-mock`.**

Goal: a fast local loop for Chrome MCP debugging. The full `make e2e` target stays the canonical CI runner. The new target is a developer convenience, not a CI gate. Implementation is a Make target that:
1. Confirms `tricho.localhost` resolves
2. Brings up `dev-mock` profile if not already up
3. Runs `cd app && E2E_BASE_URL=http://tricho.localhost npx playwright test tests/e2e/{first-run,diar,karta,settings,plan-picker}-*.spec.ts --headed`

**Decision 8: Test ↔ docs feedback loop is a contract, not a one-shot.**

`docs/testing.md` gets a new short section "Walkthrough loop: read before, refresh after". Every test-execution turn (Chrome MCP walk OR Playwright run) must:
- *Before*: read the current `docs/testing.md` for known flakes/selectors/quirks.
- *After*: append concrete learnings (no speculation; only what was actually observed and verified).

This is enforced by reviewer convention, not by tooling — a SHALL would be wrong because the loop runs at developer speed, not CI speed.

## Risks / Trade-offs

- **[Risk] The regression guard is sensitive to copy changes.** If we ever legitimately reword the placeholder, the test fails until updated. → *Mitigation:* the spec (`daily-schedule:79-92`) is the source of truth — any copy change must land alongside a spec change, and the test asserts spec-aligned copy. Failing first is fine.

- **[Risk] `make dev-mock` requires `tricho.localhost` in `/etc/hosts`.** If a contributor hasn't set it up, `make e2e-walkthrough` fails fast. → *Mitigation:* the Make target's first step checks `getent hosts tricho.localhost` (or equivalent on macOS) and prints a clear remediation message.

- **[Risk] Walkthrough specs are slower than focused unit tests.** Each spec drives a real browser and full OAuth round-trip. → *Mitigation:* keep per-spec runtime under 30 s (the e2e tier budget from `test-strategy`); the composite under 90 s. Use existing fixtures so no spec re-derives setup.

- **[Risk] Chrome MCP usage is not part of CI.** The MCP loop is a developer-side tool. CI relies on Playwright only. → *Mitigation:* every assertion that matters lives in a Playwright spec; Chrome MCP is for visual debugging and GIF capture, not for verification.

- **[Trade-off] Bundling fix + tests means a slightly larger PR.** Worth it: the SHALL, the code, and the proof land together.

- **[Trade-off] No diár empty-state UX in this round.** A first-time user on the empty diár still sees synthesized free slots and (after the fix) a clear "later" message when tapping. We accept that this is technically OK but not delightful, and leave the empty-state hint to a follow-up.

## Threat-model delta

No change. This work touches no key material, no transport, no payload shape, no AAD. The Playwright suite uses the existing `openVaultAsTestUser` fixture which already operates against the mock OIDC stack. No plaintext is observable to the server before or after this change.

## Migration plan

1. Land the copy fix + Paraglide messages.
2. Land the per-feature walkthrough specs.
3. Land the composite spec + `make e2e-walkthrough`.
4. Land the `e2e-testing` SHALL delta + `docs/testing.md` updates.
5. Verify locally: `make dev-mock` then `make e2e-walkthrough` — every spec green.
6. Verify on CI: `make e2e` — full suite + new walkthrough specs green on the ci profile.

**Rollback:** revert the change. No schema, no payload, no server-side migration to undo.

## Open questions

None. The deferred-feature SHALL on `daily-schedule` is unambiguous. The walkthrough scope is fully derived from "every feature actually shipped today" (enumerated in proposal.md). Any new feature later (e.g., the actual visit-creation form) gets its own spec and its own walkthrough coverage as part of *that* change, not this one.
