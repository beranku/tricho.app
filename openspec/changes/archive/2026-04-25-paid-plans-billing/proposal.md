## Why

Tricho is positioned to two operator profiles: a solo trichologist who only ever works on one device (laptop or phone) and never needs the cloud, and a multi-device practitioner who needs the same vault on phone + tablet + laptop and a real safety net if a device is lost or wiped. Today the product treats both the same — every user gets up to two devices on the free tier, and there is no backup capability at all. We need to (a) introduce a sustainable revenue line by gating cross-device sync and encrypted backups behind a paid plan, while (b) keeping the free, local, single-device experience genuinely free and complete, and (c) doing all of this without weakening the zero-knowledge invariants the product is built on. Users in the Czech Republic strongly prefer paying by bank transfer for one-off periods, so we need a non-Stripe path alongside Stripe recurring as a first-class option, not an afterthought.

## What Changes

- **Define five plan IDs across three tiers and two billing periods.** Tier × billing-period grid:
  - `free` — 1 device, no cloud sync, no cloud backup, no expiry. Local-only single-device usage. Always free.
  - `pro-monthly` / `pro-yearly` — 2 devices, sync, **12 months** of monthly cloud backups, billed monthly or yearly.
  - `max-monthly` / `max-yearly` — 5 devices, sync, **60 months (5 years)** of monthly cloud backups, billed monthly or yearly.
  Plans are pure entitlement grants; pricing is operator-configured per env var and is not part of the spec contract.
- **Free tier entitlement is "local-only".** A `free` user MAY sign in with OAuth to claim a stable identity, but `live-sync` and `encrypted-backup` MUST be denied while their plan is `free`. Their device limit MUST be 1 (down from the current free default of 2). Any second device on a `free` user MUST be rejected with the existing device-limit screen, prompting upgrade or revocation.
- **Paid tier entitlement is "cross-device sync + encrypted backup", with `paidUntil` enforced server-side.** A subscription is "active" if `paidUntil > now()` (with a configurable 7-day grace window during which sync is allowed but a banner warns of expiry). Outside the grace window, sync requests MUST be rejected with `402 plan_expired` and the client MUST surface a renewal screen.
- **BREAKING:** existing free-tier users currently allowed two devices MUST be migrated to the new free tier (1-device limit). Users with two active devices keep both grandfathered until one is revoked, after which they cannot add a replacement on free. A one-shot migration script flags grandfathered users with `freeDeviceGrandfathered: true` so device-limit logic can permit two existing devices but block any new ones.
- **Two payment paths, one entitlement model:**
  - **Stripe recurring (`stripe-recurring-billing`).** Hosted Checkout Session at `/auth/billing/stripe/checkout` (one-time POST returning a redirect URL). The Stripe customer is keyed by the `user.canonicalUsername`, never by email. A Stripe-hosted **customer portal** at `/auth/billing/stripe/portal` lets the user upgrade / downgrade / cancel / change card. **Webhook** at `/auth/billing/stripe/webhook` (signature-verified) is the single writer to `subscription.paidUntil` for Stripe-tracked subscriptions; the API handler never trusts the redirect.
  - **Bank transfer single-period (`bank-transfer-billing`).** User picks `sync-monthly` or `sync-yearly`, gets back a Czech-standard payment instruction: account number + IBAN, **VS** (variable symbol) generated per intent, **SS** (specific symbol) optional, amount in CZK, and a 14-day payment window. On confirmation (manual admin action in v1; bank-API reconciliation roadmap below), `paidUntil` is extended by exactly one period from the later of `now()` or current `paidUntil`. Bank-transfer users have **no** auto-renew; they must repeat the flow each period.
