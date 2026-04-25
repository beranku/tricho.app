## Context

TrichoApp today is a fully free, two-device-per-user offline-first encrypted PWA. Identity is OAuth (Google / Apple); identity records and a stub `subscription` doc live in `tricho_meta` on CouchDB; per-user vault data lives in `userdb-<hex>` databases addressed by JWT bearer. CouchDB is fronted by Traefik on the public edge and validates JWTs statelessly via the `[jwt_keys]` config it loads at boot. There is no payment provider integration, no backup capability, and no entitlement layer beyond the device-limit check that runs once at OAuth-callback time.

The change introduces three plans (`free`, `sync-monthly`, `sync-yearly`), two payment paths (Stripe recurring, Czech bank transfer single-period), and a new encrypted-backup capability — all without altering encryption invariants or pushing plaintext to the server.

Constraints we must hold:
- **Zero-knowledge**: server sees ciphertext + OAuth identity only. Stripe sees email + plan SKU; bank-transfer flow sees nothing per-user beyond the canonical username.
- **Offline-first**: a paid user offline for 6 days during the 7-day grace window must still sync when they reconnect. Plan state is checked on-request, not held client-side as authoritative truth.
- **Idempotent payment processing**: Stripe webhooks retry; bank-transfer admin confirmations may double-fire. Same event must not extend `paidUntil` twice.
- **Reversibility**: rollback to pre-change state must be possible without data migration of encrypted documents.

Stakeholders: solo trichologists (free local), multi-device practitioners (paid), Czech-market finance (bank transfer is non-negotiable), the operator team (admin-confirmation tooling for bank transfers in v1).

## Goals / Non-Goals

**Goals:**
- One entitlement model (`entitlements: string[]`) gates both `live-sync` and `encrypted-backup` regardless of payment provider.
- Stripe webhook is the canonical writer for Stripe-tracked subscriptions; request handlers are read-only over `paidUntil`.
- Bank-transfer flow ships in v1 with a manual admin-confirm endpoint, but the contract is shaped so a bank-API reconciliation job can replace the admin step without spec or client changes.
- Free tier remains genuinely usable for a single-device, offline-only user — no nag screens, no upgrade pressure beyond a passive "Add another device" CTA on the device-limit screen.
- Sync gating happens at the network edge (between client and CouchDB), not inside the client. A jailbroken client cannot bypass it.
- Backups are opaque to the server. The DEK never leaves the device. A backup restore on a fresh device still requires the user's WebAuthn-PRF or Recovery Secret.
- All copy ships in cs + en at parity with `i18n-multilocale-support`.

**Non-Goals:**
- Multi-seat / team plans. The data model assumes one canonical user per subscription.
- Per-device pricing. Paid plans grant unlimited devices.
- Promotional codes, referrals, A/B-tested pricing pages. Stripe coupons can be applied via dashboard if needed but are not part of the spec.
- Free trial of the paid plan. Out of v1; revisit after launch.
- Bank-API automated reconciliation. The intent + admin-confirm contract is forward-compatible; the integration is a future change.
- Refund automation. Stripe refunds via portal; bank-transfer refunds are out-of-band.
- Czech VAT (DPH) registration / EET. The receipt is a statement, not a tax document. Operators outside the VAT threshold can use it as-is; once registered, a follow-up change adds proper invoicing.
- Plaintext invoice line items beyond `{plan, period, amount, currency}`.
- Replacing existing `tier` field. We **add** `entitlements` and keep `tier` as a denormalized label for UI; the gate logic reads `entitlements`.

## Decisions

### D1 — Entitlement check via reverse proxy in `tricho-auth`, not via CouchDB role rotation

**Decision:** Insert `tricho-auth` as a reverse proxy in front of `/userdb-*/*` traffic. The proxy validates the bearer JWT (cheap — public key in process), looks up the user's subscription doc, and either forwards to CouchDB or returns `402 plan_expired`.

