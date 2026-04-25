import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { handleStripeWebhook } from '../billing/webhook.mjs';
import { Entitlements } from '../billing/entitlements.mjs';
import { fakeMeta } from './fixtures/meta.mjs';

const SECRET = 'whsec_test';
const ENV = {
  STRIPE_WEBHOOK_SECRET: SECRET,
  PLAN_SYNC_MONTHLY_STRIPE_PRICE_ID: 'price_m',
  PLAN_SYNC_YEARLY_STRIPE_PRICE_ID: 'price_y',
};

function signed(payload, secret = SECRET) {
  const body = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return { rawBody: body, signatureHeader: `t=${t},v1=${sig}` };
}

function withSub(state, patch) {
  state.subs.set('user:g_abc', {
    _id: 'subscription:user:g_abc',
    type: 'subscription',
    userId: 'user:g_abc',
    tier: 'free',
    plan: 'free',
    provider: null,
    status: 'active',
    entitlements: [],
    deviceLimit: 1,
    gracePeriodSeconds: 7 * 86400,
    paidUntil: null,
    ...patch,
  });
}

describe('handleStripeWebhook', () => {
  it('rejects forged signature', async () => {
    const { meta } = fakeMeta();
    const ent = new Entitlements({ meta });
    const r = await handleStripeWebhook({
      meta,
      entitlements: ent,
      env: ENV,
      rawBody: '{"id":"evt"}',
      signatureHeader: 't=1,v1=deadbeef',
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_signature');
  });

  it('processes invoice.paid and invalidates entitlement cache', async () => {
    const { meta, state } = fakeMeta();
    withSub(state, {});
    const ent = new Entitlements({ meta });
    // prime the cache
    await ent.check('g_abc', 'sync');
    expect(ent.cache.has('g_abc')).toBe(true);

    const { rawBody, signatureHeader } = signed({
      id: 'evt_paid_1',
      type: 'invoice.paid',
      data: {
        object: {
          customer: 'cus_1',
          subscription: 'sub_1',
          subscription_details: { metadata: { canonicalUsername: 'g_abc' } },
          lines: { data: [{ price: { id: 'price_m' } }] },
        },
      },
    });
    const r = await handleStripeWebhook({ meta, entitlements: ent, env: ENV, rawBody, signatureHeader });
    expect(r.status).toBe(200);
    expect(r.body.action).toBe('credited');
    expect(ent.cache.has('g_abc')).toBe(false); // invalidated
    const sub = state.subs.get('user:g_abc');
    expect(sub.tier).toBe('paid');
    expect(sub.paidUntil).toBeGreaterThan(Date.now());
  });

  it('idempotent on repeat delivery', async () => {
    const { meta, state } = fakeMeta();
    withSub(state, {});
    const ent = new Entitlements({ meta });
    const event = {
      id: 'evt_dup',
      type: 'invoice.paid',
      data: {
        object: {
          customer: 'cus_1',
          subscription: 'sub_dup',
          subscription_details: { metadata: { canonicalUsername: 'g_abc' } },
          lines: { data: [{ price: { id: 'price_m' } }] },
        },
      },
    };
    const first = await handleStripeWebhook({ meta, entitlements: ent, env: ENV, ...signed(event) });
    expect(first.body.action).toBe('credited');
    const paidAfterFirst = state.subs.get('user:g_abc').paidUntil;
    const second = await handleStripeWebhook({ meta, entitlements: ent, env: ENV, ...signed(event) });
    expect(second.body.deduped).toBe(true);
    expect(state.subs.get('user:g_abc').paidUntil).toBe(paidAfterFirst);
  });

  it('rejects malformed json', async () => {
    const { meta } = fakeMeta();
    const ent = new Entitlements({ meta });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', SECRET).update(`${t}.not-json`).digest('hex');
    const r = await handleStripeWebhook({
      meta,
      entitlements: ent,
      env: ENV,
      rawBody: 'not-json',
      signatureHeader: `t=${t},v1=${sig}`,
    });
    expect(r.status).toBe(400);
  });
});
