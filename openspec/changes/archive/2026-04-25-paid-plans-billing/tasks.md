## 0. Plan model revision (D11–D18)

- [x] 0.1 Replace `sync-monthly`/`sync-yearly` plan IDs with the 5-plan grid: `free`, `pro-monthly`, `pro-yearly`, `max-monthly`, `max-yearly`. Helpers `tierOf`, `billingPeriodOf`, `deviceLimitOf`, `backupRetentionMonthsOf` derive the canonical shape.
- [x] 0.2 Add `tierKey`, `billingPeriod`, `backupRetentionMonths` to subscription doc shape (server + client). `creditPaidUntil` populates them from the credited plan id.
- [x] 0.3 Photo-meta docs gain a plaintext top-level `monthBucket: "YYYY-MM"` set from `takenAt` (UTC) at first write; soft-deletes preserve it.
- [x] 0.4 Build a shared ZIP byte format (`zip-pack`) used by both server cron and client local-export. Bytes-as-is invariant: never decrypt during composition.
- [x] 0.5 Server-side daily cron snapshots paid users into per-month ZIPs. Draft → final transition on the 1st of next month. Retention by `backupRetentionMonths`.
- [x] 0.6 Replace monolithic `/auth/backup/upload` + `/auth/backup/list` + `/auth/backup/<id>` endpoints with `GET /auth/backup/months` and `GET /auth/backup/months/:yyyy-mm`. The latter is gated on `entitlements.includes("backup")`.
- [x] 0.7 Client `generateLocalBackupZip` available to ALL users (free included). Restore from ZIP is a single code path consuming bytes from either the file picker or the cloud download endpoint.
- [x] 0.8 PlanPicker UI: tier picker (pro/max) → period picker (monthly/yearly) → payment picker.
- [x] 0.9 Migrations: `migrate-subscriptions.mjs` extended for new fields and legacy plan mapping; new `migrate-photo-month-bucket.mjs` backfills existing photo docs.
- [x] 0.10 i18n keys for new tier model (`plan_tier_free|pro|max`, `plan_period_monthly|yearly`, `plan_retention_*`, `plan_localBackup_*`, `restore_zip_*`).

## 1. Server foundation: subscription model + plan catalog

- [x] 1.1 Extend `infrastructure/couchdb/tricho-auth/meta.mjs`: add `entitlements`, `provider`, `status`, `plan`, `freeDeviceGrandfathered`, `gracePeriodSeconds`, `stripeCustomerId`, `stripeSubscriptionId`, `updatedAt` fields to subscription doc shape; default `tier: "free", plan: "free", deviceLimit: 1, entitlements: [], provider: null, status: "active", freeDeviceGrandfathered: false, gracePeriodSeconds: 7 * 86400`.
- [x] 1.2 Add `_design/tricho` views: `subscriptions_by_plan`, `payment_intents_by_user`, `payment_intents_by_vs`, `payment_events_by_provider_event_id`, `backup_manifests_by_user` to `meta.mjs#seedDesignDoc`.
- [x] 1.3 Add to `meta.mjs`: `creditPaidUntil({userId, plan, periodSeconds, provider})` implementing `paidUntil = max(now, paidUntil_old) + periodSeconds`, sets entitlements, status active, returns updated doc.
- [x] 1.4 Add to `meta.mjs`: `recordPaymentEvent({provider, eventId, payload})` — idempotent insert into `payment-event:<provider>:<eventId>` with `expireAt = now + 30d`; returns `{deduped: boolean}`.
- [x] 1.5 Add to `meta.mjs`: `sweepExpiredPaymentEvents()` — admin-runnable, deletes docs with `expireAt < now`.
- [x] 1.6 Create `infrastructure/couchdb/tricho-auth/billing/plans.mjs`: `loadPlanCatalog()` reads env (`PLAN_SYNC_MONTHLY_AMOUNT_MINOR`, `PLAN_SYNC_MONTHLY_CURRENCY`, `PLAN_SYNC_MONTHLY_STRIPE_PRICE_ID`, same for yearly), returns the three-plan catalog.
- [x] 1.7 Add `/auth/plans` route in `routes.mjs` returning the catalog (unauthenticated, public).
- [x] 1.8 Extend `/auth/subscription` route to include the new fields + `gracePeriodEndsAt` derived from `paidUntil + gracePeriodSeconds`.
- [x] 1.9 Add `POST /auth/subscription/cancel` route — bearer-authed; for Stripe sub, calls Stripe `subscription.update({cancel_at_period_end: true})`; for bank-transfer, sets `status: "canceled"`.
- [x] 1.10 Backend unit tests (`test/unit/billing.test.mjs`): plan catalog parsing; `creditPaidUntil` math (early renew, returning expired, never shorten); `recordPaymentEvent` idempotency.

