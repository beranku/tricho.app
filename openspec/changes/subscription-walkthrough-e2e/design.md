## Context

Billing in tricho.app spans three layers:

1. **PlanScreen** (`app/src/components/PlanScreen.tsx`) — the canonical landing view for everything subscription-related. Renders different cards depending on `subscription.tier` (free/paid), `subscription.provider` (stripe/bank-transfer), `subscription.status` (active/canceled), and whether the plan is `isInGrace(sub)`. Buttons surfaced are state-dependent: free shows "Přejít na Sync", Stripe-active shows manage + cancel, bank-transfer-active shows "Zaplatit další období" + cancel, etc.

2. **PlanPicker** (`app/src/components/PlanPicker.tsx`) — modal opened from PlanScreen. Tier cards (Pro / Max), period tabs (Měsíčně / Ročně), and two payment buttons: "Platba kartou (opakovaně)" → `POST /auth/billing/stripe/checkout` → redirect to Stripe-hosted checkout; "Platba bankovním převodem (jednorázově)" → `POST /auth/billing/bank-transfer/intent` → client-side route to BankTransferInstructions.

3. **BankTransferInstructions** (`app/src/components/BankTransferInstructions.tsx`) — shows IBAN / account / VS / amount + a Czech SPAYD-format QR code. Polls the intent every 30 s. When the admin confirms the payment (`POST /auth/billing/bank-transfer/admin/confirm` with `BILLING_ADMIN_TOKEN`), the next poll sees `status: 'paid'`, refreshes subscription, and `onPaid()` routes back to PlanScreen.

Plus three subscription-state surfaces:
- **GatedSheet** (`app/src/components/GatedSheet.tsx`) — non-blocking bottom sheet on the unlocked shell when `syncState.status === 'gated'` (after grace ends).
- **RenewBanner** (`app/src/components/RenewBanner.tsx`) — copper banner in the unlocked shell when `isInGrace(sub) === true`.
- **DeviceLimitScreen** (`app/src/components/DeviceLimitScreen.tsx`) — full-screen view pre- and post-unlock when the user exceeds their tier's deviceLimit.

The wire-level subscription endpoints (server side) are already covered by backend integration tests. What is *not* covered is the end-to-end user-visible surface: which buttons appear in which state, what each button calls, what the post-action UI looks like.

## Goals / Non-Goals

**Goals:**
- A first-time-user-grade walkthrough for every subscription state and every visible button on Plan / PlanPicker / BankTransferInstructions / GatedSheet / RenewBanner / DeviceLimitScreen.
- Drive the bank-transfer round-trip including the admin-confirm step so the polling-and-flip-to-paid behaviour is exercised end-to-end against the real `tricho-auth` server.
- Drive the Stripe checkout endpoint and assert the returned URL points at the in-stack mock (stripe-mock for the SDK contract, localstripe for the Checkout flow). We do *not* drive the Stripe Hosted Checkout UI itself — that's stripe's surface, not ours.
- Stub `/auth/subscription` for each rendering state we care about (free, active-stripe, active-bank, canceled, in-grace, expired-gated), so the rendering specs are deterministic and don't depend on backend mutation order.
- Reuse the corrected `openVaultAsTestUser` + `createVaultWithRs` fixtures from the previous change. PWA mode + cs-CZ locale + PIN-setup-substep handling stay in `unlock.ts`.

**Non-Goals:**
- Real Stripe Hosted Checkout UI walks. The page is Stripe's, not ours; we only assert the redirect URL is correct.
- New billing endpoints, new tiers, new pricing, currency changes — all out of scope.
- The `PlanPreviewCard` welcome-wizard surface (mentioned in `plan-renewal-walkthrough` spec). That belongs in the next walkthrough change, not this one.
- The `PlanChangedConfirmation` surface mandated by `plan-renewal-walkthrough` — not yet shipped; we don't fabricate coverage for unshipped surfaces.

## Decisions

**Decision 1: Expose `setView` on the `__trichoE2E` bridge.**

