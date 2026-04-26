import { describe, it, expect, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  verifyWebhookSignature,
  applyStripeEvent,
  createCheckoutSession,
  InvalidSignatureError,
  parseStripeBase,
  _setStripeClient,
} from '../billing/stripe.mjs';
import { loadStripeFixture, StripeCardError } from './fixtures/stripe-stub.mjs';
import { fakeMeta } from './fixtures/meta.mjs';

const SECRET = 'whsec_test_1234';

function signEvent(payload, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return { rawBody: body, signatureHeader: `t=${t},v1=${sig}` };
}

describe('verifyWebhookSignature', () => {
  it('accepts a valid signature', () => {
    const { rawBody, signatureHeader } = signEvent({ id: 'evt_1', type: 'noop' });
    expect(() => verifyWebhookSignature({ rawBody, signatureHeader, secret: SECRET })).not.toThrow();
  });

  it('rejects a forged signature', () => {
    const { rawBody, signatureHeader } = signEvent({ id: 'evt_1' }, 'whsec_other');
    expect(() => verifyWebhookSignature({ rawBody, signatureHeader, secret: SECRET })).toThrow(InvalidSignatureError);
  });

  it('rejects a malformed header', () => {
    expect(() =>
      verifyWebhookSignature({ rawBody: '{}', signatureHeader: 'not-a-sig', secret: SECRET }),
    ).toThrow(InvalidSignatureError);
  });

  it('rejects a too-old timestamp (replay)', () => {
    const ancient = Math.floor(Date.now() / 1000) - 60 * 60;
    const { rawBody, signatureHeader } = signEvent({ id: 'evt_1' }, SECRET, ancient);
    expect(() => verifyWebhookSignature({ rawBody, signatureHeader, secret: SECRET })).toThrow(
      InvalidSignatureError,
    );
  });

  it('accepts within tolerance with custom now', () => {
    const t = 1_700_000_000;
    const { rawBody, signatureHeader } = signEvent({ id: 'evt_1' }, SECRET, t);
    expect(() =>
      verifyWebhookSignature({ rawBody, signatureHeader, secret: SECRET, now: t + 60 }),
    ).not.toThrow();
  });
});

describe('applyStripeEvent', () => {
  const env = {
    PLAN_PRO_MONTHLY_STRIPE_PRICE_ID: 'price_m',
    PLAN_PRO_YEARLY_STRIPE_PRICE_ID: 'price_y',
  };

  function setupWith(sub) {
    const { meta, state } = fakeMeta();
    const userId = 'user:g_abc';
    state.subs.set(userId, {
      _id: `subscription:${userId}`,
      type: 'subscription',
      userId,
      tier: 'free',
      plan: 'free',
      provider: null,
      status: 'active',
      entitlements: [],
      deviceLimit: 1,
      gracePeriodSeconds: 7 * 86400,
      paidUntil: null,
      ...sub,
    });
    return { meta, state, userId };
  }

  it('subscription.created upserts plan + provider', async () => {
    const { meta, state } = setupWith();
    const event = {
      id: 'evt_1',
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_1',
          status: 'active',
          metadata: { canonicalUsername: 'g_abc' },
          items: { data: [{ price: { id: 'price_m' } }] },
        },
      },
    };
    const r = await applyStripeEvent({ meta, env, event });
    expect(r.action).toBe('upsert');
    const sub = state.subs.get('user:g_abc');
    expect(sub.provider).toBe('stripe');
    expect(sub.plan).toBe('pro-monthly');
    expect(sub.stripeSubscriptionId).toBe('sub_123');
  });

  it('invoice.paid credits paidUntil and flips entitlements', async () => {
    const { meta, state } = setupWith();
    const event = {
      id: 'evt_invoice',
      type: 'invoice.paid',
      data: {
        object: {
          customer: 'cus_1',
          subscription: 'sub_1',
          subscription_details: { metadata: { canonicalUsername: 'g_abc' } },
          lines: { data: [{ price: { id: 'price_y' } }] },
        },
      },
    };
    const start = Date.now();
    const r = await applyStripeEvent({ meta, env, event });
    expect(r.action).toBe('credited');
    const sub = state.subs.get('user:g_abc');
    expect(sub.tier).toBe('paid');
    expect(sub.entitlements).toEqual(['sync', 'backup']);
    expect(sub.plan).toBe('pro-yearly');
    expect(sub.tierKey).toBe('pro');
    expect(sub.billingPeriod).toBe('year');
    expect(sub.deviceLimit).toBe(2);
    expect(sub.backupRetentionMonths).toBe(12);
    expect(sub.paidUntil).toBeGreaterThan(start + 364 * 86400 * 1000);
  });

  it('subscription.deleted flips status to canceled', async () => {
    const { meta, state } = setupWith({
      tier: 'paid',
      plan: 'pro-monthly',
      provider: 'stripe',
      entitlements: ['sync', 'backup'],
      paidUntil: Date.now() + 10 * 86400 * 1000,
      stripeSubscriptionId: 'sub_old',
    });
    const event = {
      id: 'evt_del',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_old',
          customer: 'cus_1',
          metadata: { canonicalUsername: 'g_abc' },
        },
      },
    };
    const r = await applyStripeEvent({ meta, env, event });
    expect(r.action).toBe('canceled');
    const sub = state.subs.get('user:g_abc');
    expect(sub.status).toBe('canceled');
    // paidUntil unchanged
    expect(sub.paidUntil).toBeGreaterThan(Date.now());
    // entitlements unchanged (service runs to paidUntil)
    expect(sub.entitlements).toContain('sync');
  });

  it('payment_failed flips status to past_due', async () => {
    const { meta, state } = setupWith({
      tier: 'paid',
      provider: 'stripe',
      entitlements: ['sync', 'backup'],
      paidUntil: Date.now() + 5 * 86400 * 1000,
      stripeCustomerId: 'cus_1',
    });
    // applyStripeEvent for invoice.payment_failed needs to resolve the user
    // from customer ID. Stub the Stripe SDK client to return the customer.
    _setStripeClient({
      customers: {
        async retrieve() {
          return { id: 'cus_1', metadata: { canonicalUsername: 'g_abc' } };
        },
      },
    });
    try {
      const event = {
        id: 'evt_pf',
        type: 'invoice.payment_failed',
        data: { object: { customer: 'cus_1' } },
      };
      const r = await applyStripeEvent({ meta, env, event });
      expect(r.action).toBe('past_due');
      expect(state.subs.get('user:g_abc').status).toBe('past_due');
    } finally {
      _setStripeClient(null);
    }
  });

  it('unknown event type is no-op', async () => {
    const { meta } = setupWith();
    const r = await applyStripeEvent({
      meta,
      env,
      event: { id: 'evt_x', type: 'random.event', data: { object: {} } },
    });
    expect(r.action).toBe('noop');
  });
});

