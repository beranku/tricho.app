import { describe, it, expect, beforeEach } from 'vitest';
import { fakeMeta } from './fixtures/meta.mjs';

const USER_ID = 'user:g_abc';

describe('Meta — subscription extensions', () => {
  let meta;
  beforeEach(async () => {
    ({ meta } = fakeMeta());
    await meta.ensureSubscription(USER_ID, {});
  });

  it('ensureSubscription seeds new free schema', async () => {
    const sub = await meta.getSubscription(USER_ID);
    expect(sub.tier).toBe('free');
    expect(sub.plan).toBe('free');
    expect(sub.provider).toBeNull();
    expect(sub.status).toBe('active');
    expect(sub.entitlements).toEqual([]);
    expect(sub.deviceLimit).toBe(1);
    expect(sub.gracePeriodSeconds).toBe(7 * 86400);
    expect(sub.freeDeviceGrandfathered).toBe(false);
    expect(sub.paidUntil).toBeNull();
  });

  it('updateSubscription merges fields and bumps updatedAt', async () => {
    const before = await meta.getSubscription(USER_ID);
    await new Promise((r) => setTimeout(r, 5));
    const after = await meta.updateSubscription(USER_ID, { freeDeviceGrandfathered: true });
    expect(after.freeDeviceGrandfathered).toBe(true);
    expect(after.tier).toBe('free');
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
  });

  it('creditPaidUntil from null paidUntil starts at now + period', async () => {
    const start = Date.now();
    const updated = await meta.creditPaidUntil({
      userId: USER_ID,
      plan: 'sync-monthly',
      periodSeconds: 30 * 86400,
      provider: 'stripe',
    });
    expect(updated.tier).toBe('paid');
    expect(updated.plan).toBe('sync-monthly');
    expect(updated.provider).toBe('stripe');
    expect(updated.entitlements).toEqual(['sync', 'backup']);
    expect(updated.paidUntil).toBeGreaterThanOrEqual(start + 30 * 86400 * 1000 - 50);
  });

  it('creditPaidUntil from future paidUntil extends from existing', async () => {
    const future = Date.now() + 5 * 86400 * 1000;
    await meta.updateSubscription(USER_ID, { paidUntil: future });
    const updated = await meta.creditPaidUntil({
      userId: USER_ID,
      plan: 'sync-monthly',
      periodSeconds: 30 * 86400,
      provider: 'bank-transfer',
    });
    expect(updated.paidUntil).toBe(future + 30 * 86400 * 1000);
  });

  it('creditPaidUntil from past paidUntil starts from now (no back-pay)', async () => {
    const past = Date.now() - 60 * 86400 * 1000;
    await meta.updateSubscription(USER_ID, { paidUntil: past });
    const start = Date.now();
    const updated = await meta.creditPaidUntil({
      userId: USER_ID,
      plan: 'sync-monthly',
      periodSeconds: 30 * 86400,
      provider: 'bank-transfer',
    });
    expect(updated.paidUntil).toBeGreaterThanOrEqual(start + 30 * 86400 * 1000 - 50);
  });

  it('creditPaidUntil never shortens paidUntil', async () => {
    const farFuture = Date.now() + 365 * 86400 * 1000;
    await meta.updateSubscription(USER_ID, { paidUntil: farFuture });
    const updated = await meta.creditPaidUntil({
      userId: USER_ID,
      plan: 'sync-monthly',
      periodSeconds: 30 * 86400,
      provider: 'stripe',
    });
    expect(updated.paidUntil).toBeGreaterThanOrEqual(farFuture);
  });
});