## 2. Entitlements module + CouchDB reverse-proxy

- [x] 2.1 Create `infrastructure/couchdb/tricho-auth/billing/entitlements.mjs`: `checkEntitlement(canonicalUsername, entitlement)` — reads subscription, applies grace-window math, returns `{allowed: boolean, paidUntil, gracePeriodEndsAt, reason}`. Includes 30s in-process cache keyed by canonical username with invalidation hook.
- [x] 2.2 `entitlements.mjs#invalidate(canonicalUsername)` — exported so webhook + admin-confirm handlers can clear the cache after writing.
- [x] 2.3 Create `infrastructure/couchdb/tricho-auth/billing/proxy.mjs`: HTTP handler that validates bearer JWT (reuse `jwt.mjs` verifier), extracts canonical username from `sub` claim, calls `checkEntitlement(..., "sync")`, forwards request to CouchDB on allow or returns `402 plan_expired` JSON on deny.
- [x] 2.4 Mount the proxy in `server.mjs`: pattern-match `/userdb-*/*` paths and route through `proxy.mjs`. All other routes continue to current router.
- [x] 2.5 Update `infrastructure/traefik/` config: route `/userdb-*` traffic to `tricho-auth` instead of directly to CouchDB; CouchDB stops being a public service (internal Docker network only).
- [x] 2.6 Backend integration test (`test/integration/entitlement-proxy.integration.test.mjs`): free user JWT → `402` on `/userdb-<hex>/_changes`; paid active user → forwards; paid in grace → forwards with `tricho-grace-ends-at` header; paid past grace → `402`.
- [x] 2.7 Add `tricho-grace-ends-at` response header injection in `proxy.mjs` when caller is in grace window.

## 3. Stripe recurring billing

- [x] 3.1 Add `stripe` package to `infrastructure/couchdb/tricho-auth/package.json`; `npm install`.
- [x] 3.2 Create `infrastructure/couchdb/tricho-auth/billing/stripe.mjs`: `createCheckoutSession({user, plan, successUrl, cancelUrl, paidUntilBridgeDays})` — looks up or creates Stripe customer keyed by `metadata.canonicalUsername`, creates Checkout Session with `mode: subscription`, `line_items`, `client_reference_id`, optional `subscription_data.trial_period_days`. Returns `{checkoutUrl, customerId}`.
- [x] 3.3 `stripe.mjs#openCustomerPortal({user, returnUrl})` — returns `{portalUrl}` for the user's Stripe customer; throws `NoStripeCustomerError` if none.
- [x] 3.4 `stripe.mjs#verifyWebhookSignature(rawBody, signatureHeader, secret)` — Stripe HMAC-SHA256 spec; returns parsed event or throws `InvalidSignatureError`.
- [x] 3.5 `stripe.mjs#mapPriceIdToPlan(priceId)` — reads env mapping, returns `"sync-monthly" | "sync-yearly"`.
- [x] 3.6 Create `billing/webhook.mjs#handleStripeEvent(event)` — dispatches on event type: `customer.subscription.created/updated` → upsert subscription doc fields; `invoice.paid` → `creditPaidUntil`; `customer.subscription.deleted` → `status: "canceled"`; `invoice.payment_failed` → `status: "past_due"`. Wraps everything in `recordPaymentEvent` dedup.
- [x] 3.7 Add routes in `routes.mjs`:
  - `POST /auth/billing/stripe/checkout` (bearer-authed) → calls `createCheckoutSession`, returns `{checkoutUrl}`.
  - `GET /auth/billing/stripe/portal` (bearer-authed) → calls `openCustomerPortal`, returns `{portalUrl}` or `409`.
  - `POST /auth/billing/stripe/webhook` (raw-body, no bearer) → verifies signature, dispatches, invalidates entitlement cache.
- [x] 3.8 Update `server.mjs` to preserve raw body for the webhook route (Stripe signature is over raw bytes).
- [x] 3.9 Backend unit (`test/unit/stripe.test.mjs`): signature verification (good / bad / replay); price-ID-to-plan mapping; trial-bridge-days math.
- [x] 3.10 Backend integration (`test/integration/stripe-webhook.integration.test.mjs`): replay a fixture event stream (created → paid → updated → canceled), assert subscription doc transitions match the spec; assert idempotency on duplicate event delivery.