**Alternatives considered:**
- *Rotate the user's CouchDB password on entitlement loss.* Slow (write to `_users` doc → replication lag), destructive (re-auth required even after re-paying within grace), and couples entitlement to CouchDB internals.
- *Map `entitlements` into JWT claims and let CouchDB enforce.* CouchDB's JWT layer does not natively support custom claim-based ACLs without a `validate_doc_update` or external auth handler — we'd be back to a proxy anyway, but inside CouchDB. Easier to keep it in `tricho-auth` where the subscription store already lives.
- *Client-side gate only.* Bypassable; not acceptable for a revenue control.

**Why this wins:** the entitlement read is co-located with the subscription writer (no cross-service consistency to manage), the JWT validation cost is paid once (cached pubkey), and rollback is a single Traefik route change. Latency cost: one extra TCP hop on the same Docker network — negligible compared to the existing CouchDB round-trips a sync session triggers.

**Cache strategy:** `tricho-auth` caches the entitlements lookup for 30 seconds keyed by canonical username, so a sustained sync (hundreds of `_changes` requests / minute) does not hammer the meta DB. The cache is invalidated on Stripe-webhook write and bank-transfer admin-confirm. Trade-off: a paid user's grace-window expiry can lag by up to 30 seconds — acceptable; we already have a 7-day grace window.

### D2 — Stripe webhook is the single writer for Stripe-tracked subscriptions

**Decision:** `paidUntil` for Stripe subscriptions is set only by the webhook handler at `POST /auth/billing/stripe/webhook`. The redirect from Checkout to the app is a UX hint, not an authority. The client polls `GET /auth/subscription` for ~30s after redirect, with a fallback "still processing — refresh in a minute" message.

**Alternatives considered:**
- *Set `paidUntil` on Checkout success redirect.* The redirect is unauthenticated state from Stripe's side; using it as authority opens a forge surface where a user fakes the redirect and gains paid access until the webhook either confirms or never arrives.
- *Both paths write, last-writer-wins.* Race conditions: a slow webhook + fast redirect could revert paid → free if events arrive out of order.

**Why this wins:** the webhook signature is HMAC-verified against the Stripe-issued secret. It is the only source of authoritative payment state. The polling UX absorbs the typical sub-second webhook latency.

**Idempotency:** the webhook handler maintains a `payment-event:<provider>:<eventId>` doc in `tricho_meta`. If the doc already exists, the handler returns `200` without writing. Stripe retries are absorbed.

### D3 — Bank-transfer flow uses VS-keyed payment intents with explicit admin confirmation in v1

**Decision:** `POST /auth/billing/bank-transfer/intent` mints a `payment-intent` doc with a globally unique 10-digit VS, returns `{intentId, vs, amount, iban, accountNumber, expiresAt, qrCodePayload}`. The user pays from their bank with that VS in the reference. An operator (separate admin role) calls `POST /auth/billing/bank-transfer/admin/confirm` with `{intentId}` after sighting the deposit. The handler debits the intent and credits `paidUntil`.

**Alternatives considered:**
- *Auto-reconcile via FIO / Air Bank API in v1.* Higher integration cost; operator wants to ship the manual flow first to validate demand. The contract is identical from the client's perspective, so swap-in is one server file.
- *PSP that wraps bank transfers (e.g., GoPay, ComGate).* Adds a third-party fee and another vendor relationship for a flow that's already well-understood in CZ. Defer.

**VS generation:** `randomBytes(8).readUIntBE(0, 6)` modulo 10^10, retried on collision (uniqueness check against an index on `payment-intent.vs`). Length 10 because Czech VS is max 10 digits.

**Idempotency:** the admin-confirm handler keys off `intentId` not VS. A double-fire on the same intent finds the intent already in `status: "paid"` and returns `200` without re-crediting.

**Expiry:** intents expire after 14 days. An expired intent cannot be confirmed — the operator must reissue. This protects against a customer paying months late after a price change.

