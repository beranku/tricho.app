# Stripe error-path fixtures

JSON fixtures consumed by `infrastructure/couchdb/tricho-auth/test/billing-stripe.test.mjs` via `loadStripeFixture()` from `test/fixtures/stripe-stub.mjs`.

## Format

```json
{
  "calls": [
    {
      "match": { "resource": "subscriptions", "method": "create" },
      "respond": {
        "kind": "error",
        "errorClass": "StripeCardError",
        "code": "card_declined",
        "decline_code": "insufficient_funds",
        "message": "Your card was declined."
      }
    }
  ]
}
```

`match` selects which SDK call the entry intercepts. The first unconsumed entry whose `match` matches the call is consumed and returned.

`respond.kind` is either:
- `"value"` — `respond.value` is returned as the resolved promise body
- `"error"` — a thrown error of the named class with the supplied properties

A second call with the same `Idempotency-Key` is replayed by adding `"replayCacheKey"` to a `value` entry — the stub remembers the result and returns the same body for any call sharing the cache key.

## When to add a fixture

Only when the real Stripe SDK's *behaviour* matters in the test. For "this code calls Stripe correctly" assertions, prefer the integration tier against `stripe-mock`; for "this code handles a Stripe error correctly" assertions, add a fixture here.

## Bumping

These are hand-authored, not generated. They drift from the live Stripe API on a slow timescale (years). The integration tier (`test/integration/billing-stripe.integration.test.mjs`) catches request-shape drift; this directory catches our own handler drift.
