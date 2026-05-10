## ADDED Requirements

### Requirement: Subscription walkthrough specs cover every state and visible button

The Playwright suite under `tests/e2e/` MUST include a **subscription walkthrough** — a set of specs that exercise every shipped subscription/billing surface from a real user's perspective. The walkthrough MUST include:

- A spec that asserts **PlanScreen** renders the correct content + buttons for each subscription state: `free`, `active-stripe`, `active-bank-transfer`, `canceled` (within paidUntil), `in-grace` (paidUntil < now < gracePeriodEndsAt), `expired-gated` (gracePeriodEndsAt < now). Subscription stubs come from a shared `app/tests/e2e/fixtures/billing.ts` so every spec uses the same canonical states.
- A spec that walks **PlanPicker**: tier cards (Pro / Max), period tabs (Měsíčně / Ročně), correct totals per combination, both payment-path buttons reachable ("Platba kartou (opakovaně)" and "Platba bankovním převodem (jednorázově)").
- A spec that drives the **Stripe checkout** endpoint end-to-end: tap the card-payment button → `POST /auth/billing/stripe/checkout` is called with the selected plan → response carries a `checkoutUrl` whose host is the in-stack mock (`stripe-mock` for SDK-contract or `localstripe` for the Checkout flow). The test does NOT navigate to Stripe Hosted Checkout itself.
- A spec that drives the **bank-transfer round-trip** end-to-end: tap the bank-payment button → `POST /auth/billing/bank-transfer/intent` mints an intent → BankTransferInstructions renders IBAN + account + VS + amount + Czech SPAYD QR → test calls `POST /auth/billing/bank-transfer/admin/confirm` with the intent id and `BILLING_ADMIN_TOKEN` → the next polling tick sees `status: 'paid'` → `onPaid()` returns the user to PlanScreen which now shows the active-bank-transfer state.
- A spec that drives **manage subscription** for Stripe subscribers: tap "Spravovat předplatné" → `GET /auth/billing/stripe/portal` returns a `portalUrl` whose host is the in-stack Stripe mock.
- A spec that drives **cancel** for both Stripe and bank-transfer subscribers: tap "Zrušit předplatné" → `POST /auth/subscription/cancel` is called → the post-cancel UI reads "Zrušeno — běží do {date}" and the cancel button is no longer surfaced.
- A spec that asserts **GatedSheet** renders when `syncState.status === 'gated'`, exposes "Obnovit nyní" and "Pokračovat offline" CTAs, dismisses on "Pokračovat offline", and routes to PlanPicker on "Obnovit nyní".
- A spec that asserts **RenewBanner** renders in the unlocked shell when `isInGrace(sub) === true`, and tapping the banner routes to PlanScreen.
- A spec that walks **DeviceLimitScreen** pre-unlock and post-unlock with the device list, the revoke action, and the upgrade hand-off (when `onUpgrade` is wired).

Every walkthrough spec SHALL pass without modification under both the `ci` profile (`https://tricho.test`) and the `dev-mock` profile (`http://tricho.localhost/app/`) by honoring `E2E_BASE_URL` from `playwright.config.ts`. Where a real backend call is needed, the test MUST exercise the live `tricho-auth` endpoint; where only a rendering assertion is wanted, the test MUST stub `/auth/subscription` (and `/auth/plans` if applicable) via `page.route(...)`.

#### Scenario: PlanScreen renders the canceled state with the correct copy and no cancel button

- **GIVEN** a stub for `/auth/subscription` returning `{ tier: 'paid', provider: 'stripe', status: 'canceled', paidUntil: <future> }`
- **WHEN** the test navigates to the Plan view (via `__trichoE2E.setView('plan')` or via Settings → Předplatné)
- **THEN** the page shows the heading `Zrušeno — běží do {date}`
- **AND** the cancel button (`Zrušit předplatné`) is not surfaced (already canceled)
- **AND** the manage button (`Spravovat předplatné`) is not surfaced (provider is canceled)

#### Scenario: PlanPicker exposes both payment paths and switches periods

- **GIVEN** a free user on the Plan screen
- **WHEN** the user taps "Přejít na Sync" and the picker opens
- **THEN** Pro and Max tier cards are rendered
- **AND** the period tabs Měsíčně and Ročně are present
- **AND** tapping each card highlights the selected tier
- **AND** the buttons "Platba kartou (opakovaně)" and "Platba bankovním převodem (jednorázově)" appear once a tier is selected

