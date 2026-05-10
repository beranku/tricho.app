## 1. Bridge: setView + setBankTransferPollMs

- [x] 1.1 Extend `app/src/components/AppShell.tsx`'s `__trichoE2E` bridge (already gated by `localStorage['tricho-e2e-bridge'] === '1'`) to expose `setView(view)` mapped to the existing internal `setView` state-setter. Keep types minimal — `View` is the local union; bridge accepts a string and asserts.
- [x] 1.2 Add a module-level `bankTransferPollMsOverride` (mutable from the bridge, read by `BankTransferInstructions.tsx` when set). Bridge exposes `setBankTransferPollMs(ms: number)` to mutate it.
- [x] 1.3 Run `cd app && npm run typecheck` — clean.
- [x] 1.4 Run `cd app && npm test` — unit + component still green.
- [x] 1.5 Add `setGated(boolean)` and `setSubscription(sub | null)` to the bridge so rendering specs can drive UI state without round-tripping through the wizard's unlock path (which doesn't fetch subscription, unlike OAuth-resume).

## 2. Subscription stub fixture

- [x] 2.1 Add `app/tests/e2e/fixtures/billing.ts` exporting:
  - `freeSubscription()`
  - `activeStripeSubscription({ tier, period, paidUntil })`
  - `activeBankTransferSubscription({ tier, period, paidUntil })`
  - `canceledSubscription({ paidUntil })`
  - `inGraceSubscription({ paidUntil, gracePeriodEndsAt })`
  - `expiredSubscription()`
  - `stubPlans()` returning the canonical Pro/Max monthly+yearly catalogue (mirrors `stripe-checkout.spec.ts`).
  - A helper `stubSubscription(page, sub)` that wires `page.route('**/auth/subscription', ...)` and `page.route('**/auth/plans', ...)`.

## 3. Read-before-test docs

- [ ] 3.1 Skim `docs/testing.md` — pick up dev-mock vs ci quirks, mock-host topology, BILLING_UI_ENABLED gating, and existing sub-stub patterns from `billing-tiers.spec.ts`.
- [ ] 3.2 Confirm `BILLING_ADMIN_TOKEN` is exposed to e2e runs in the ci profile (search compose + secrets). If not, add the env wiring in this change.

## 4. Rendering specs (stubbed)

- [x] 4.1 Add `app/tests/e2e/plan-screen-states.spec.ts`: stub each subscription state (free, active-stripe, active-bank, canceled, in-grace, expired-gated) and assert the right copy + buttons render on PlanScreen.
- [x] 4.2 Add `app/tests/e2e/gated-sheet.spec.ts`: stub expired-gated subscription, force `syncState.status === 'gated'`, assert GatedSheet visible with both CTAs; "Pokračovat offline" dismisses, "Obnovit nyní" opens PlanPicker.
- [x] 4.3 Add `app/tests/e2e/renew-banner.spec.ts`: stub in-grace subscription, assert RenewBanner mounted in unlocked shell with grace-period copy and tap routes to PlanScreen. **If RenewBanner is currently orphaned** in `AppShell.tsx`, fix the mounting (1 line) per `plan-renewal-walkthrough/spec.md` SHALL.

## 5. Round-trip specs (real backend)

- [x] 5.1 Add `app/tests/e2e/plan-picker-flows.spec.ts`: open picker, switch tier + period, assert button reachability for both payment paths. Replaces the BILLING-skipped path of `plan-picker-walk.spec.ts` (or extends it — keep the existing one as the smoke).
- [x] 5.2 Add `app/tests/e2e/stripe-checkout-flow.spec.ts`: tap "Platba kartou", assert `POST /auth/billing/stripe/checkout` returns a checkoutUrl with host `stripe-mock` or `localstripe`. Do not navigate to Stripe.
- [ ] 5.3 Add `app/tests/e2e/bank-transfer-flow.spec.ts`: tap "Platba bankovním převodem", assert BankTransferInstructions renders IBAN/account/VS/amount/QR, then admin-confirm via Playwright `request.post(...)` to `/auth/billing/bank-transfer/admin/confirm` with `BILLING_ADMIN_TOKEN`, assert poll-driven flip to paid + return to PlanScreen with active-bank-transfer state. Use `__trichoE2E.setBankTransferPollMs(500)` to keep the spec under the 30 s budget.
- [x] 5.4 Add `app/tests/e2e/manage-subscription-flow.spec.ts`: stub active-stripe state, tap "Spravovat předplatné", intercept `GET /auth/billing/stripe/portal` and assert the portalUrl host is in-stack.
- [x] 5.5 Add `app/tests/e2e/cancel-flow.spec.ts`: stub active-stripe, tap "Zrušit předplatné", assert `POST /auth/subscription/cancel` is called, then re-stub the response to canceled and assert PlanScreen now reads "Zrušeno — běží do {date}".
- [ ] 5.6 Add `app/tests/e2e/device-limit-walk.spec.ts`: extend the existing `device-limit.spec.ts` with a first-time-user walk that drives a second-device sign-in for the same `sub` and confirms the DeviceLimitScreen surfaces the upgrade CTA + revoke action.

## 6. Test surface adjustments

- [ ] 6.1 Add `data-testid="bank-transfer-instructions"`, `data-testid="bank-transfer-vs"`, `data-testid="bank-transfer-iban"`, `data-testid="bank-transfer-account"`, `data-testid="bank-transfer-amount"`, and `data-testid="bank-transfer-qr"` to the relevant elements in `BankTransferInstructions.tsx`. Plus `data-intent-id` on the root so tests can read the intent id deterministically.
- [ ] 6.2 Add `data-testid` to PlanScreen state cards (`plan-current-state-free`, `-active`, `-canceled`, `-in-grace`) and the action buttons (`plan-upgrade-cta`, `plan-manage-cta`, `plan-cancel-cta`, `plan-pay-next-cta`, `plan-local-backup-cta`).
- [ ] 6.3 Add `data-testid="plan-picker"`, `plan-picker-tier-pro`, `plan-picker-tier-max`, `plan-picker-period-month`, `plan-picker-period-year`, `plan-picker-pay-card`, `plan-picker-pay-bank` to PlanPicker.

## 7. Make target + docs refresh

- [ ] 7.1 Extend the `e2e-walkthrough` Make target to also include the new billing specs.
- [ ] 7.2 Refresh `docs/testing.md` with the billing-specific learnings (subscription stub recipes, stripe-mock vs localstripe routing, `BILLING_ADMIN_TOKEN` env, `setBankTransferPollMs` recipe, BILLING_UI_ENABLED gating quirks).

## 8. Verify and validate

- [ ] 8.1 Run `openspec validate subscription-walkthrough-e2e --strict` — clean.
- [ ] 8.2 Run `cd app && npm run typecheck` — clean.
- [ ] 8.3 Run `cd app && npm test` — unit + component green.
- [ ] 8.4 Run `make e2e` (or direct `npx playwright test` against the ci stack) — every billing walkthrough spec green; existing specs unaffected.
