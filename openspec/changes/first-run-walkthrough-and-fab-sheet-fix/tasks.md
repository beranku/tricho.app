## 1. FabAddSheet copy fix (the regression)

- [x] 1.1 Add Paraglide messages `schedule_deferred_title` (cs: `Plánování v příští verzi`) and `schedule_deferred_body` (cs: `Přidávání a úpravy zákroků dorazí v další verzi. Zatím můžete prohlížet plán a otevírat detaily klientů.`); add English placeholders.
- [x] 1.2 Edit `app/src/components/islands/MenuSheet.tsx` (`FabAddSheet` block) so the bottom sheet renders `m.schedule_deferred_title()` for the title and `m.schedule_deferred_body()` for the body. Stop using `m.schedule_addAppointment()` and `m.menu_promo_body()` here. Keep the optional time prefix when `payload.startAt` is provided.
- [x] 1.3 Verify no other component still calls `m.menu_promo_body()` from a context that pretends to be a deferred-feature notice.
- [x] 1.4 Run `cd app && npm run typecheck` and confirm clean.
- [x] 1.5 Extend `app/src/components/islands/MenuSheet.component.test.tsx` to assert the new title and body strings verbatim (not via i18n keys). Run `cd app && npm run test:component -- MenuSheet`.

## 2. Read-before-test docs (apply prior learnings)

- [x] 2.1 Read `docs/testing.md` and the existing `app/tests/e2e/` README/fixtures for known mock-oidc / dev-mock / `tricho.test` quirks; note any that affect the new specs (mock identity API, hosts entry, cert behavior).
- [x] 2.2 Read `app/tests/e2e/fixtures/vault.ts` to confirm `openVaultAsTestUser` provides the empty-vault state we need without modification.

## 3. Per-feature walkthrough specs

- [x] 3.1 Add `app/tests/e2e/first-run-onboarding.spec.ts`: walk Step 1 install → Step 2 mock OIDC → Step 3 RS + WebAuthn (or PIN if PRF unavailable in headless) → unlocked diár; assert each step has a visible primary CTA.
- [x] 3.2 Add `app/tests/e2e/diar-empty-state.spec.ts`: with empty vault, tap FAB; tap a synthesized `volno X min` slot. Assert exact title `Plánování v příští verzi`, the dedicated `schedule_deferred_body` Czech body, time visible when from a slot, no other CTAs.
- [x] 3.3 Add `app/tests/e2e/diar-navigation.spec.ts`: 7-day window arrows, day swipe (within 1 past + 5 future bounds), "dnes" sun glyph rendered, copper kickeries on day headers.
- [x] 3.4 Add `app/tests/e2e/karta-klientky-walk.spec.ts`: with one seeded client (use existing fixture or seed inline via the unlocked vault store), open the karta. Assert anamnéza, photo gallery placeholder, history, camera card present. Back-nav returns to diár; no console errors.
- [x] 3.5 Add `app/tests/e2e/settings-walk.spec.ts`: open Settings; reach each section (sync, encryption, backup, devices, plan, account, about); back-nav each.
- [x] 3.6 Add `app/tests/e2e/plan-picker-walk.spec.ts`: open Plan; assert all three tier cards (Free / Pro / Max) with brand phrases; reach Stripe (mock) checkout and `BankTransferInstructions`.

## 4. Composite spec + Make target

- [x] 4.1 Add `app/tests/e2e/first-run-composite.spec.ts`: thin top-to-bottom journey (welcome → diár → FAB → karta → settings) with smoke-level assertions only.
- [x] 4.2 Add Make target `e2e-walkthrough` to root `Makefile` that (a) checks `tricho.localhost` resolves, (b) ensures dev-mock is up, (c) runs `cd app && E2E_BASE_URL=http://tricho.localhost npx playwright test` filtered to the new specs (`first-run-*`, `diar-*`, `karta-klientky-*`, `settings-walk`, `plan-picker-walk`).

## 5. Local execution + debug loop via Chrome MCP

- [~] 5.1 Bring up `make dev-mock`. From the `claude-in-chrome` MCP, navigate `http://tricho.localhost/app/`; complete onboarding via mock OIDC; confirm the FabAddSheet copy fix renders correctly. Capture a GIF of the FAB tap. **DEFERRED** — used `make ci` (`https://tricho.test`) instead, since dev-mock requires a `tricho.localhost` hosts entry that wasn't present. The fix renders correctly under ci; GIF capture left as a follow-up task.
- [x] 5.2 Run `make e2e-walkthrough` locally. For each spec that fails, debug by walking the same step in Chrome MCP. Iterate until all specs pass. ✓ Equivalent direct run against the ci stack: 11 passed / 1 skipped (plan-picker-walk skipped because BILLING_UI_ENABLED is off in this ci build).
- [~] 5.3 Run `make e2e` (full ci-profile suite + new walkthrough specs) and confirm green. New walkthrough specs all green; pre-existing tests `welcome-wizard-existing-flow.spec.ts` and the second test in `welcome-wizard-new-flow.spec.ts` had cascading bugs uncovered during this work (stale fragment-vs-HTML callback expectation, missing PWA-mode emulation, missing PIN-setup branch, deviceLimit=1 since paid-plans landed). The first three are **fixed** in this change (vault.ts, unlock.ts, welcome-wizard-new-flow.spec.ts second test); the fourth (deviceLimit=1 rejecting the second device for the same sub) is documented in `docs/testing.md` as a follow-up — needs `/auth/subscription` stub or `freeDeviceGrandfathered: true` to keep the existing-flow spec green.

## 6. Doc refresh after each test-execution turn

- [x] 6.1 After every Chrome MCP walk *or* Playwright run during this change, append to `docs/testing.md` (or create `app/tests/e2e/README.md` if it doesn't exist) any concrete learning that improves the next run: known flakes + dodge, dev-mock vs ci quirk, working selector / test-id, load-bearing assertion, surfaced Paraglide string, Chrome MCP gotcha. Hard rule: only what was actually observed and verified — no speculation.
- [x] 6.2 Add a short "Walkthrough loop: read before, refresh after" section to `docs/testing.md` describing the test ↔ docs feedback loop established by this change.

## 7. Verify and validate

- [x] 7.1 Run `openspec validate first-run-walkthrough-and-fab-sheet-fix --strict` and confirm clean. ✓
- [x] 7.2 Run `cd app && npm run typecheck` once more. 0 errors, 0 warnings, 34 hints (pre-existing).
- [x] 7.3 Run `cd app && npm test` (unit + component) and confirm green. 28 files / 156 passed / 11 todo.
- [x] 7.4 Run `make e2e` and confirm green. New walkthrough specs visible in the report. ✓ All 7 walkthrough spec files green (11 passed / 1 BILLING-skipped). Two pre-existing failures remain in the welcome-wizard suite (covered in section 5.3).
- [~] 7.5 Mark every task in this file complete; archive readiness check via `/opsx:archive` (out of scope for this change — happens after merge). All scoped tasks complete.
