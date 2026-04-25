## ADDED Requirements

### Requirement: Plan screen surfaces current state
A `PlanScreen` React component SHALL render the user's current plan, `paidUntil`, days remaining, and provider-appropriate CTAs. It MUST be reachable from the Settings screen via a Plan row, and from the device-limit screen via the upgrade CTA. All visible strings MUST come from `m.<key>()` calls (Paraglide messages) — no hardcoded strings, English or Czech.

#### Scenario: Free user lands on plan screen
- **GIVEN** a free user opens the Plan screen
- **WHEN** the screen renders
- **THEN** the heading reads `m.plan_freeTitle()`
- **AND** a primary CTA labeled `m.plan_upgrade()` is visible
- **AND** the days-remaining counter is hidden

#### Scenario: Paid Stripe user
- **GIVEN** a Stripe-paid user with `paidUntil = now() + 22 * 86400`
- **WHEN** the Plan screen renders
- **THEN** the heading reflects `sync-monthly` or `sync-yearly` per their plan
- **AND** "22 days remaining" is shown (localized)
- **AND** a "Manage subscription" CTA opens the Stripe portal in a new tab
- **AND** a "Cancel" CTA is shown

#### Scenario: Paid bank-transfer user
- **GIVEN** a bank-transfer user with `paidUntil = now() + 60 * 86400`
- **WHEN** the Plan screen renders
- **THEN** "60 days remaining" is shown
- **AND** a "Pay for next period" CTA starts a new bank-transfer intent
- **AND** no Stripe portal link is shown

### Requirement: Plan picker
A `PlanPicker` modal SHALL let the user select a plan + payment method. It MUST offer all three plan rows (free, sync-monthly, sync-yearly) with localized labels and prices read from `GET /auth/plans`. For paid plans, it MUST offer two payment paths: "Pay with card (recurring)" → Stripe Checkout, and "Pay by bank transfer (one period)" → bank-transfer instructions.

#### Scenario: Plan picker offers both payment paths
- **WHEN** the user selects `sync-monthly`
- **THEN** two CTAs are shown: card and bank-transfer
- **AND** both labels come from messages

#### Scenario: Selecting card opens Checkout
- **GIVEN** a user selects `sync-yearly` + Card
- **WHEN** they tap the Card CTA
- **THEN** the client `POST /auth/billing/stripe/checkout` runs with `plan: "sync-yearly"`
- **AND** the browser navigates to the returned `checkoutUrl`

#### Scenario: Selecting bank transfer opens instructions
- **GIVEN** a user selects `sync-monthly` + Bank transfer
- **WHEN** they tap the Bank transfer CTA
- **THEN** the client `POST /auth/billing/bank-transfer/intent` runs with `plan: "sync-monthly"`
- **AND** the bank-transfer instructions screen is displayed with the returned `vs`, `iban`, `amount`, `qrCodePayload`

### Requirement: Bank-transfer instructions screen
A `BankTransferInstructions` component SHALL display the payment payload returned by the intent endpoint: bank account number, IBAN, VS, amount + currency, and a QR code rendered offline from `qrCodePayload`. Each value MUST have a copy-to-clipboard affordance with localized success feedback.

#### Scenario: Copy-to-clipboard
- **GIVEN** a user on the instructions screen
- **WHEN** they tap "Copy IBAN"
- **THEN** the IBAN is in the clipboard
- **AND** a localized "Copied" toast appears

#### Scenario: QR renders offline
- **GIVEN** the device is offline
- **WHEN** the instructions screen loads (intent already fetched while online)
- **THEN** the QR code renders correctly
- **AND** no network requests are made for QR generation

#### Scenario: Pending status polling
- **GIVEN** the user is on the instructions screen after paying their bank
- **WHEN** the screen polls `GET /auth/billing/bank-transfer/intent/<id>` every 30 seconds
- **THEN** if the intent flips to `paid`, the screen transitions to a "Plan active" success view