## 4. Bank-transfer billing

- [x] 4.1 Create `infrastructure/couchdb/tricho-auth/billing/bank-transfer.mjs`:
  - `generateUniqueVS(meta)` — 10-digit random with collision retry against `payment_intents_by_vs` view.
  - `composeSpaydPayload({iban, amountMinor, currency, vs, plan})` — returns Czech SPAYD string.
  - `createIntent({user, plan, env})` — checks no active Stripe sub, generates VS, persists `payment-intent:<id>`, returns intent body.
  - `confirmIntent({intentId, env})` — admin-only callable; loads intent, checks not expired/canceled, dedup via `recordPaymentEvent({provider: "bank-transfer", eventId: intentId})`, calls `creditPaidUntil`, marks intent paid, triggers receipt email.
  - `cancelIntent({intentId, userId})` — owner-only; sets intent `status: "canceled"`.
  - `sweepExpiredIntents()` — marks pending intents past `expiresAt` as `status: "expired"`.
- [x] 4.2 Create `billing/admin-auth.mjs`: middleware checking a separate `ADMIN_BEARER_TOKEN` env value; returns 401 on mismatch.
- [x] 4.3 Create `billing/email.mjs`: `sendReceipt({email, intent})` — best-effort SMTP via env-configured transport; logs failures, never throws to caller.
- [x] 4.4 Add routes in `routes.mjs`:
  - `POST /auth/billing/bank-transfer/intent` (bearer-authed) → `createIntent`, returns intent payload.
  - `GET /auth/billing/bank-transfer/intent/:id` (bearer-authed, owner-only) → returns intent state for polling.
  - `DELETE /auth/billing/bank-transfer/intent/:id` (bearer-authed, owner-only) → `cancelIntent`.
  - `POST /auth/billing/bank-transfer/admin/confirm` (admin-authed) → `confirmIntent`, invalidates entitlement cache.
- [x] 4.5 Backend unit (`test/unit/bank-transfer.test.mjs`): VS uniqueness on collision; SPAYD payload format; expiry math; confirm idempotency; cancel-then-confirm rejection.
- [x] 4.6 Backend integration (`test/integration/bank-transfer.integration.test.mjs`): create intent → admin confirm → entitlement transitions to paid; replay confirm → no double credit; expired intent → `410`.

## 5. Encrypted backup endpoints

- [x] 5.1 Create `infrastructure/couchdb/tricho-auth/billing/backup-store.mjs`:
  - `BACKUP_ROOT = process.env.BACKUP_ROOT ?? "/var/lib/tricho-backups"`.
  - `writeBlob({canonicalUsername, snapshotId, stream})` — atomically write to `<root>/<user>/<snapshotId>.bin` (write to tmp, fsync, rename).
  - `readBlob({canonicalUsername, snapshotId})` — returns a read stream or null.
  - `deleteBlob({canonicalUsername, snapshotId})` — best-effort unlink.
  - `applyRetention({canonicalUsername, manifests})` — deterministic 7-most-recent + 12 monthly anchors; returns IDs to delete.
- [x] 5.2 Add `meta.mjs#listBackupManifests(canonicalUsername)` and `meta.mjs#putBackupManifest(manifest)` and `meta.mjs#deleteBackupManifest(snapshotId)`.
- [x] 5.3 Add routes in `routes.mjs`:
  - `POST /auth/backup/upload` (bearer + entitlement `backup`): multipart parse `manifest` (JSON) + `blob` (octet stream); verify size match; write blob; insert manifest; apply retention; return `200 {snapshotId, createdAt}`.
  - `GET /auth/backup/list` (bearer; no entitlement gate — read is universal so users can see what to recover): returns `{manifests}` newest-first.
  - `GET /auth/backup/:snapshotId` (bearer + entitlement `backup`): streams blob; `404` if not owned.
- [x] 5.4 Backend unit (`test/unit/backup-retention.test.mjs`): retention determinism; daily-vs-monthly bucketing; idempotency.
- [x] 5.5 Backend integration (`test/integration/backup.integration.test.mjs`): paid user upload + list + download round-trip; free user upload `402`; free user download `402` but list `200`; size-mismatch `400`; cross-user download `404`.