### D4 — `paidUntil` math: extend from later of `now()` or current `paidUntil`

**Decision:** when crediting a period, `paidUntil = max(now(), paidUntil_old) + periodSeconds`. This means a paid user renewing 5 days early loses no time; a returning user who let their plan expire 2 months ago re-starts from today.

**Alternatives considered:**
- *Always extend from `paidUntil_old`.* Penalizes early renewal and lets a returning user pay for "back days" they didn't get service for. Wrong incentive both directions.
- *Always reset to `now() + periodSeconds`.* Penalizes early renewal even within the active period.

### D5 — Backups are encrypted client-side; server stores opaque blobs + minimal manifest

**Decision:** the client serializes the local PouchDB to a single AEAD-encrypted blob. Encryption uses the existing envelope-crypto module with new AAD `{vaultId, snapshotId, version: "1"}`. Manifest is `{snapshotId, sizeBytes, createdAt, deviceId, vaultId}` — no document IDs, no counts, no plaintext metadata that could correlate to vault content.

**Storage on server:** filesystem-backed (e.g., `/var/lib/tricho-backups/<canonicalUsername>/<snapshotId>.bin`) in v1. Object storage (S3-compatible) is a follow-up. Server enforces `entitlements.includes("backup")` on read AND write.

**Retention:** keep the 7 most recent snapshots + 1 monthly anchor (oldest snapshot with `createdAt` in each calendar month, up to 12 months). Older snapshots are pruned on next upload from the same user.

**Restore flow:** on a fresh device, after OAuth and key bootstrap (WebAuthn-PRF or Recovery Secret), the user can list backups and choose one. Download streams ciphertext, client decrypts using the unwrapped DEK, replays into PouchDB. Existing local docs are merged via the `live-sync` newest-wins resolver (so picking up a backup mid-session does not erase fresher local writes).

**AAD binding:** binding to `snapshotId` ensures a stolen blob cannot be substituted into a different vault's restore by a malicious server.

### D6 — Free-tier device limit goes from 2 → 1, with grandfather flag

**Decision:** `subscription.deviceLimit` for free remains in the doc (operator can flip in emergencies). New free users get `deviceLimit: 1`. Migration script flips existing free users to `deviceLimit: 1, freeDeviceGrandfathered: true` if they currently have ≥ 2 active devices, allowing the device-limit handler to permit those existing devices but reject new ones.

**Alternatives considered:**
- *Grandfather indefinitely with `deviceLimit: 2`.* Long-term entitlement drift; operator has to track two cohorts forever.
- *Force re-pair: revoke all but one device on free.* Hostile to existing users.

The grandfather flag self-resolves over time as users upgrade or shed devices.

### D7 — Czech `SPAYD` QR code generation server-side

**Decision:** the bank-transfer-intent response includes `qrCodePayload` — the **SPAYD** (Short Payment Descriptor) string per Czech standard, e.g. `SPD*1.0*ACC:CZ65...*AM:299.00*CC:CZK*X-VS:1234567890*MSG:Tricho Sync Annual`. Client renders the QR offline (no third-party API call). The bank's mobile app reads the QR and pre-fills the payment.

**Why server-side payload generation:** consistent with the IBAN, account number, and amount — they all come from server config. Client only renders.

**QR rendering library:** existing offline-friendly QR encoder (no network). Pin a small dependency rather than implement Reed-Solomon ourselves.

### D8 — Stripe customer keyed by canonical username, never by email

**Decision:** when a user opens Checkout, `tricho-auth` either retrieves an existing Stripe customer keyed by `metadata.canonicalUsername === user.canonicalUsername` or creates a new one with that metadata field set. The user's email is passed to Stripe for receipts but is **not** the lookup key.

