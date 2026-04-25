import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateUniqueVS,
  composeSpaydPayload,
  createIntent,
  confirmIntent,
  cancelIntent,
} from '../billing/bank-transfer.mjs';
import { fakeMeta } from './fixtures/meta.mjs';

const ENV = {
  PLAN_PRO_MONTHLY_AMOUNT_MINOR: '29900',
  PLAN_PRO_YEARLY_AMOUNT_MINOR: '299000',
  PLAN_MAX_MONTHLY_AMOUNT_MINOR: '49900',
  PLAN_MAX_YEARLY_AMOUNT_MINOR: '499000',
  BILLING_CURRENCY: 'CZK',
  BILLING_BANK_IBAN: 'CZ6500000000001234567890',
  BILLING_BANK_ACCOUNT: '1234567890/0100',
};

const USER_ID = 'user:g_abc';

function setup() {
  const { meta, state } = fakeMeta();
  state.subs.set(USER_ID, {
    _id: 'subscription:user:g_abc',
    type: 'subscription',
    userId: USER_ID,
    tier: 'free',
    plan: 'free',
    provider: null,
    status: 'active',
    entitlements: [],
    deviceLimit: 1,
    gracePeriodSeconds: 7 * 86400,
    paidUntil: null,
  });
  return { meta, state };
}

describe('generateUniqueVS', () => {
  it('returns a 10-digit numeric string', async () => {
    const { meta } = setup();
    const vs = await generateUniqueVS(meta);
    expect(vs).toMatch(/^\d{10}$/);
  });

  it('avoids collisions with existing intents', async () => {
    const { meta } = setup();
    // pre-populate with intents holding common digits
    for (let i = 0; i < 5; i++) {
      await meta.createPaymentIntent({
        intentId: `int_${i}`,
        userId: USER_ID,
        vs: `00000000${i.toString().padStart(2, '0')}`,
        plan: 'pro-monthly',
        amountMinor: 0,
        currency: 'CZK',
        status: 'pending',
        createdAt: 0,
        expiresAt: Date.now() + 1000,
      });
    }
    const vs = await generateUniqueVS(meta);
    const existing = await meta.findPaymentIntentByVS(vs);
    expect(existing).toBeNull();
  });
});

describe('composeSpaydPayload', () => {
  it('emits SPAYD with VS and amount in major units', () => {
    const s = composeSpaydPayload({
      iban: 'CZ65...',
      amountMinor: 29900,
      currency: 'CZK',
      vs: '1234567890',
      plan: 'pro-monthly',
    });
    expect(s.startsWith('SPD*1.0*')).toBe(true);
    expect(s).toContain('ACC:CZ65...');
    expect(s).toContain('AM:299.00');
    expect(s).toContain('CC:CZK');
    expect(s).toContain('X-VS:1234567890');
  });
});

describe('createIntent', () => {
  it('persists a pending intent with 14-day expiry', async () => {
    const { meta } = setup();
    const start = Date.now();
    const intent = await createIntent({ meta, env: ENV, userId: USER_ID, plan: 'pro-monthly' });
    expect(intent.status).toBe('pending');
    expect(intent.amountMinor).toBe(29900);
    expect(intent.currency).toBe('CZK');
    expect(intent.expiresAt).toBeGreaterThanOrEqual(start + 14 * 86400 * 1000 - 50);
    expect(intent.qrCodePayload).toContain(`X-VS:${intent.vs}`);
    const stored = await meta.getPaymentIntent(intent.intentId);
    expect(stored.status).toBe('pending');
  });

  it('fails when bank IBAN is not configured', async () => {
    const { meta } = setup();
    await expect(
      createIntent({
        meta,
        env: { ...ENV, BILLING_BANK_IBAN: '' },
        userId: USER_ID,
        plan: 'pro-monthly',
      }),
    ).rejects.toThrow();
  });
});

describe('confirmIntent', () => {
  let meta, state;
  beforeEach(() => ({ meta, state } = setup()));

  it('credits paidUntil and marks intent paid', async () => {
    const intent = await createIntent({ meta, env: ENV, userId: USER_ID, plan: 'pro-monthly' });
    const result = await confirmIntent({ meta, env: ENV, intentId: intent.intentId });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    const sub = state.subs.get(USER_ID);
    expect(sub.tier).toBe('paid');
    expect(sub.provider).toBe('bank-transfer');
    expect(sub.entitlements).toContain('sync');
    const after = await meta.getPaymentIntent(intent.intentId);
    expect(after.status).toBe('paid');
    expect(after.paidAt).toBeGreaterThan(0);
  });

  it('idempotent on replay (no double credit)', async () => {
    const intent = await createIntent({ meta, env: ENV, userId: USER_ID, plan: 'pro-monthly' });
    await confirmIntent({ meta, env: ENV, intentId: intent.intentId });
    const after1 = state.subs.get(USER_ID).paidUntil;
    const replay = await confirmIntent({ meta, env: ENV, intentId: intent.intentId });
    expect(replay.body.deduped).toBe(true);
    expect(state.subs.get(USER_ID).paidUntil).toBe(after1);
  });

  it('rejects expired intent', async () => {
    const intent = await createIntent({ meta, env: ENV, userId: USER_ID, plan: 'pro-monthly' });
    // shift expiry into the past
    await meta.updatePaymentIntent(intent.intentId, { expiresAt: Date.now() - 1000 });
    const result = await confirmIntent({ meta, env: ENV, intentId: intent.intentId });
    expect(result.status).toBe(410);
    expect(result.body.error).toBe('intent_expired');
    expect(state.subs.get(USER_ID).tier).toBe('free');
  });

  it('rejects canceled intent', async () => {
    const intent = await createIntent({ meta, env: ENV, userId: USER_ID, plan: 'pro-monthly' });
    await meta.updatePaymentIntent(intent.intentId, { status: 'canceled' });
    const result = await confirmIntent({ meta, env: ENV, intentId: intent.intentId });
    expect(result.status).toBe(410);
    expect(result.body.error).toBe('intent_canceled');
  });

  it('returns 404 for unknown intent', async () => {
    const result = await confirmIntent({ meta, env: ENV, intentId: 'int_missing' });
    expect(result.status).toBe(404);
  });
});

describe('cancelIntent', () => {
  it('owner can cancel a pending intent', async () => {
    const { meta } = setup();
    const intent = await createIntent({ meta, env: ENV, userId: USER_ID, plan: 'pro-monthly' });
    const result = await cancelIntent({ meta, intentId: intent.intentId, userId: USER_ID });
    expect(result.status).toBe(200);
    expect(result.body.intent.status).toBe('canceled');
  });

  it('non-owner blocked', async () => {
    const { meta } = setup();
    const intent = await createIntent({ meta, env: ENV, userId: USER_ID, plan: 'pro-monthly' });
    const result = await cancelIntent({ meta, intentId: intent.intentId, userId: 'user:someone-else' });
    expect(result.status).toBe(403);
  });

  it('cannot cancel a paid intent', async () => {
    const { meta } = setup();
    const intent = await createIntent({ meta, env: ENV, userId: USER_ID, plan: 'pro-monthly' });
    await confirmIntent({ meta, env: ENV, intentId: intent.intentId });
    const result = await cancelIntent({ meta, intentId: intent.intentId, userId: USER_ID });
    expect(result.status).toBe(409);
  });
});