## 6. Migration: backfill subscription fields + grandfather flag

- [x] 6.1 Create `infrastructure/couchdb/tricho-auth/scripts/migrate-subscriptions.mjs`: iterates all subscription docs, sets `plan` (derive from existing `tier`/`paidUntil`), `provider` (`stripe` if `stripeCustomerId` set, `bank-transfer` if `paidUntil` future + no Stripe, else `null`), `status`, `entitlements`, `freeDeviceGrandfathered` (true iff `tier === "free"` && active devices ≥ 2), `gracePeriodSeconds`. Idempotent.
- [x] 6.2 Migration unit test (`test/unit/migrate-subscriptions.test.mjs`): pre-shape → post-shape mapping; idempotency (running twice = no further writes); grandfather rule.
- [x] 6.3 Add npm script `migrate:subscriptions` invoking the script. Document in repo README.

## 7. Client: subscription model + nanostore

- [x] 7.1 Create `src/auth/subscription.ts`: typed `Subscription` interface mirroring server response (tier, plan, provider, status, entitlements, paidUntil, gracePeriodEndsAt, freeDeviceGrandfathered, deviceLimit, stripeCustomerId?). Update `src/auth/oauth.ts` to widen the `Subscription` type if it overlaps.
- [x] 7.2 Create `src/lib/store/subscription.ts`: nanostore `subscriptionStore` (atom of `Subscription | null`), `loadSubscription()` calls `GET /auth/subscription` via `bearerFetch`, `refreshSubscription()` re-fetches, `cancelSubscription()` calls the cancel endpoint.
- [x] 7.3 Wire `loadSubscription()` into AppShell mount path so the store is populated after OAuth completes.
- [x] 7.4 Unit test (`src/lib/store/subscription.test.ts`): store updates on fetch, error handling, cancel flow.

## 8. Client: 402 plan_expired handling in bearerFetch

- [x] 8.1 Modify `src/sync/couch-auth.ts` (or whichever module owns `bearerFetch`): on `response.status === 402`, parse JSON body, throw `class PlanExpiredError extends Error { paidUntil; gracePeriodEndsAt; reason; }`.
- [x] 8.2 Modify `src/sync/couch.ts`: catch `PlanExpiredError` in the sync error handler, transition state machine to new `"gated"` status, stop replication without retry.
- [x] 8.3 Add `"gated"` to the sync state union; update `src/sync/couch.ts` types and `src/components/SyncStatus.tsx` to render a localized "Sync paused — plan needed" message.
- [x] 8.4 Modify `src/components/AppShell.tsx`: register a `PlanExpiredError` handler that navigates to the Plan screen with a `reason` query.
- [x] 8.5 Unit test (`src/sync/couch-auth.test.ts`): 401 still triggers refresh-and-retry; 402 throws `PlanExpiredError`; 402 does NOT trigger refresh.

## 9. Client: i18n messages for billing

- [x] 9.1 Add billing keys to `src/i18n/messages/en.json` under namespaces `plan_*` and `billing_*`. At minimum: `plan_freeTitle`, `plan_freeTier`, `plan_syncMonthly`, `plan_syncYearly`, `plan_paidUntil`, `plan_daysRemaining`, `plan_renewSoonBanner`, `plan_renewalRequiredTitle`, `plan_upgrade`, `plan_manageSubscription`, `plan_payNextPeriod`, `plan_cancel`, `plan_canceled`, `plan_expired`, `plan_inGrace`, `plan_resumeSync`, `plan_currentPlanLabel`, `plan_pickerTitle`, `plan_pickerCard`, `plan_pickerBank`, `billing_iban`, `billing_account`, `billing_vs`, `billing_amount`, `billing_qrAlt`, `billing_copyIban`, `billing_copyVs`, `billing_copyAccount`, `billing_copied`, `billing_intentExpiresAt`, `billing_pendingPolling`, `billing_paymentReceived`, `billing_processingPayment`, `billing_paymentFailed`.
- [x] 9.2 Add the same keys to `src/i18n/messages/cs.json` with Czech translations. Use proper Czech for "VS" (variabilní symbol), "IBAN", "Číslo účtu", "Částka", "Plán", "Předplatné", etc.
- [x] 9.3 Run `astro build` once to regenerate `src/paraglide/`; verify the new message functions exist.
- [x] 9.4 Confirm `src/i18n/messages.test.ts` (the cs/en parity test from `i18n-multilocale-support`) passes.