**Alternatives considered:**
- *Email as Stripe customer key.* Breaks on email change (the same canonical user would split into two Stripe customers).
- *Storing the Stripe customer ID in the subscription doc.* We do this too — but the metadata-based lookup is the recovery path if the doc is lost.

### D9 — `402 plan_expired` is the unified entitlement-failure status

**Decision:** the proxy returns `402 Payment Required` (not `403 Forbidden`) with body `{error: "plan_expired", reason: "sync_entitlement_missing"|"backup_entitlement_missing", paidUntil, gracePeriodEndsAt}`. The client distinguishes 402 from 401 in `bearerFetch` and routes the user to the plan screen instead of refresh.

**Alternatives considered:**
- *403 + JSON body.* Conflates "you're not allowed" with "you'd be allowed if you paid".
- *Custom 4xx code.* Non-standard; intermediate proxies / monitoring may not handle it.

`402` is HTTP-original-spec for this exact case; modern stacks (Stripe, Cloudflare) use it idiomatically.

### D10 — Plan catalog is server-config, not spec-pinned

**Decision:** `GET /auth/plans` returns plan SKUs with their period and price; the spec defines the **shape** but not the values. Operators tune pricing without a spec change. The Stripe price IDs and bank-transfer amounts live in `tricho-auth` env config (`PLAN_SYNC_MONTHLY_AMOUNT_CZK`, `PLAN_SYNC_MONTHLY_STRIPE_PRICE_ID`, …).

### D11 — Plan IDs are (tier × period); subscription stores derived shape

**Decision:** plan IDs are `free`, `pro-monthly`, `pro-yearly`, `max-monthly`, `max-yearly`. The subscription doc additionally stores `tierKey: "free"|"pro"|"max"` and `billingPeriod: "month"|"year"|null` as denormalized convenience fields. Helpers `tierOf(planId)`, `billingPeriodOf(planId)`, `deviceLimitOf(planId)`, `backupRetentionMonthsOf(planId)` derive the canonical shape from the plan id.

**Why:** the original 3-plan grid (`free`/`sync-monthly`/`sync-yearly`) couldn't express the feature differentiation users want (more devices + longer backup history). Tier × period preserves the operator's pricing flexibility (yearly discount) while the spec's behaviour talks in terms of `tierKey` so future tiers don't churn the language.

### D12 — Entitlement vector + retention parameter, not multiple entitlement strings

**Decision:** keep `entitlements: ["sync", "backup"]` as the binary capability set. Add `backupRetentionMonths` and `deviceLimit` as **parameters** on the subscription doc rather than splitting "backup" into "backup-12mo" / "backup-60mo".

**Why:** the proxy gate's contract stays unchanged; we just consult `backupRetentionMonths` for retention sweep arithmetic. New plan tiers tomorrow only have to dial these numbers up.

### D13 — Server-side cloud backup, daily cron, monthly bucket

**Decision:** `tricho-auth` runs a node-cron-like daily job (`BACKUP_CRON_INTERVAL_HOURS=24` default). Each tick:
1. Iterates paid subscriptions.
2. Re-composes a draft monthly ZIP for the current calendar month (overwriting the previous draft on disk).
3. On the 1st day of a new month, also finalizes the previous month and starts a fresh draft.
4. Applies retention (`Math.min(backupRetentionMonths, total)` newest survives).

**Why:** "snapshot the previous month at month-end" is too rigid — a user who loses their device on day 28 wants the day-28 photos in their backup. Daily-overwrite-draft makes the latest snapshot at most ~24h out of date even mid-month, while month-boundary finalization keeps the long-term retention bucket aligned to calendar months.

### D14 — Photo bucketing via plaintext `monthBucket: "YYYY-MM"`

**Decision:** photo-meta docs add a top-level plaintext `monthBucket` field at first write, computed from `takenAt` in UTC. Soft-deletes and edits **must preserve** the original bucket. Server uses this field directly for filtering during snapshot composition. Legacy docs missing the field fall back to `formatUtcMonth(updatedAt)` (best-effort — a one-shot `migrate-photo-month-bucket.mjs` backfills production data using the same fallback).

