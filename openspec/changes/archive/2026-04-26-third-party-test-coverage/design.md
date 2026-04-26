## Context

Three external integrations sit on the auth path:

- **Google OIDC** — implemented in `infrastructure/couchdb/tricho-auth/providers/google.mjs` via `openid-client`. CI already runs against `infrastructure/mock-oidc/server.mjs` (a custom RS256 issuer + PKCE + `/mock/identity` test-control endpoint), wired through Traefik in the `ci` compose profile. `GOOGLE_ISSUER_URL` overrides discovery; the rest of the OIDC plumbing (token, JWKS, userinfo) is auto-discovered.
- **Apple Sign In** — implemented in `providers/apple.mjs` using `jose` directly (no `openid-client`, because Apple is not RFC-clean OIDC: `form_post` callback, no PKCE, ES256 JWT *as the* client_secret, `name` claim returned only on the first authorization, private-relay emails). The provider currently hard-codes `APPLE_ISSUER` / `APPLE_AUTHORIZE` / `APPLE_TOKEN` / `APPLE_JWKS` to `appleid.apple.com`. **There is no Apple sandbox** — every offline test must use a mock issuer that we control.
- **Stripe** — implemented in `infrastructure/couchdb/tricho-auth/billing/stripe.mjs`. Unit tests cover `verifyWebhookSignature` (HMAC-SHA256, replay window) and `applyStripeEvent` (subscription upsert, invoice credit, status transitions) with a fake meta and `_setStripeClient(fake)` to avoid the real SDK. There is no SDK contract test, no Checkout/Elements browser flow, no error-path fixtures, and no idempotent-replay test.

Constraints:

- **CI must remain offline.** No outbound calls to Google, Apple, or Stripe. No secrets in PR pipelines.
- **Production wiring is untouched.** Test-only env vars must default to the real issuer / API host when unset. A production server starting with a mock-pointing env var is a misconfiguration we want to fail loud.
- **No parallel mocking stack.** The project does not use MSW (`grep -rln msw` returns nothing in source). Adding MSW for one integration creates two ways to do the same thing. Where in-process mocks are needed, hand-roll a fetch stub in the existing test setup.
- **Test-pyramid budgets** (from the `test-strategy` capability): backend-unit median <20 ms/test, backend-integration <2 s/test, e2e <30 s/test.

Stakeholders: anyone touching `tricho-auth` (auth path) or `billing/` (subscription path) in PRs. CI minutes budget is owned by infra.

## Goals / Non-Goals

**Goals:**

- Apple Sign In can be exercised end-to-end (server + browser) in CI with no real Apple infrastructure.
- Stripe SDK calls (Checkout session creation, customer create, portal session, subscription cancel) hit a local mock and are verified for shape contract on every PR.
- Stripe error paths (declined card, 3DS required, insufficient funds, idempotent replay, unknown webhook event) have direct test coverage.
- A single env-toggle convention (`*_OIDC_ISSUER`, `STRIPE_API_BASE`) is used consistently for prod-vs-mock swap.
- Every CI job can declare its third-party dependency at the workflow level via `services:` or a compose profile, with health checks; flaky network-dependent steps are eliminated.

**Non-Goals:**

- Re-validating Stripe API contract drift on every PR. That is an explicit nightly job against `testmode` (out of scope here, documented in `docs/TESTING.md`).
- Apple Sign In native UI parity (the `AuthenticationServices` framework). That is a manual physical-device smoke pre-release.
- Real 3DS challenge UX. The fixture playback covers the SDK-side branch; the actual challenge iframe is exercised by manual smoke against testmode.
- Replacing the existing `mock-oidc` Node service with a Docker image (e.g. `ghcr.io/navikt/mock-oauth2-server`). The custom service already does what we need and gives us identity-control endpoints (`/mock/identity`) the off-the-shelf images don't.
- Touching the encryption layer. None of these mocks see plaintext data, the DEK, or the Recovery Secret.

## Decisions

### D1: Extend the existing `mock-oidc`, do not adopt a third-party container

