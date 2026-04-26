# Billing operations

## Deploy sequence (paid-plans-billing)

1. **Provision Stripe.** Create products + recurring prices (monthly + yearly). Capture price IDs.
2. **Set env vars** on the `tricho-auth` host (in addition to existing OAuth + JWT secrets):
   ```
   BILLING_ENABLED=false                         # off until you're ready
   BILLING_CURRENCY=CZK
   PLAN_SYNC_MONTHLY_AMOUNT_MINOR=29900
   PLAN_SYNC_YEARLY_AMOUNT_MINOR=299000
   PLAN_SYNC_MONTHLY_STRIPE_PRICE_ID=price_…
   PLAN_SYNC_YEARLY_STRIPE_PRICE_ID=price_…
   STRIPE_SECRET_KEY=sk_live_…
   STRIPE_WEBHOOK_SECRET=whsec_…
   # STRIPE_API_BASE is a TEST-ONLY override that points the SDK at a mock
   # (e.g. http://stripe-mock:12111). Leave UNSET in production. The
   # boot-time guard in env-guard.mjs refuses to start with NODE_ENV=production
   # when STRIPE_API_BASE resolves to a known mock host — but defense-in-depth:
   # do not ship it in your prod config in the first place.
   BILLING_BANK_IBAN=CZ65…
   BILLING_BANK_ACCOUNT=1234567890/0100
   BILLING_ADMIN_TOKEN=<long-random>
   BACKUP_ROOT=/var/lib/tricho-backups
   ```
3. **Deploy server with `BILLING_ENABLED=false`.** The CouchDB proxy is mounted but waves all requests through (legacy mode); billing endpoints return 503. Existing free users keep two devices.
4. **Run the subscription migration** to backfill `entitlements` / `provider` / `status` / `freeDeviceGrandfathered`:
   ```
   COUCHDB_URL=http://couchdb:5984 \
   COUCHDB_ADMIN_PASSWORD=… \
     node infrastructure/couchdb/tricho-auth/scripts/migrate-subscriptions.mjs
   ```
   Idempotent — running twice is a no-op for already-migrated docs.
5. **Configure the Traefik route** so `/userdb-*` traffic goes to `tricho-auth` (host `:4545`) instead of directly to CouchDB. CouchDB stops being a public service.
6. **Flip the server flag.** Set `BILLING_ENABLED=true` and restart `tricho-auth`. Sync requests now pass through the entitlement gate.
7. **Deploy client** with `VITE_BILLING_ENABLED=false`. Plan UI hidden; existing users see no change.
8. **Flip the client flag.** Set `VITE_BILLING_ENABLED=true`, rebuild + redeploy. Plan picker, plan screen, and renewal banner now visible.
9. **Configure the Stripe webhook** in the Stripe dashboard pointing at `https://<auth-host>/auth/billing/stripe/webhook`. Subscribe to:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`

## Operator workflow: bank transfer reconciliation

Daily (or whenever bank statements arrive):

```
COUCHDB_URL=http://couchdb:5984 \
COUCHDB_ADMIN_PASSWORD=… \
  node infrastructure/couchdb/tricho-auth/scripts/list-pending-intents.mjs
```

Match each row against today's incoming transactions in your bank's web app
(use the VS column). For each confirmed deposit:

```
ADMIN_BEARER_TOKEN=… AUTH_URL=https://<auth-host> \
  node infrastructure/couchdb/tricho-auth/scripts/admin-confirm-bank-transfer.mjs \
    --intent-id=int_abc
```

The endpoint is idempotent — replaying the same `--intent-id` returns 200 without double-crediting the user.

Rotate `BILLING_ADMIN_TOKEN` every ~90 days; coordinate with the operator team.

## Rollback

- **Pre-paying-customers:** flip `BILLING_ENABLED=false`. The proxy reverts to legacy mode (allow all). Subscription docs keep their extra fields, harmless. Refund any Stripe invoices manually via the dashboard.
- **With paying customers:** disable **new** purchases only — set `BILLING_NEW_PURCHASES_ENABLED=false`. Existing entitlements continue to enforce; new Checkout / intent calls return 503.