**Why:** server cannot read `takenAt` (encrypted in `payload`). Without `monthBucket` the snapshot job would have to bucket by `updatedAt`, which moves whenever a photo is edited (e.g., note added) — wrong bucket, wrong backup. Privacy: server already sees `updatedAt` at ms granularity; `monthBucket` aggregates to month — strictly less information than what's already exposed.

### D15 — Single shared ZIP byte format for cloud and local

**Decision:** both the server cron and the client local-export produce a byte-identical `.tricho-backup.zip` for the same logical input. Layout:
- `manifest.json` — `{version: "1", vaultId, monthKey, generatedAt, source, docCount, photoCount, attachmentCount}`.
- `vault-state.json` — verbatim copy of `_local/vault-state` (so a fresh device can unwrap the DEK with Recovery Secret before any sync).
- `docs.ndjson` — one non-photo doc per line, exactly the wire shape (`{_id, type, updatedAt, deleted, payload}`).
- `photos.ndjson` — one photo-meta doc per line (filtered to `monthKey`).
- `attachments/<docId>/<name>.bin` — raw encrypted attachment bytes, byte-identical to what's in PouchDB / CouchDB.

The composer module (`src/backup/zip-pack.ts` for the client and the matching `infrastructure/couchdb/tricho-auth/billing/zip-pack.mjs` for the server) is pure data transformation: same JSZip dependency, same field order, same fixed timestamp on every entry, same STORE compression. A backend integration test asserts bit-identity for matching inputs.

**Why:** D18's bytes-as-is invariant becomes much easier to enforce when a single restore code path swallows ZIPs from either source. Operators (and users) can move a backup blob between cloud and a USB stick without any format conversion.

### D16 — Retention is "newest N months", no daily / anchor logic

**Decision:** retention is per-month: `applyMonthlyRetention(manifests, retentionMonths)` keeps the `retentionMonths` newest entries. No "7 daily + 12 monthly anchors" rule from the previous design — that mattered when snapshots were arbitrary points in time, but with month-keyed snapshots there is exactly one snapshot per month, so the rule reduces to "keep the last N".

### D17 — Restore is one code path, two entry points

**Decision:** `restoreFromZipBytes(opts)` in `src/backup/local-zip-restore.ts` accepts ZIP bytes from any source (file picker or cloud download). `RestoreFromZipScreen` is reachable from:
1. The login screen on a fresh device (alternative to OAuth → sync).
2. Settings → Backups for power users wanting to roll back from a specific month.

Decryption of doc contents happens **lazily** when the UI later reads a doc — same path as normal sync. Restore itself never touches the DEK.

### D18 — No re-encryption; bytes-as-is invariant for backups

**Decision:** backup composition NEVER decrypts. The server cron reads CouchDB rows with `attachments=true` (admin auth allows this) and copies `payload` ciphertext + raw attachment bytes 1:1 into the ZIP. The client iterates `db.pouch.allDocs({attachments: true, binary: true})` and does the same. There is no separate AAD for backups; the existing per-doc `{vaultId, docId}` AAD from `payload-encryption` continues to be the integrity guarantee.

**Implications:**
1. Backup attack surface = sync attack surface. A leaked ZIP exposes the same metadata (`_id`, `type`, `updatedAt`, attachment sizes, `monthBucket`) as a leaked CouchDB userdb. Nothing more.
2. Restore on a new device requires the user's DEK (via Recovery Secret or WebAuthn-PRF) to make sense of anything inside the ZIP. The ZIP itself is replayable into PouchDB without a DEK; the contents stay opaque until the DEK is in hand.
3. Tests for both `local-zip` and `backup-snapshot` modules include an `assertNoPlaintextLeak(zip, [knownPlaintexts])` helper that fails the build if any fixture customer-name or note string appears anywhere in the ZIP bytes. This is a regression guard against a future PR accidentally adding a "convenience" decrypt step in the backup path.