## 10. Client: Plan screen

- [x] 10.1 Create `src/components/PlanScreen.tsx`: consumes `subscriptionStore`, renders heading + days-remaining + provider-appropriate CTAs.
  - Free: `m.plan_freeTitle()` + `m.plan_upgrade()` button → opens `PlanPicker`.
  - Stripe-paid: plan label + `m.plan_paidUntil({date})` + `m.plan_daysRemaining({days})` + `m.plan_manageSubscription()` (opens portal) + `m.plan_cancel()`.
  - Bank-transfer-paid: plan label + days-remaining + `m.plan_payNextPeriod()` (opens new intent) + cancel.
  - In-grace state: warning banner + renewal CTA.
  - Canceled state: "Active until X" + reactivate CTA.
- [x] 10.2 Add Plan-screen route key (`'plan'`) to `AppShell` route enum; render `PlanScreen` when active.
- [x] 10.3 Component test (`src/components/PlanScreen.component.test.tsx`): renders correct UI per state matrix (free / paid-stripe / paid-bank / past-due / canceled / expired). Run under both en and cs locales; assert no Czech literals leak under en.

## 11. Client: Plan picker

- [x] 11.1 Create `src/components/PlanPicker.tsx`: modal that lists plans (read from `GET /auth/plans`), selecting a paid plan reveals two CTAs (Card / Bank transfer).
- [x] 11.2 Card path: `POST /auth/billing/stripe/checkout` with `{plan, successUrl, cancelUrl}`, then `window.location = checkoutUrl`.
- [x] 11.3 Bank-transfer path: `POST /auth/billing/bank-transfer/intent` with `{plan}`, then navigate to `BankTransferInstructions` with the returned payload.
- [x] 11.4 Component test (`src/components/PlanPicker.component.test.tsx`): selecting a plan + payment method calls the right endpoint with the right body.

## 12. Client: Bank transfer instructions

- [x] 12.1 Add a small offline-friendly QR rendering library (e.g., `qrcode`); pin a minimal version. Confirm the library has zero network calls at runtime.
- [x] 12.2 Create `src/components/BankTransferInstructions.tsx`: renders IBAN, account number, VS, amount, and a `<canvas>` QR generated from `qrCodePayload`. Each value has a copy-to-clipboard button labeled by `m.billing_copyIban()` etc.
- [x] 12.3 Implement intent-status polling: every 30s call `GET /auth/billing/bank-transfer/intent/:id`; on `status: "paid"`, transition to a success view and call `refreshSubscription()`.
- [x] 12.4 Component test (`src/components/BankTransferInstructions.component.test.tsx`): renders correct fields, clipboard fires expected text, polling transitions to success view on stub `paid` response.

## 13. Client: Renewal banner + Settings row

- [x] 13.1 Create `src/components/RenewBanner.tsx`: subscribes to `subscriptionStore`, renders only when `tier === "paid"` and (in grace window OR < 7 days remaining). Tap-through navigates to Plan screen.
- [x] 13.2 Mount `RenewBanner` in the bottom-sheet status row (`src/components/islands/SyncStatusRow.tsx` or similar).
- [x] 13.3 Modify `src/components/SettingsScreen.tsx`: add Plan row above the Devices row showing current plan label and `paidUntil`; tap → Plan screen.
- [x] 13.4 Modify `src/components/DeviceLimitScreen.tsx`: replace "revoke a device" copy with "or upgrade to Sync" CTA when free; reuse the `m.<key>()` keys.
- [x] 13.5 Component test for each new/changed component covering visibility rules.

## 14. Client: encrypted backup module