### Requirement: Renewal banner
A `RenewBanner` component SHALL appear in the bottom-sheet status row when `paidUntil - now() < 7 * 86400` (paid users only) AND when the user is in the post-expiry grace window. Free users MUST NOT see this banner. The banner copy MUST come from messages and MUST tap-through to the Plan screen.

#### Scenario: 5 days remaining shows banner
- **GIVEN** a paid user with `paidUntil = now() + 5 * 86400`
- **WHEN** the bottom-sheet status row renders
- **THEN** the renewal banner is visible
- **AND** its label comes from `m.plan_renewSoonBanner({days: 5})`

#### Scenario: 30 days remaining hides banner
- **GIVEN** a paid user with `paidUntil = now() + 30 * 86400`
- **WHEN** the bottom-sheet status row renders
- **THEN** the renewal banner is not visible

#### Scenario: Free user never sees banner
- **GIVEN** any free user
- **WHEN** the bottom-sheet status row renders
- **THEN** the renewal banner is not visible

### Requirement: 402-plan-expired routing
The client `bearerFetch` wrapper MUST distinguish HTTP `402` from `401`. On `402 plan_expired`, the wrapper MUST throw a typed `PlanExpiredError` carrying `{paidUntil, gracePeriodEndsAt, reason}`. AppShell MUST catch this error and route the user to the Plan screen with a localized "Your plan needs renewal" header. Sync MUST stop without retrying on `402` (unlike `401` which triggers a refresh-and-retry).

#### Scenario: 402 routes to plan screen
- **GIVEN** a sync request that returns `402 plan_expired`
- **WHEN** the bearerFetch wrapper runs
- **THEN** a `PlanExpiredError` is thrown
- **AND** the AppShell navigates to the Plan screen
- **AND** the plan-screen header reads `m.plan_renewalRequiredTitle()`

#### Scenario: 401 still triggers refresh
- **GIVEN** a sync request that returns `401`
- **WHEN** the bearerFetch wrapper runs
- **THEN** the existing token-refresh flow runs
- **AND** the request is retried once with the new JWT
- **AND** the user is NOT routed to the Plan screen

### Requirement: Settings screen Plan row
The existing `SettingsScreen` MUST gain a Plan row above the Devices row, showing the localized plan label and `paidUntil` (or "Free" for free users). Tapping the row navigates to the Plan screen.

#### Scenario: Settings row shows plan
- **GIVEN** a free user opens Settings
- **WHEN** the screen renders
- **THEN** the Plan row reads `m.plan_freeTier()` followed by no expiry text

#### Scenario: Paid plan visible in settings
- **GIVEN** a sync-yearly user with `paidUntil = now() + 200 * 86400`
- **WHEN** the screen renders
- **THEN** the Plan row reads `m.plan_syncYearly()` and `m.plan_paidUntil({date: "..."})`

### Requirement: i18n parity for billing strings
Every billing-related visible string MUST exist in both `src/i18n/messages/cs.json` and `src/i18n/messages/en.json` under the `plan_*` and `billing_*` key namespaces. The lint test from `i18n-multilocale-support` MUST find no Czech-diacritic literals in any new billing component.

#### Scenario: Cs and en parity
- **GIVEN** a CI run after the change is merged
- **WHEN** `src/i18n/messages.test.ts` runs (the existing parity test)
- **THEN** it finds no key in `cs.json` missing from `en.json` and vice-versa
- **AND** all `plan_*` and `billing_*` keys exist in both

#### Scenario: No hardcoded literals in billing components
- **GIVEN** the i18n lint test
- **WHEN** it scans `src/components/PlanScreen.tsx`, `src/components/PlanPicker.tsx`, `src/components/BankTransferInstructions.tsx`, `src/components/RenewBanner.tsx`
- **THEN** it finds zero Czech-diacritic literals outside comments