## Risks / Trade-offs

- **[Stripe webhook delay leaves user in "paid but UI says free" limbo for ~30s after Checkout.]** → Mitigation: client polls `GET /auth/subscription` every 2s for 60s after Checkout redirect; UI shows "Activating your plan…" spinner. If still pending after 60s, surfaces "Payment is still processing — we'll email when it's active."

- **[Webhook secret leak forges paid status.]** → Mitigation: secret is in `tricho-auth` env, never logged; rotated on suspicion via Stripe dashboard. Hostile webhook from an attacker with the leaked secret can grant paid to any user, but cannot exfiltrate data — it only flips entitlements. Detection: a Stripe-side audit of subscriptions vs. webhooks-fired count; alert on drift.

- **[Bank-transfer admin-confirm endpoint is a high-value target.]** → Mitigation: (a) requires a separate admin bearer token with rotation, not a regular user JWT; (b) confirmations are append-only and visible in an admin log; (c) future bank-API integration retires the manual endpoint entirely. v1 operator hygiene: one or two trusted operators only.

- **[Entitlement-cache 30s window allows ≤30s of post-cancellation sync.]** → Acceptable: cancellation typically takes effect at period end anyway (Stripe portal default). Immediate-cancel via portal is a refund decision the operator makes manually.

- **[A free user who exfiltrates IndexedDB cannot upload a backup, but can still keep the data forever.]** → That's acceptable: the free product is "your data, your device". Backups are a server-side convenience for paid users.

- **[Restore from backup on a new device with stale local data could overwrite recent local writes.]** → Mitigation: restore is a merge, not a replace — the existing newest-wins resolver picks the higher `updatedAt`. The user is warned: "Your most recent local changes will be preserved if newer than the backup."

- **[CouchDB stops being directly fronted; if `tricho-auth` is down, sync stops even for paid users.]** → Mitigation: the proxy is a thin pass-through; observability + restart policy + healthcheck on Traefik. The same JWT cache strategy means a brief `tricho-auth` outage is felt as "sync paused" not "data lost". Existing offline-first means users still write locally.

- **[Bank-transfer reconciliation is manual in v1; cash flow is gated on operator availability.]** → Trade-off accepted by stakeholder. The customer experience (instructions, QR, receipt) is fully self-serve; only the accounting half is human. The contract supports automation drop-in.

- **[Stripe is unavailable in some markets; bank transfer is CZ-only.]** → For v1, target market is CZ + neighboring EU where SEPA bank transfer with VS works. A user from outside this geography will see only Stripe. Future change can add other PSPs.

- **[Stripe + bank-transfer concurrent active subscriptions on the same user.]** → Prevent: `POST /auth/billing/*/intent` (both paths) checks the user has no active conflicting plan. If user has Stripe and tries bank transfer, they must cancel Stripe first; if user has unexpired bank-transfer paidUntil and tries Stripe, the new Stripe subscription's first invoice deferred-starts at `paidUntil`. Implementation: pass `trial_period_days` to Stripe equal to `(paidUntil - now)/86400`.

- **[`tricho_meta` document inflation from `payment-event` dedup table.]** → Mitigation: each event doc has `expireAt = createdAt + 30d`; a periodic sweeper purges expired ones. 30 days is well past Stripe's webhook retry window (3 days) and bank-transfer reconciliation lag.

## Migration Plan

**Pre-deploy:**
1. Add new fields to subscription docs (`entitlements`, `provider`, `status`, `freeDeviceGrandfathered`) via a backfill script. Idempotent — running twice is a no-op. Default values: `entitlements: []` for free, `entitlements: ["sync","backup"]` for paid; `provider: "stripe"` if a Stripe customer ID is detected else `null`; `status: "active"` if paid and `paidUntil > now()` else `"expired"`; `freeDeviceGrandfathered: true` for free users with ≥ 2 active devices, else `false`.
2. Provision Stripe products + prices for `sync-monthly` and `sync-yearly`; record the price IDs in `tricho-auth` env config.
3. Configure the bank account, IBAN, and amounts in env config.