- [x] 14.1 Create `src/backup/snapshot.ts`: `serializeSnapshot(db: PouchDB)` — collects all replicating docs (excludes `_local/...`) + attachments into a deterministic byte array; returns `{bytes, sizeBytes}`.
- [x] 14.2 Create `src/backup/encrypt.ts`: wraps existing envelope-crypto with `aad = {vaultId, snapshotId, version: "1"}`; emits ciphertext blob.
- [x] 14.3 Create `src/backup/upload.ts`: `uploadSnapshot()` — generates `snapshotId` via `crypto.randomUUID()` (or 128-bit `getRandomValues`), serializes + encrypts, multipart-POSTs to `/auth/backup/upload` with manifest JSON + blob.
- [x] 14.4 Create `src/backup/list.ts`: `listBackups()` calls `GET /auth/backup/list`, returns parsed manifests sorted newest-first.
- [x] 14.5 Create `src/backup/download.ts`: `downloadSnapshot(snapshotId)` calls `GET /auth/backup/<id>`, returns raw ciphertext blob.
- [x] 14.6 Create `src/backup/restore.ts`: `restoreSnapshot(blob, manifest)` — decrypts with envelope-crypto + the snapshot AAD, deserializes, replays into PouchDB using newest-wins (delegates to existing conflict resolver — local doc wins iff `updatedAt > backup.updatedAt`).
- [x] 14.7 Add a Settings → "Manage backups" entry that opens a backup-list screen with manual "Backup now" + per-snapshot "Restore" actions. Free users see the list (read endpoint allows it) but the "Backup now" CTA is disabled with a localized "Upgrade to enable backups" hint.
- [x] 14.8 Add an automatic-backup hook: on app open and at most once per 24h, if entitled, call `uploadSnapshot()` in the background. Persist last-attempt timestamp in `_local/backup-state`.
- [x] 14.9 Unit tests:
  - `src/backup/snapshot.test.ts`: deterministic serialization; excludes `_local/`.
  - `src/backup/encrypt.test.ts`: AAD binding (wrong vaultId fails decrypt; wrong snapshotId fails decrypt).
  - `src/backup/restore.test.ts`: merge keeps newer local writes; missing-doc paths in.
- [x] 14.10 Component test for the backups screen: free disabled-CTA visibility; paid functional flow.

## 15. End-to-end + smoke tests

- [ ] 15.1 New E2E `tests/e2e/billing.spec.ts`:
  - Free user signs in via OAuth stub; tries to add a second device → device-limit screen with upgrade CTA; navigates to Plan picker.
  - Free user picks `sync-monthly` + Bank transfer → instructions visible; admin-confirm via test fixture endpoint → polling transitions to success → sync now succeeds.
  - Force `paidUntil` to `now() - 8d` (test clock); next sync request returns 402 → AppShell routes to Plan screen with renewal CTA.
  - Click cancel via Stripe-portal stub → subscription doc shows `status: "canceled"`, but service runs to `paidUntil`.
- [ ] 15.2 Extend `tests/e2e/offline-sync.spec.ts` to verify a paid user offline for 6 days then online still syncs (within 7-day grace).
- [ ] 15.3 New E2E `tests/e2e/backup-restore.spec.ts`: paid user creates data → triggers backup → wipes IndexedDB on a fresh profile → OAuth + recovery → restores → data is present.
- [ ] 15.4 Add a smoke test for Stripe Checkout: against `STRIPE_TEST_KEY`, hit `POST /auth/billing/stripe/checkout` and assert the returned URL is reachable (HEAD request, expect 200).

## 16. Feature flags + rollout

- [ ] 16.1 Add `BILLING_ENABLED` env flag to `tricho-auth`. When `false`: the entitlement proxy is mounted but allows everything (legacy mode); billing routes return `503`.
- [ ] 16.2 Add `VITE_BILLING_ENABLED` flag to client. When `false`: Plan screen, picker, banner, and instructions are not rendered. The existing `tier` field in Settings continues to render.
- [ ] 16.3 Document the deploy sequence in `infrastructure/couchdb/tricho-auth/README.md` (deploy server with flag off → run migration → flip server flag → deploy client → flip client flag).

## 17. Operator tooling

- [ ] 17.1 Create `infrastructure/couchdb/tricho-auth/scripts/admin-confirm-bank-transfer.mjs`: small CLI taking `--intent-id`, calls the admin-confirm endpoint with `ADMIN_BEARER_TOKEN` from env. Useful for daily reconciliation runs without the operator having to curl manually.
- [ ] 17.2 Create `infrastructure/couchdb/tricho-auth/scripts/list-pending-intents.mjs`: lists pending intents with VS, amount, expiresAt — what the operator matches against bank statements.
- [ ] 17.3 Document admin-token rotation in the README; recommend rotation every 90 days.

## 18. Documentation + announcement

- [ ] 18.1 Update `README.md` with the plan model section and a link to `/pricing` (when published).
- [ ] 18.2 Update `docs/ARCHITECTURE_CHANGES.md` with the entitlement-proxy diagram and the new auth-vs-sync request paths.
- [ ] 18.3 Draft an announcement email for existing free users with ≥ 2 devices explaining the grandfather rule and the upgrade path.