describe('createCheckoutSession (fixture playback)', () => {
  const env = {
    PLAN_PRO_MONTHLY_STRIPE_PRICE_ID: 'price_m',
    STRIPE_SECRET_KEY: 'sk_test_unused',
  };
  const user = { canonicalUsername: 'g_test', email: 'u@t' };

  afterEach(() => _setStripeClient(null));

  it('declined card → StripeCardError with decline_code', async () => {
    const { client } = loadStripeFixture('card-declined');
    _setStripeClient(client);
    await expect(
      createCheckoutSession({
        env,
        user,
        plan: 'pro-monthly',
        successUrl: 'http://x/s',
        cancelUrl: 'http://x/c',
      }),
    ).rejects.toMatchObject({
      name: 'StripeCardError',
      code: 'card_declined',
      decline_code: 'card_declined',
    });
  });

  it('insufficient funds surfaces decline_code:insufficient_funds', async () => {
    const { client } = loadStripeFixture('card-declined-insufficient-funds');
    _setStripeClient(client);
    await expect(
      createCheckoutSession({
        env,
        user,
        plan: 'pro-monthly',
        successUrl: 'http://x/s',
        cancelUrl: 'http://x/c',
      }),
    ).rejects.toMatchObject({
      name: 'StripeCardError',
      decline_code: 'insufficient_funds',
    });
  });

  it('3DS-required Checkout returns the redirect/client_secret payload', async () => {
    const { client } = loadStripeFixture('requires-action-3ds');
    _setStripeClient(client);
    const r = await createCheckoutSession({
      env,
      user,
      plan: 'pro-monthly',
      successUrl: 'http://x/s',
      cancelUrl: 'http://x/c',
    });
    expect(r.checkoutUrl).toBe('https://checkout.stripe.com/c/cs_3ds_1');
    expect(r.sessionId).toBe('cs_3ds_1');
  });
});

describe('idempotency replay (fixture playback)', () => {
  afterEach(() => _setStripeClient(null));

  it('returns the cached body for a repeated idempotency-key', async () => {
    const { client } = loadStripeFixture('idempotency-replay');
    _setStripeClient(client);

    const first = await client.customers.create(
      { email: 'u@t', metadata: { canonicalUsername: 'g_test' } },
      { idempotencyKey: 'K-customers-create' },
    );
    expect(first.id).toBe('cus_replay_1');
    expect(first._replayed).toBeUndefined();

    const second = await client.customers.create(
      { email: 'u@t', metadata: { canonicalUsername: 'g_test' } },
      { idempotencyKey: 'K-customers-create' },
    );
    expect(second.id).toBe('cus_replay_1');
    expect(second._replayed).toBe(true);
  });
});

describe('parseStripeBase', () => {
  it('returns empty object when the env value is unset', () => {
    expect(parseStripeBase(undefined)).toEqual({});
    expect(parseStripeBase('')).toEqual({});
  });

  it('parses an http URL with explicit port', () => {
    expect(parseStripeBase('http://stripe-mock:12111')).toEqual({
      host: 'stripe-mock',
      port: 12111,
      protocol: 'http',
    });
  });

  it('parses an https URL and defaults port to 443', () => {
    expect(parseStripeBase('https://api.example.com')).toEqual({
      host: 'api.example.com',
      port: 443,
      protocol: 'https',
    });
  });

  it('parses an http URL and defaults port to 80', () => {
    expect(parseStripeBase('http://stripe-mock')).toEqual({
      host: 'stripe-mock',
      port: 80,
      protocol: 'http',
    });
  });
});
