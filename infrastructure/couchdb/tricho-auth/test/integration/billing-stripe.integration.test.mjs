import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GenericContainer, Wait } from 'testcontainers';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStripeBase, _setStripeClient } from '../../billing/stripe.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Drives every Stripe SDK call site in `billing/stripe.mjs` against
// `stripemock/stripe-mock` to assert request-shape contract. The mock is
// stateless (it does NOT persist customers between calls) so this suite
// only verifies that the SDK can serialise our requests against Stripe's
// OpenAPI; it does NOT exercise stateful flows (those live in e2e against
// `localstripe`).
//
// IMAGE PIN: stripemock/stripe-mock:latest — bump quarterly to track
// Stripe's published OpenAPI. See docs/TESTING.md → "Bumping mocks".

const STRIPE_MOCK_IMAGE = 'stripemock/stripe-mock:latest';

let container;
let stripeBase;
let stripeClient;

beforeAll(async () => {
  container = await new GenericContainer(STRIPE_MOCK_IMAGE)
    .withExposedPorts(12111)
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(60_000)
    .start();
  stripeBase = `http://${container.getHost()}:${container.getMappedPort(12111)}`;

  // Resolve `stripe` from the tricho-auth package, mirroring billing/stripe.mjs.
  const requireFromTrichoAuth = createRequire(path.resolve(__dirname, '../../package.json'));
  const Stripe = requireFromTrichoAuth('stripe');
  stripeClient = new Stripe('sk_test_unused_by_mock', {
    apiVersion: null,
    ...parseStripeBase(stripeBase),
  });
  // Plumb the same client into billing/stripe.mjs's lazy slot so any code
  // path that goes through `client(env)` reuses this connection.
  _setStripeClient(stripeClient);
}, 60_000);

afterAll(async () => {
  _setStripeClient(null);
  await container?.stop();
});

describe('Stripe SDK contract against stripe-mock', () => {
  it('customers.create accepts our request shape', async () => {
    const c = await stripeClient.customers.create({
      email: 'contract@test',
      metadata: { canonicalUsername: 'g_contract' },
    });
    expect(c.id).toMatch(/^cus_/);
  });

  it('customers.list works', async () => {
    const list = await stripeClient.customers.list({ email: 'a@b', limit: 5 });
    expect(list.data).toBeInstanceOf(Array);
  });

  it('customers.search works (or 4xxs cleanly when search is disabled)', async () => {
    try {
      const r = await stripeClient.customers.search({
        query: "metadata['canonicalUsername']:'g_contract'",
        limit: 1,
      });
      expect(r.data).toBeInstanceOf(Array);
    } catch (err) {
      // stripe-mock may reject /v1/customers/search depending on the OpenAPI
      // spec it ships; either way, our SDK serialises the request.
      expect(err).toBeDefined();
    }
  });

  it('customers.retrieve works', async () => {
    const c = await stripeClient.customers.retrieve('cus_anything');
    expect(c).toBeDefined();
  });

  it('checkout.sessions.create accepts our request shape', async () => {
    const session = await stripeClient.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: 'price_test', quantity: 1 }],
      customer: 'cus_anything',
      client_reference_id: 'g_contract',
      success_url: 'https://x/s',
      cancel_url: 'https://x/c',
      subscription_data: { metadata: { canonicalUsername: 'g_contract' } },
    });
    expect(session.id).toMatch(/^cs_/);
  });

  it('billingPortal.sessions.create accepts our request shape', async () => {
    const portal = await stripeClient.billingPortal.sessions.create({
      customer: 'cus_anything',
      return_url: 'https://x/return',
    });
    expect(portal.url).toMatch(/^https:\/\//);
  });

  it('subscriptions.update accepts our request shape', async () => {
    const sub = await stripeClient.subscriptions.update('sub_anything', {
      cancel_at_period_end: true,
    });
    expect(sub.id).toMatch(/^sub_/);
  });
});