- **Plan changes:** Stripe → Stripe is a Stripe-portal proration. Bank transfer → Stripe migrates the user to recurring at next renewal (no overlap). Stripe → bank transfer requires cancelling the Stripe subscription first (refund handling out of scope; user keeps service to `paidUntil`).
- **Backups (`encrypted-backup`).** Two surfaces, one byte-format:
  - **Cloud monthly snapshots (paid).** A server-side cron iterates each paid user's `userdb-<hex>` daily and packs (a) the complete textual snapshot of all non-photo docs + (b) just those photo-meta docs whose plaintext top-level `monthBucket` field matches the current calendar month into a single `.tricho-backup.zip` blob. The cron operates on **encrypted bytes-as-they-already-are-on-disk** — it never decrypts anything. On the 1st day of each new month, the previous month's draft is finalized and a fresh draft begins. Retention: paid users keep `backupRetentionMonths` worth of finalized snapshots (12 for pro, 60 for max). Endpoints: `GET /auth/backup/months` lists available months, `GET /auth/backup/months/:yyyy-mm` streams the ZIP. Both gated on `entitlements.includes("backup")`.
  - **Local export ZIP (everyone, including free).** Client iterates the local PouchDB and packs the same byte format directly in the browser via `JSZip`. User picks a calendar month → a `.tricho-backup.zip` is downloaded to their device. Free users get this as their **only** disaster-recovery surface. The local generator never decrypts either — it copies the encrypted bytes verbatim.
  - **Restore is the inverse.** A single restore code path accepts a ZIP and replays it into PouchDB, regardless of whether the ZIP came from a file picker or from the cloud download endpoint. Existing local docs win on conflict (newest-wins resolver). Decryption happens lazily when the UI later reads a doc, exactly as in the normal sync path.