`billing-tiers.spec.ts` already calls `__trichoE2E.setView('plan')` and self-skips when the symbol is missing. The bridge currently only exposes vault primitives. Adding `setView` is one line in `AppShell.tsx` (the existing `bridge =` definition near line 593), gated by the same `tricho-e2e-bridge` localStorage flag. This unblocks `billing-tiers.spec.ts` *and* every new billing spec — without it, every test would have to drill through the Settings menu to reach Plan.

Alternative considered: keep using menu navigation. Rejected: menu navigation depends on Settings rendering the "Předplatné" card, which is conditional on `BILLING_UI_ENABLED`. If that flag is off, every test that just wants to render the Plan view (for a different reason — e.g., asserting GatedSheet) would skip. Direct view-control via the bridge is the cleanest decoupling.

**Decision 2: Stub `/auth/subscription` per subscription state.**

Each rendering state is captured as a fixture in a shared `app/tests/e2e/fixtures/billing.ts`:
- `freeSubscription()`
- `activeStripeSubscription({ tier, period, paidUntil })`
- `activeBankTransferSubscription({ tier, period, paidUntil })`
- `canceledSubscription({ paidUntil })` (within paidUntil window)
- `inGraceSubscription({ paidUntil, gracePeriodEndsAt })` (paidUntil < now < gracePeriodEndsAt)
- `expiredSubscription()` (gracePeriodEndsAt < now → gated)

Tests `page.route('**/auth/subscription', ...)` to fulfill the right state, then assert the rendering. This isolates UI behaviour from backend mutation order and keeps the specs fast.

**Decision 3: Drive the bank-transfer round-trip end-to-end.**