#### Scenario: Stripe checkout endpoint returns a mock-host URL

- **GIVEN** a free user with a chosen tier + period in the picker
- **WHEN** the user taps "Platba kartou (opakovaně)"
- **THEN** `POST /auth/billing/stripe/checkout` is called with the chosen plan id
- **AND** the response body has `checkoutUrl` with a host of `stripe-mock` or `localstripe` (in-stack), not `checkout.stripe.com`

#### Scenario: Bank-transfer round-trip lands the user on the active-bank state

- **GIVEN** a free user with a chosen tier + period in the picker
- **WHEN** the user taps "Platba bankovním převodem (jednorázově)"
- **THEN** `POST /auth/billing/bank-transfer/intent` mints an intent with a unique 10-digit VS
- **AND** BankTransferInstructions renders the IBAN, account number, VS, amount, and a Czech SPAYD QR canvas
- **AND** the test calls `POST /auth/billing/bank-transfer/admin/confirm` with the rendered `intentId` and the `BILLING_ADMIN_TOKEN` from CI secrets
- **AND** within the configured poll interval, BankTransferInstructions sees `status: 'paid'` and routes back to PlanScreen
- **AND** PlanScreen renders the active-bank-transfer state for the chosen tier + period

#### Scenario: GatedSheet routes to PlanPicker on "Obnovit nyní"

- **GIVEN** a stub for `/auth/subscription` returning the expired-gated state
- **AND** the unlocked shell has surfaced GatedSheet because `syncState.status === 'gated'`
- **WHEN** the user taps "Obnovit nyní"
- **THEN** the PlanPicker modal opens
- **AND** the GatedSheet is no longer visible

#### Scenario: RenewBanner is mounted during grace period

- **GIVEN** a stub for `/auth/subscription` returning the in-grace state (`paidUntil < now < gracePeriodEndsAt`)
- **WHEN** the unlocked shell renders
- **THEN** the RenewBanner is visible at the top of the shell with the grace-period copy
- **AND** tapping the banner routes the user to PlanScreen

#### Scenario: DeviceLimitScreen offers revoke + upgrade hand-off

- **GIVEN** a free-tier user (deviceLimit = 1) signs in on a second device
- **WHEN** the auth callback rejects the device with `deviceApproved: false`
- **THEN** the AppShell mounts DeviceLimitScreen
- **AND** the screen lists the user's devices with a revoke action per non-current row
- **AND** an "Upgradnout místo revokace" CTA is surfaced when `BILLING_UI_ENABLED` is on
- **AND** tapping the CTA routes the user to PlanScreen

### Requirement: Bridge exposes a setView and a configurable bank-transfer poll interval

`AppShell.tsx`'s `__trichoE2E` test bridge — gated by `localStorage['tricho-e2e-bridge'] === '1'` — MUST expose, in addition to the existing vault primitives:

- `setView(view: View): void` — programmatic equivalent of the internal `setView` state-setter, so tests can land on `'plan'`, `'bank-transfer'`, `'device-limit'`, etc., without drilling through the menu.
- `setBankTransferPollMs(ms: number): void` — overrides the BankTransferInstructions polling interval (default 30 s in production) so tests don't wait 30 s for a status flip.

Both methods MUST be no-ops when the bridge is disabled (production has no way to flip the localStorage flag). Both methods MUST live under the same `if (localStorage.getItem('tricho-e2e-bridge') === '1')` gate as the existing bridge methods.

#### Scenario: setView routes the AppShell view

- **GIVEN** the bridge is enabled (`localStorage['tricho-e2e-bridge'] === '1'`)
- **AND** the user is in the unlocked view
- **WHEN** a test calls `__trichoE2E.setView('plan')`
- **THEN** the AppShell renders the PlanScreen

#### Scenario: setBankTransferPollMs accelerates polling

- **GIVEN** a bank-transfer intent is pending and BankTransferInstructions is rendered
- **WHEN** a test calls `__trichoE2E.setBankTransferPollMs(500)` and then admin-confirms the intent
- **THEN** within ~1 s, BankTransferInstructions sees `status: 'paid'` and routes back to PlanScreen