**Decision:** Keep `infrastructure/mock-oidc/server.mjs`. Refactor it from "single Google-shaped tenant on `/mock-oidc/*`" into "tenanted IdP" with `/google/*` and `/apple/*` path prefixes, each carrying its own quirks. Backwards-compatible: leave the existing top-level `/authorize`, `/token`, `/.well-known/...` routes as aliases for `/google/*` so existing tests don't move in lockstep.

**Why over alternatives:**
- *`ghcr.io/navikt/mock-oauth2-server`*: handles multi-tenant cleanly via path prefix, and is well-maintained. But it has no test-control endpoint comparable to the existing `POST /mock/identity` — Playwright tests would have to drive it via the Spring-Boot-style `/issuer1/admin/...` JSON config, which is a more invasive harness change. We'd also have to teach Traefik a second routing rule and rebuild the e2e fixture in `tests/e2e/fixtures/mock-oidc.ts`.
- *`oauth2-mock-server` (npm)*: programmable in-process, but doesn't help the e2e tier where the server runs in its own container. We'd need both it and the existing `mock-oidc` — two stacks doing the same job.
- *`Soluto/oidc-server-mock`*: declarative-only via JSON env. No way to swap identity per-test without restarting the container.

The existing service is ~200 lines, already covers the hard PKCE/JWKS/discovery details, and we control the test-harness API. Marginal cost to add an Apple tenant is ~80 lines.