The admin endpoint `POST /auth/billing/bank-transfer/admin/confirm` lives in tricho-auth. CI must export `BILLING_ADMIN_TOKEN` so a test can call it. Each test:
1. Drives `createVaultWithRs` (lands unlocked diár).
2. `__trichoE2E.setView('plan')`.
3. Opens PlanPicker, selects Pro/Yearly, taps "Platba bankovním převodem".
4. Asserts BankTransferInstructions renders with IBAN/VS/account/amount/QR.
5. Reads the `intentId` from the rendered DOM (or from the stash, see Decision 5).
6. From Node-side (Playwright `request` fixture), POSTs to `/auth/billing/bank-transfer/admin/confirm` with `intentId`.
7. Waits for the polling tick (default 30 s — we'll override to a faster interval in tests via init script, see Decision 6) to see `status: 'paid'` and `onPaid()` to route back to PlanScreen.
8. Asserts PlanScreen now shows the active-bank-transfer state.

**Decision 4: Stripe checkout — assert URL, do not navigate.**

`POST /auth/billing/stripe/checkout` returns `{ checkoutUrl }`. We intercept the response (or call `__trichoE2E` to get the URL programmatically), then assert the host is `stripe-mock` (for SDK contract via ci profile internal traefik route) or `localstripe` (when `STRIPE_API_BASE` is set to localstripe). We do not navigate to Stripe Hosted Checkout — its DOM is stripe's surface and unstable.

**Decision 5: Expose `intentId` on the page after PlanPicker triggers bank transfer.**

Currently the picker calls `onBankTransferIntent(intentId)` which routes the AppShell to the bank-transfer view. The view receives `bankIntentId` as a prop. Tests need a way to read this without inspecting React internals. Two options:
- (A) Add `data-testid="bank-transfer-intent-id"` (with the value as `data-intent-id`) on the BankTransferInstructions root. Cheap, no internal API surface change.
- (B) Add `getCurrentBankIntentId()` to the bridge.

We pick (A) — fewer moving parts, easier to grep, doesn't grow the bridge surface.

**Decision 6: Reduce the bank-transfer poll interval for tests.**

`POLL_INTERVAL_MS = 30_000` in `BankTransferInstructions.tsx` is fine for production but turns a 5 s test into a 30+ s wait. Two options:
- (A) Make the interval configurable via `__trichoE2E` (e.g., `setBankTransferPollMs(500)`).
- (B) Have the test trigger an extra fetch by calling a bridge method or by clicking a button.
- (C) Keep the interval; specs that need fast poll just `waitFor` up to 35 s.

We pick (A) — minimal surface (one bridge method), keeps tests fast, doesn't pollute production code with `if (TEST) { ... }` branches.

**Decision 7: Subscription state stubs are read-only.**

The stubs do not also stub the underlying CouchDB state. Tests that need real backend behaviour (bank-transfer round-trip, Stripe checkout URL) talk to the real tricho-auth. Tests that just want to render a UI state (canceled card, grace banner) stub. Mixing both in one spec is allowed when needed but the default is "stub for rendering, real backend for behaviour."

## Risks / Trade-offs

- **[Risk] `__trichoE2E.setView` becomes a behavioural test surface that drifts from real navigation.** → *Mitigation:* the existing walkthrough specs (`first-run-composite`, `settings-walk`) cover real menu→Settings→Plan navigation. The new specs use `setView` only to skip menu drilling for *non-navigation* concerns (rendering states, click handlers).

- **[Risk] Bank-transfer admin endpoint requires `BILLING_ADMIN_TOKEN` which lives in SOPS-encrypted secrets.** → *Mitigation:* CI already mounts these secrets; tests read the token from `process.env` like other admin specs (e.g., the existing `admin.ts` fixture for CouchDB). If the env var is missing, the bank-transfer round-trip spec self-skips with a clear message.

- **[Risk] Reducing the bank-transfer poll interval via the bridge is a test-only escape hatch in production code.** → *Mitigation:* the bridge already only attaches when `localStorage['tricho-e2e-bridge'] === '1'` is set, which production can never set. Adding one method behind that same flag does not change the production surface.

- **[Risk] `data-testid` on BankTransferInstructions adds non-functional attributes to production HTML.** → *Mitigation:* same pattern as the rest of the codebase (welcome wizard, Settings, FabAddSheet). It's a known cost we already accept.

- **[Trade-off] The Stripe Hosted Checkout DOM is not exercised.** → That DOM is stripe-controlled and unstable. The `localstripe` shim already serves `/js.stripe.com/v3/`, so a future spec could exercise it; for now we keep scope tight.

## Threat-model delta

No change. This work touches no key material, no transport, no payload shape, no AAD. The bridge `setView` and `setBankTransferPollMs` are gated by the existing `tricho-e2e-bridge` localStorage flag (only enabled in tests). Subscription stubs are local to the test browser context. Bank-transfer admin endpoint is unchanged; we just exercise it from tests.

## Migration plan

1. Land `__trichoE2E.setView` + `__trichoE2E.setBankTransferPollMs` bridge additions.
2. Land the shared `app/tests/e2e/fixtures/billing.ts` subscription fixtures.
3. Land the rendering specs (plan-screen-states, gated-sheet, renew-banner) — these stub everything and are fast.
4. Land the round-trip specs (stripe-checkout-flow, bank-transfer-flow, manage-subscription-flow, cancel-flow, plan-picker-flows) — these talk to real tricho-auth.
5. Land `device-limit-walk` (extends existing `device-limit.spec.ts`).
6. Refresh `docs/testing.md` with the billing-specific learnings.
7. Verify `make e2e-walkthrough` runs the new specs.
8. Verify `make e2e` keeps the full ci suite green.

**Rollback:** revert the change. No schema, no payload, no server-side migration.

## Open questions

- **`PlanChangedConfirmation`** is mandated by `plan-renewal-walkthrough/spec.md` but not implemented. Should this change *add* it, or just guard the not-yet-shipped surface? *Decision:* skip — the previous change's principle stands ("only test what's actually shipped"). Adding the component is a separate product change.

- **`RenewBanner` is currently orphaned** in `AppShell.tsx` (imported but not always mounted). Spec says it MUST be mounted in the unlocked shell when `isInGrace(sub)`. If the test fails because the banner never renders, do we fix the mounting in this change or open a follow-up? *Decision:* fix the mounting if it's a 1-line change; otherwise file a follow-up. The existing SHALL on `plan-renewal-walkthrough` is what we align to.