- **Photo `monthBucket` plaintext field.** Photo-meta docs gain a top-level `monthBucket: "YYYY-MM"` plaintext field, computed at write time from `takenAt` (UTC). Server uses this for accurate bucketing in the cron; client uses it for the local-zip filter. The field is set once at first write and **frozen** — soft-delete or note edits MUST NOT change it. Privacy delta is nil because the server already sees `updatedAt` at ms granularity.
- **Server-side gating.** A new `subscription.entitlements` array (`["sync", "backup"]` for paid; `[]` for free) is the single check. `live-sync` (CouchDB per-user DB access) MUST require `entitlements.includes("sync")`; backup endpoints MUST require `entitlements.includes("backup")`. Both checks happen on every request — JWT alone is not enough.
- **CouchDB sync gating.** Because `live-sync` already authenticates with bearer JWT and CouchDB validates that JWT statelessly, we MUST insert an entitlement check **before** CouchDB. The `tricho-auth` reverse-proxies `/userdb-*/*` requests, denying them with `402` when entitlements lack `"sync"`. (This adds a new edge: today CouchDB is fronted directly by Traefik. The new proxy is on `tricho-auth`'s host so the JWT validation cost is paid once.) Alternatively, CouchDB's `_users` `password_scheme` is rotated when entitlements expire — but that's destructive and slow; the proxy approach is reversible and observable.
- **Webhook idempotency.** Both Stripe webhooks and the bank-transfer admin confirmation MUST be idempotent: the same event ID must not extend `paidUntil` twice. A dedup table (`payment-event` docs in `tricho_meta`) holds processed event IDs with TTL.
- **Client UX.**
  - **Settings → Plan** screen shows current tier, `paidUntil`, days remaining, and CTAs: **Upgrade to Sync** (when on free), **Manage subscription** (Stripe portal link, paid Stripe), **Pay for next period** (bank transfer reissue, paid bank), **Cancel** (Stripe portal). Localized cs / en.
  - **Device limit screen** is reused; the upgrade CTA now points to the plan picker instead of just suggesting a device revoke.
  - **Renewal banner** appears in the bottom-sheet status row when `paidUntil - now < 7 days` (paid) or when in grace window after expiry (paid). Free users see no banner.
  - **First-launch flow** unchanged — free is the default. OAuth sign-in does NOT auto-upgrade. Users explicitly opt in via the plan picker.
- **Invoicing for bank transfer.** A receipt PDF (server-rendered) is emailed on bank-transfer confirmation. Stripe handles its own invoices via the Stripe customer object. Out of scope: Czech VAT/DPH register integration, EET, automated payment-receipt to FÚ.
- **Non-goals (deferred):**
  - Team / multi-seat plans. Out of scope; current model is per-user-per-device.
  - Per-device pricing tiers (e.g. 5-device, 10-device packs). Sync is unlimited devices on paid; revisit when a real ceiling emerges.
  - Promotional codes, referral discounts. Use Stripe coupons via the Stripe dashboard if needed; the spec does not enumerate them.
  - Bank-API automated reconciliation (FIO, Air Bank). v1 is admin-confirmed; the contract is shaped so an API integration can replace the admin step without spec change.
  - Refunds. Stripe refunds via portal; bank-transfer refunds are out-of-band manual.
  - Free trial of paid plan. Not in v1; the upgrade is paid-from-day-one. Revisit after launch metrics.
  - Plaintext invoice line items. The invoice contains plan name + period + amount; never any user-data fields.

**Zero-knowledge / threat-model delta — explicit:**
- Stripe receives the user's email + chosen plan SKU. It MUST NOT receive any vault data, document IDs, or device identifiers beyond the canonical username.
- The bank-transfer payment instruction contains nothing beyond the VS/SS/amount; it is generated server-side without ever touching vault state.
- Backups are AEAD ciphertext with AAD bound to `{vaultId, snapshotId, version}`. The server stores opaque blobs + a manifest of non-secret metadata (size, createdAt, deviceId). The DEK never leaves the device; restoring a backup still requires the device's WebAuthn-PRF or Recovery Secret to unwrap the DEK.
- The entitlement check happens on the server but uses only the canonical username and the subscription doc — not the JWT's `sub` cross-checked against a Stripe webhook payload at request time. The webhook is the writer; the request path is a reader. No payment state is computed from request input.

## Capabilities

### New Capabilities
- `billing-plans`: 5-plan catalog (`free` / `pro-monthly` / `pro-yearly` / `max-monthly` / `max-yearly`) with tier (`free`/`pro`/`max`), billing period (`month`/`year`/null), `deviceLimit` (1/2/5) and `backupRetentionMonths` (0/12/60); entitlement model (`["sync", "backup"]`); `subscription` doc shape (`tierKey`, `billingPeriod`, `provider`, `status`, `paidUntil`, grace window, `freeDeviceGrandfathered`, `backupRetentionMonths`); plan-change rules; idempotent payment-event dedup; server-side gating contract for `sync` and `backup`; free-tier device-limit semantics (1 + grandfather); API surface (`GET /auth/plans`, `GET /auth/subscription`, `POST /auth/subscription/cancel`).
- `stripe-recurring-billing`: Stripe Checkout Session creation, Stripe customer-portal redirect, webhook signature verification + event handling (`customer.subscription.created/updated/deleted`, `invoice.paid`), Stripe-customer ↔ canonical-username binding, idempotent `paidUntil` writes, error mapping (declined card, dispute, refund) to subscription state.
- `bank-transfer-billing`: payment-intent issuance (VS generation, IBAN/account/amount payload, expiry window), admin confirmation endpoint (auth-gated), idempotent crediting of `paidUntil`, receipt-email rendering, payment-window expiry handling, contract for future bank-API reconciliation.
- `encrypted-backup`: photo doc plaintext `monthBucket` field; shared `.tricho-backup.zip` byte format used by both server cron and client local-export; server-side daily cron that composes monthly snapshots from `userdb-<hex>` *without decrypting anything* (bytes-as-is invariant); endpoints `GET /auth/backup/months` and `GET /auth/backup/months/:yyyy-mm`; client-side `generateLocalBackupZip` available to all users (free included); single restore code path (`restoreFromZipBytes`) accepts both server- and client-produced ZIPs; retention policy (keep newest N months per `backupRetentionMonths`); entitlement gate on cloud download (free users see the month list but cannot fetch blobs).
- `plan-management-ui`: Settings → Plan screen, plan-picker modal (free / monthly / yearly + Stripe / bank), renewal-banner rules, Stripe-portal redirect handling, bank-transfer instruction screen with copy-to-clipboard + QR (Czech `SPAYD` payment QR), localized strings (cs / en).

### Modified Capabilities
- `oauth-identity`: subscription record schema gains `provider` (`null` / `stripe` / `bank-transfer`), `status` (`active` / `past_due` / `canceled` / `expired`), `entitlements` (`string[]`), `freeDeviceGrandfathered` (`boolean`); free-tier `deviceLimit` changes from 2 to 1 (with grandfather rule for existing two-device free users); `GET /auth/subscription` response shape adds `entitlements`, `provider`, `status`, `gracePeriodDays`.
- `live-sync`: every CouchDB-bound request MUST pass through an entitlement gate that returns `402 plan_expired` (with a JSON body carrying renewal CTA hints) when `entitlements` lacks `"sync"`; the existing 401-on-expired-JWT contract is unchanged. Client MUST distinguish 401 (refresh token) from 402 (renew plan) and route the user to the plan screen on 402.
- `jwt-session`: refresh-token issuance on OAuth callback continues to work for free users (they get JWTs for `/auth/*` endpoints) but those JWTs MUST NOT confer access to `/userdb-*` while the user lacks `sync` entitlement. The proxy gate, not JWT claims, enforces this — JWT shape is unchanged.

## Impact

**Affected code:**
- `infrastructure/couchdb/tricho-auth/` — **major** — new `billing/` subtree with `stripe.mjs`, `bank-transfer.mjs`, `entitlements.mjs`, `webhook.mjs`, `proxy.mjs` (CouchDB entitlement proxy); `meta.mjs` extended with new subscription fields, payment-event dedup table, backup-manifest table; `routes.mjs` adds `/auth/billing/*`, `/auth/backup/*`, `/auth/plans` routes; `server.mjs` mounts the entitlement proxy in front of `/userdb-*`.
- `infrastructure/traefik/` — **minor** — route `/userdb-*` traffic through `tricho-auth` instead of directly to CouchDB; CouchDB stops being a public service.
- `infrastructure/couchdb/local.ini` — unchanged (still validates JWTs); the proxy is layered above.
- `src/auth/oauth.ts`, `src/auth/subscription.ts` (**new**) — typed plan + entitlement model, parsing of `/auth/subscription` response, nanostore for subscription state.
- `src/billing/` (**new tree**) — `stripe-checkout.ts` (POST + redirect), `bank-transfer.ts` (intent flow), `subscription-store.ts` (nanostore), `plans.ts` (typed plan catalog).
- `src/components/` — new `PlanPicker.tsx`, `BankTransferInstructions.tsx`, `RenewBanner.tsx`, `PlanScreen.tsx`; `SettingsScreen.tsx` adds a Plan row above Devices; `DeviceLimitScreen.tsx` reuses with new upgrade CTA; `AppShell.tsx` handles `402 plan_expired` and routes to `PlanScreen`.
- `src/sync/couch.ts` — handle `402` from the entitlement proxy: stop sync, surface a typed error to the AppShell, leave local data untouched.
- `src/backup/` (**new tree**) — `snapshot.ts` (vault snapshot serializer), `encrypt.ts` (envelope-crypto wrapper with `snapshotId` AAD), `upload.ts` / `download.ts` (bearer-fetch against `/auth/backup/*`), `restore.ts` (decrypt + replay into PouchDB).
- `src/i18n/messages/{cs,en}.json` — new keys for plan, billing, renewal, bank-transfer instruction copy.
- `package.json` — server: `stripe` SDK; client: nothing new (use bearer-fetch).

**APIs added:**
- `GET /auth/plans` — public, unauthenticated, lists plan catalog (id, label, period, amount, currency).
- `GET /auth/subscription` — bearer-authed, returns current subscription (extended shape).
- `POST /auth/subscription/cancel` — bearer-authed, cancels at period end (no immediate revocation; user keeps service to `paidUntil`).
- `POST /auth/billing/stripe/checkout` — bearer-authed, returns Stripe Checkout URL.
- `GET /auth/billing/stripe/portal` — bearer-authed, returns Stripe customer-portal URL.
- `POST /auth/billing/stripe/webhook` — Stripe-only, signature-verified, no bearer; the canonical writer for Stripe-tracked subscriptions.
- `POST /auth/billing/bank-transfer/intent` — bearer-authed, returns `{intentId, vs, amount, iban, accountNumber, expiresAt, qrCodePayload}`.
- `POST /auth/billing/bank-transfer/admin/confirm` — admin-bearer-authed (separate admin token in v1), credits `paidUntil` for an `intentId`.
- `POST /auth/backup/upload` — bearer + `entitlements.includes("backup")`, multipart blob + manifest fields.
- `GET /auth/backup/list` — bearer + entitlements; returns manifest list.
- `GET /auth/backup/<id>` — bearer + entitlements; streams ciphertext blob.

**Dependencies added:**
- Server: `stripe` (^17 or current). Bank-transfer flow uses no third-party lib in v1.

**Tests:**
- Backend unit (`infrastructure/couchdb/tricho-auth/test/unit/`): plan catalog parsing, entitlement check matrix (free/paid × sync/backup × active/grace/expired), Stripe webhook signature verification (good / bad / replay), bank-transfer VS generation determinism, idempotent crediting (same event twice → one extension), `paidUntil` math (extends from later of now / existing paidUntil).
- Backend integration (`test/integration/`): Stripe webhook handler against a Stripe-CLI fixture event stream; bank-transfer intent → admin confirm → entitlement transition; CouchDB proxy gate (free user → 402 on `/userdb-*/`, paid user → pass-through); device-limit grandfather rule (existing two-device free user keeps both).
- Client unit: subscription nanostore, plan-picker state machine, `402 plan_expired` propagation through `bearerFetch`.
- Client component: `PlanScreen` renders correct CTA per state (free / paid-stripe / paid-bank / past-due / expired); `BankTransferInstructions` copy-to-clipboard and QR rendering; `RenewBanner` visibility windows.
- E2E (`tests/e2e/billing.spec.ts`): free user sign-in, see plan screen, attempt sync → blocked, upgrade via bank-transfer flow (admin-confirm shortcut in test fixture), sync now succeeds; downgrade by letting `paidUntil` expire (test clock), grace banner appears, then 402; cancel via Stripe portal in stub mode.
- Smoke: end-to-end Stripe Checkout against `STRIPE_TEST_KEY` in CI; verifies redirect URL is reachable.

**Migrations:**
- `tricho_meta` doc transform: existing `subscription:user:*` docs gain `entitlements: []` (empty for free, `["sync","backup"]` for paid), `provider: null` (or `stripe` if a Stripe customer exists), `status: "active"`, `freeDeviceGrandfathered: true` for free users with ≥ 2 active devices. Idempotent; safe to re-run.

**Rollback:**
The change is fully reversible because no encrypted document shapes change and no plaintext data is added to the wire.
1. Remove the entitlement proxy from `tricho-auth` (route `/userdb-*` back through Traefik directly). All paid features stop being gated; free users regain sync. No data loss.
2. Drop the `/auth/billing/*` and `/auth/backup/*` routes; subscriptions revert to the pre-change `{tier, deviceLimit, paidUntil}` shape — extra fields are simply ignored.
3. Refund any in-flight Stripe subscriptions via the Stripe dashboard; outstanding bank-transfer intents auto-expire.
4. Client falls back to the pre-change Settings screen (Plan row hidden via feature flag).
5. Backups already uploaded remain in storage as inert blobs; a follow-up sweep can purge them.
No DEK rotation, no AAD changes, no vault re-encryption — the encryption layer is untouched.