describe('Meta — payment-event dedup', () => {
  it('first record returns deduped:false; second returns deduped:true', async () => {
    const { meta } = fakeMeta();
    const first = await meta.recordPaymentEvent({ provider: 'stripe', eventId: 'evt_1' });
    expect(first.deduped).toBe(false);
    const second = await meta.recordPaymentEvent({ provider: 'stripe', eventId: 'evt_1' });
    expect(second.deduped).toBe(true);
  });

  it('different events do not collide', async () => {
    const { meta } = fakeMeta();
    const a = await meta.recordPaymentEvent({ provider: 'stripe', eventId: 'evt_a' });
    const b = await meta.recordPaymentEvent({ provider: 'stripe', eventId: 'evt_b' });
    expect(a.deduped).toBe(false);
    expect(b.deduped).toBe(false);
  });

  it('different providers, same eventId are independent', async () => {
    const { meta } = fakeMeta();
    const a = await meta.recordPaymentEvent({ provider: 'stripe', eventId: 'shared' });
    const b = await meta.recordPaymentEvent({ provider: 'bank-transfer', eventId: 'shared' });
    expect(a.deduped).toBe(false);
    expect(b.deduped).toBe(false);
  });
});

describe('Meta — payment intents', () => {
  it('round-trip via VS lookup', async () => {
    const { meta } = fakeMeta();
    await meta.createPaymentIntent({
      intentId: 'int_1',
      userId: USER_ID,
      vs: '1234567890',
      plan: 'sync-monthly',
      amountMinor: 29900,
      currency: 'CZK',
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + 14 * 86400 * 1000,
    });
    const found = await meta.findPaymentIntentByVS('1234567890');
    expect(found?.intentId).toBe('int_1');
  });

  it('sweepExpiredPaymentIntents marks past-expires as expired', async () => {
    const { meta } = fakeMeta();
    await meta.createPaymentIntent({
      intentId: 'int_old',
      userId: USER_ID,
      vs: '1',
      plan: 'sync-monthly',
      amountMinor: 0,
      currency: 'CZK',
      status: 'pending',
      createdAt: Date.now() - 20 * 86400 * 1000,
      expiresAt: Date.now() - 6 * 86400 * 1000,
    });
    const { updated } = await meta.sweepExpiredPaymentIntents();
    expect(updated).toBe(1);
    const after = await meta.getPaymentIntent('int_old');
    expect(after.status).toBe('expired');
  });
});

describe('Meta — backup manifests', () => {
  it('list newest-first', async () => {
    const { meta } = fakeMeta();
    await meta.putBackupManifest({
      canonicalUsername: 'g_abc',
      snapshotId: 's1',
      sizeBytes: 100,
      deviceId: 'd1',
      vaultId: 'v',
      version: '1',
      createdAt: 1000,
    });
    await meta.putBackupManifest({
      canonicalUsername: 'g_abc',
      snapshotId: 's2',
      sizeBytes: 200,
      deviceId: 'd1',
      vaultId: 'v',
      version: '1',
      createdAt: 2000,
    });
    const list = await meta.listBackupManifests('g_abc');
    expect(list[0].snapshotId).toBe('s2');
    expect(list[1].snapshotId).toBe('s1');
  });

  it('cross-user isolation', async () => {
    const { meta } = fakeMeta();
    await meta.putBackupManifest({
      canonicalUsername: 'g_abc',
      snapshotId: 's1',
      sizeBytes: 1,
      deviceId: 'd',
      vaultId: 'v',
      version: '1',
      createdAt: 1,
    });
    const list = await meta.listBackupManifests('g_xyz');
    expect(list).toEqual([]);
  });

  it('delete returns true on hit, false on miss', async () => {
    const { meta } = fakeMeta();
    await meta.putBackupManifest({
      canonicalUsername: 'g_abc',
      snapshotId: 's1',
      sizeBytes: 1,
      deviceId: 'd',
      vaultId: 'v',
      version: '1',
      createdAt: 1,
    });
    expect(await meta.deleteBackupManifest('g_abc', 's1')).toBe(true);
    expect(await meta.deleteBackupManifest('g_abc', 's1')).toBe(false);
  });
});
