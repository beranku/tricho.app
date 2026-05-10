## Why

Subscription/billing is the commercial path of tricho.app — users discover Free, upgrade to Pro/Max, manage or cancel via Stripe customer portal, pay via bank transfer with a 14-day intent + admin confirmation, hit device limits, see grace banners, and get gated when their plan expires. The wire-level happy path has tier creation tests (`stripe-checkout.spec.ts`) and a tier-card-render test (`billing-tiers.spec.ts`, currently self-skipping because the `__trichoE2E.setView` bridge is missing). What's *not* covered: the actual user-visible flows that drive revenue. There is no e2e regression guard on:
- The Plan screen rendering correctly per subscription state (free, active, canceled, in-grace, expired/gated).
- PlanPicker tier + period selection and the two payment paths (Stripe card vs. bank transfer).
- The bank-transfer round-trip the way a Czech salon owner would actually use it (intent → IBAN/VS visible → admin confirms → paid status surfaces).
- Cancel / resume flows (and the dialog confirmations + post-cancel state).
- GatedSheet (after grace ends, sync stops, sheet appears, "Pokračovat offline" or "Obnovit").
- RenewBanner inside the unlocked shell during grace period.
- DeviceLimitScreen pre- and post-unlock with the upgrade hand-off.

A single regression on any of these costs us trust *and* revenue. We need first-time-user-grade walkthroughs that cover every visible state and every reachable button.

## What Changes

- **Expose `setView` on the `__trichoE2E` bridge** so tests can navigate to `'plan'` / `'bank-transfer'` / `'device-limit'` views directly without manual menu drilling. Already used (and currently broken) by `billing-tiers.spec.ts`; un-skip that suite once the bridge is available.
- **Stub `/auth/subscription` in tests** for each subscription state we care about (free, active-stripe, active-bank, canceled, in-grace, expired-gated). Already partially done in `billing-tiers.spec.ts`; consolidate the subscription fixture so every billing spec uses it.
- **New Playwright walkthrough specs** (additive, no existing spec deleted):
  - `plan-screen-states.spec.ts` — Plan rendering for each subscription state, with the right buttons surfaced.
  - `plan-picker-flows.spec.ts` — PlanPicker tier + period selection, total amounts, both payment-path buttons.
  - `stripe-checkout-flow.spec.ts` — Real backend integration: tap "Platba kartou" → `POST /auth/billing/stripe/checkout` → server returns checkoutUrl pointing at stripe-mock or localstripe. We do not navigate to Stripe.
  - `bank-transfer-flow.spec.ts` — Full E2E: tap "Platba bankovním převodem" → BankTransferInstructions renders IBAN/VS/account/QR → admin endpoint confirms intent → polling sees `status: 'paid'` → `onPaid()` returns user to Plan screen with paid state.
  - `cancel-flow.spec.ts` — Stripe-active and bank-transfer-active subscriptions. Tap "Zrušit předplatné", verify `POST /auth/subscription/cancel` is called, verify the post-cancel UI ("Zrušeno — běží do X").
  - `manage-subscription-flow.spec.ts` — For Stripe subscribers, tap "Spravovat předplatné", verify `GET /auth/billing/stripe/portal` returns a portal URL to localstripe.
  - `gated-sheet.spec.ts` — Stub subscription to `gated`, trigger `syncState.status === 'gated'`, verify GatedSheet renders, "Pokračovat offline" dismisses, "Obnovit nyní" routes to PlanPicker.
  - `renew-banner.spec.ts` — Stub subscription with `gracePeriodEndsAt > now`, verify RenewBanner renders in unlocked shell, tap routes to Plan.
  - `device-limit-walk.spec.ts` — Pre-unlock and post-unlock DeviceLimitScreen with revoke + upgrade-hand-off CTAs, complementing the existing `device-limit.spec.ts`.
- **Refresh `docs/testing.md`** with the billing-specific learnings: subscription stub recipes, stripe-mock vs. localstripe routing in CI, the bank-transfer admin-confirm endpoint, and the JWT-refresh-after-billing-change pattern.
- **Make `make e2e-walkthrough`** also run the new billing specs (extending the target added by the previous change).

## Capabilities

### New Capabilities

(none — no new product capability is introduced.)

### Modified Capabilities

- `e2e-testing` — add a SHALL requiring the Playwright suite to include billing-flow walkthroughs covering Plan screen states, PlanPicker tier/period selection + both payment paths, bank-transfer round-trip via the admin-confirm endpoint, Stripe-portal entry, cancel/resume, GatedSheet, RenewBanner, and DeviceLimitScreen (pre- + post-unlock with upgrade hand-off).

## Impact

- **Affected code:** `app/src/components/AppShell.tsx` (`__trichoE2E.setView` exposure), new specs under `app/tests/e2e/`, possibly small `data-testid` additions to `PlanScreen.tsx`/`PlanPicker.tsx`/`BankTransferInstructions.tsx` to keep specs resilient against copy changes.
- **Affected docs:** `docs/testing.md` — billing section + bank-transfer admin recipe.
- **Zero-knowledge invariants:** No impact. No payload shape, AAD, DEK, RS, or server-side decryption changes. Stubs are local to test contexts; bank-transfer admin endpoint already exists in tricho-auth and is unchanged.
- **Dependencies:** No new packages. Reuses Playwright, the existing `openVaultAsTestUser` + `createVaultWithRs` fixtures (now corrected by the previous change), Stripe-mock + localstripe (already in the `ci` profile), and the bank-transfer admin endpoint.
- **CI:** New specs join the existing `npm run test:e2e` job. Per-spec runtime stays under the 30 s e2e tier budget (`test-strategy`); composite/round-trip flows stay under 90 s.
- **Rollback:** Pure additive. Revert this change's commits — no schema, payload, or server-state migration to undo.