**Apple-specific deltas in the mock:**
- `POST /apple/token` accepts `client_secret` as an ES256 JWT but does not enforce its signature in the mock (production validates against Apple's JWKS; mock skips). Add a comment + a separate "validate Apple client_secret JWT" requirement on the *real* code path so this asymmetry is intentional.
- ID token claims include `is_private_email: boolean` and optionally `email: '*@privaterelay.appleid.com'`.
- `name` claim is returned only on the very first `/authorize` call per `sub`. Track per-`sub` state in the existing in-memory `codes` map → promote to a `Map<sub, { authorizedOnce: boolean }>`. Wired through `POST /apple/mock/reset` so a single Playwright spec can simulate "first time" again.
- Callback is `form_post` HTML (a tiny self-submitting form), not a redirect. Implement once in `/apple/authorize` so the browser-side path is realistic.

### D2: Apple provider becomes env-driven, with prod-protection

**Decision:** Remove the four hardcoded constants in `providers/apple.mjs`. Derive everything from `APPLE_OIDC_ISSUER` (default: `https://appleid.apple.com`). The endpoint paths (`/auth/authorize`, `/auth/token`, `/auth/keys`) are stable enough to derive by string concat — Apple has not changed them in years and the alternative (full discovery) doesn't apply because Apple does not publish a `.well-known/openid-configuration`. Document the lack of discovery as an Apple quirk in the file header.

Add a boot-time guard in `infrastructure/couchdb/tricho-auth/server.mjs`:

```js
if (process.env.NODE_ENV === 'production') {
  const apple = process.env.APPLE_OIDC_ISSUER;
  if (apple && /(^|\W)(localhost|mock-oidc|tricho\.test)(\W|$)/.test(apple)) {
    throw new Error('APPLE_OIDC_ISSUER points at a mock host in production');
  }
}
```

Equivalent guard for `GOOGLE_ISSUER_URL` and `STRIPE_API_BASE`.

**Why:** The threat is that a developer copies a `.env.ci` line into prod. Failing fast at boot is cheap and we already control the boot script.

**Trade-off considered:** Add a `TRICHO_TEST_PROFILE=true` env var that *enables* the override, defaulting to off, so the prod default is "ignore the override variable entirely". Rejected because it complicates the dev experience (devs would forget to set it) and the boot-guard is enough.

### D3: Stripe — three layers, each for one job

**Decision:** Use three orthogonal mocks, each scoped to one tier:

| Layer | Tool | Scope | Tier |
|---|---|---|---|
| **SDK contract** | `stripemock/stripe-mock` (Docker, port 12111, stateless) | "Does our request shape parse against Stripe's OpenAPI?" | backend-integration |
| **Stateful e2e** | `localstripe` (Docker, port 8420, stateful, has `/js.stripe.com/v3/` shim) | "Does Checkout + Elements complete a real-feeling subscription flow?" | e2e (Playwright) |
| **Error paths** | In-process fetch stub in `vitest.config.backend.ts` | "Does our handler do the right thing on declined/3DS/replay?" | backend-unit |

Wire them via the SDK's existing host/port/protocol override:

```js
// billing/stripe.mjs
const Stripe = requireFromHere('stripe');
stripeClient = new Stripe(key, {
  apiVersion: env.STRIPE_API_VERSION ?? null,
  ...(env.STRIPE_API_BASE ? parseStripeBase(env.STRIPE_API_BASE) : {}),
});
```

`parseStripeBase('http://stripe-mock:12111')` returns `{ host, port, protocol }`. Default unset → real api.stripe.com.

**Why three, not one:**
- `stripe-mock` is *stateless* — `customers.create()` returns success but doesn't persist; a follow-up `customers.retrieve(id)` doesn't see it. Useless for end-to-end.
- `localstripe` is stateful but does not validate request shape against the OpenAPI; an SDK-version drift (e.g. a renamed param) could pass through unnoticed.
- Both lack expressive error injection (declined card with specific decline_code, 3DS triggers, idempotency replay). For those, fixture playback is the cheapest tool.

**Why no MSW:** Adding MSW only for Stripe error paths drags in a runtime dependency, a service-worker harness, and a precedent for "we mock HTTP this way now". The fetch stub we need is ~30 lines, lives only in the backend-tier setup file, and never ships to a browser.

### D4: Webhook idempotency

**Decision:** Add a unit test that POSTs the same Stripe event twice (same `event.id`) and asserts the meta layer's `recordPaymentEvent(eventId)` returns `dedup` on the second call, with no double-credit. The handler in `billing/webhook.mjs` already calls `recordPaymentEvent` first; this test pins that contract so a future refactor cannot regress it silently.

Also add: an unknown-`type` event (e.g. `payment_intent.succeeded`, which we don't act on) returns `{ canonicalUsername: null, action: 'noop' }` — already the behaviour of `applyStripeEvent`, but currently untested at the handler level.

### D5: CI structure

**Decision:** Per-tier services, declared close to the job that needs them.

- `backend-unit` job: no docker. Fixture-playback tests run in-process.
- `backend-integ` job: add `services.stripe-mock` (image `stripemock/stripe-mock:latest`, port 12111, healthcheck `wget --spider http://localhost:12111/v1/customers || exit 1`). The mock-oidc tests already run inside the existing `tricho-auth` Vitest, no extra service needed at this tier (mock-oidc starts as part of the test suite via `child_process.spawn` for unit; full container only spins for e2e).
- `e2e` job: extend the existing `docker compose --profile ci up -d --build` to include `stripe-mock`, `localstripe`, and the multi-tenant `mock-oidc`. Health checks on each. Add the existing `for i in $(seq 1 60); do curl -sf https://tricho.test/auth/health; done` retry loop to also probe `https://tricho.test/_stripe-mock/health` and `https://tricho.test/_localstripe/health` so the stack-up wait is honest.

**Why services + compose, not testcontainers:** the existing e2e CI flow uses `docker compose` against a single `compose.yml`. Introducing testcontainers for Stripe mocks would split the topology across two configuration languages. The backend-integration tier already uses testcontainers for CouchDB; we keep `stripe-mock` there too (a single `await new GenericContainer('stripemock/stripe-mock').withExposedPorts(12111).start()`) so the integration tier stays self-contained.

### D6: Backwards compatibility for `mock-oidc` paths

**Decision:** Keep the current top-level routes (`/.well-known/openid-configuration`, `/authorize`, `/token`, `/userinfo`, `/mock/identity`) as **aliases** to `/google/...`. Add `/google/.well-known/openid-configuration`, `/google/authorize`, etc. as the new canonical paths. Existing tests on the alias keep passing; the next change can flip `GOOGLE_ISSUER_URL` to `http://mock-oidc:8080/google` and remove the aliases.

**Why aliases, not a flag-day rename:** the aliases are 6 extra lines of routing. The flag-day rename touches `compose.yml` (Traefik path prefix), `tricho-auth` env, the e2e fixture in `tests/e2e/fixtures/mock-oidc.ts`, and everything downstream. Splitting that into a separate change keeps this PR's diff focused.

## Risks / Trade-offs

- **[`localstripe` not 100% Stripe-faithful]** — `localstripe` is community-maintained and lags real Stripe by months on niche endpoints. Mitigation: keep the e2e Stripe spec narrow (only Checkout happy path + a single subscription cancel-via-portal). Anything more nuanced (proration, plan upgrade, coupon) stays in the unit/integration tier with fixtures.
- **[`stripe-mock` OpenAPI drift]** — `stripe-mock` is regenerated from Stripe's OpenAPI. If we pin too tightly we miss new fields; if we float `:latest` we risk surprise breakage. Mitigation: pin to a specific image digest in `compose.yml`; bump it in a dedicated PR every quarter as part of the existing dependency-bump cadence.
- **[Apple `name` claim drift]** — Apple has changed the first-vs-returning rules silently in the past. Mitigation: the `mock-oidc` Apple tenant is the source of truth for our internal contract; the real-world drift is caught by manual smoke on iOS pre-release (already in scope per `docs/TESTING.md`'s "Out of scope offline" section).
- **[Boot-guard false positive]** — A homelab user running Tricho on `tricho.lan` with a real Apple integration would trip the substring match on `tricho`. Mitigation: the guard regex is `\btricho\.test\b` (word boundary, exact `.test` TLD), not a generic `tricho` substring, and the documented prod hostname pattern in `docs/ARCHITECTURE_CHANGES.md` is `tricho.app`, not `tricho.test`.
- **[CI service warmup adds wall-clock]** — +30 s on `backend-integ`, +45 s on `e2e`. Mitigation: services spin up in parallel via `docker compose up -d`, not sequentially. The health-check loop sleeps 2 s between probes; first-pass success expected on warm runners.
- **[Threat-model delta]** — see proposal §Impact. Net: one new way to misconfigure Apple's issuer in prod, mitigated by a boot-time guard. No new key material, no new wire-level surface, no change to JWT signature validation rules.

## Migration Plan

1. **Land Apple env-driven config first** (no test changes). This is a refactor that compiles against existing prod env. Verify the prod compose profile starts unchanged.
2. **Land mock-oidc multi-tenant + Apple tenant.** Existing Google e2e tests must stay green on the alias paths.
3. **Land Stripe `STRIPE_API_BASE` plumbing + boot guard.** Verify prod compose starts unchanged.
4. **Land backend-tier fixture playback** (declined/3DS/replay/unknown-event). All in-process, no infra change.
5. **Land `compose.yml` additions** for `stripe-mock` + `localstripe` under the `ci` profile only. Run `make smoke` and the e2e tier locally before merging.
6. **Land e2e specs** for Apple roundtrip + Stripe checkout. CI's `e2e` job becomes the long-pole; verify <20 min total.
7. **Land `docs/TESTING.md` updates** describing the three-layer Stripe stack and the "Out of scope offline" list.

**Rollback:** straight `git revert` on any of (1)–(7). Each step is independently safe: env var defaults make Apple/Stripe/Google behave identically when the new vars are unset, and the new compose services live only in the `ci` profile.

## Open Questions

1. **Do we pin `stripe-mock` to an image digest now, or float `:latest` and bump on breakage?** Lean toward digest pin; reconsider if quarterly bump cadence is too noisy.
2. **Should the Apple tenant in `mock-oidc` validate the ES256 client_secret JWT against a test public key, or skip entirely?** Currently leaning skip (mock cares about the *flow*, not the cryptographic boundary). If we skip, add a unit test in `providers-apple.test.mjs` that constructs an invalid client_secret JWT and asserts the *real* Apple endpoint would reject it — even though the mock doesn't.
3. **Does the multi-tenant `mock-oidc` need a separate Traefik path prefix per tenant (`/mock-oidc/google/*`, `/mock-oidc/apple/*`), or can both live behind `/mock-oidc/*` with the tenant on a query param?** Path prefix is more REST-y and easier to debug in browser devtools; lean that way.