**Deploy step 1 — server with feature flag off:**
4. Ship `tricho-auth` with new endpoints behind `BILLING_ENABLED=false`. The CouchDB proxy is mounted but allows all entitlements (legacy mode). Existing free users keep 2 devices; sync still works for everyone.

**Deploy step 2 — client UI behind feature flag:**
5. Ship the Plan screen, plan picker, renewal banner behind `VITE_BILLING_ENABLED=false`. They render only when the flag is on. SettingsScreen still shows the legacy `tier` field.

**Deploy step 3 — flip flags:**
6. Set `BILLING_ENABLED=true` server-side; CouchDB proxy starts enforcing entitlements. Existing paid users have `entitlements: ["sync","backup"]` from backfill — no break. Existing free users with ≥ 2 devices have `freeDeviceGrandfathered: true` — no break.
7. Set `VITE_BILLING_ENABLED=true` client-side; Plan screen and CTAs become visible.

**Deploy step 4 — communicate:**
8. Announcement email to existing free users with ≥ 2 devices: "Free now means one device per account; you keep your current devices, but adding a third will require Sync. Here's how it works."
9. Announcement to new sign-ups: free is local, paid is sync + backup. Pricing on `/pricing`.

**Rollback:**
- **Pre-flip:** delete the new docs / endpoints; no client-visible changes. Subscription docs with extra fields are harmless.
- **Post-flip, before any paying customers:** flip flags off; CouchDB proxy returns to legacy mode (allow all). Subscription doc fields persist but are unread.
- **Post-flip with paying customers:** disabling billing without refund is hostile. Real rollback path is to keep paid users' service running while disabling **new** purchases (a `BILLING_NEW_PURCHASES_ENABLED=false` sub-flag). Stripe and bank-transfer endpoints return `503 service_unavailable`; existing entitlements continue to enforce normally. This buys time to debug without ripping out the proxy.

## Open Questions

1. **Pricing.** The spec is shape-only; the operator picks values. Is there a CZK target (e.g. 99/mo, 999/yr) and a EUR/USD equivalent for non-CZ Stripe customers? *Answer needed before deploy step 2.*
2. **VAT / DPH.** Are we under or over the 2M CZK turnover threshold? If over, the receipt must become an invoice (faktura) with all the legal fields (IČO, DIČ, dodavatel, odběratel, datum zdanitelného plnění). *Defer to a follow-up change once revenue proves the model; operator confirms.*
3. **Operator admin auth.** v1 uses a static admin bearer token. Should this be a separate admin OAuth flow (Google Workspace allowlist) or stay shared-secret-with-rotation? *Recommend shared-secret in v1; revisit if operator team grows past 2 people.*
4. **Bank-API integration ETA.** Is FIO Bank API the target (most common for CZ small biz, free tier sufficient)? Setting this expectation helps shape the admin-confirm endpoint's contract. *Plan: design the contract for FIO's `transactions` endpoint shape so swap-in is one file.*
5. **Backup retention precision.** Is "7 most recent + 12 monthly anchors" right, or do we want operator-tunable retention per plan tier? *v1: hardcoded; operator-tunable is a follow-up if backup storage costs surprise us.*
6. **Restore UX on a fresh device.** Should the user be able to restore *before* completing OAuth + key bootstrap (e.g. "I've lost my device, here's my Recovery Secret, restore the latest backup")? The current flow assumes OAuth-first because the JWT is needed to fetch the backup blob. *Yes, but it requires a careful UX: the Recovery Secret unwraps the DEK, then the user authenticates to OAuth, then fetches the latest backup, then decrypts. Spec should describe this two-step.*
