import { describe, it, expect } from 'vitest';
import { migrateSubscriptionDoc, isMigrationNeeded } from '../scripts/migrate-subscriptions.mjs';

describe('migrateSubscriptionDoc', () => {
  it('backfills new fields on a pre-change free user with one device', () => {
    const before = {
      _id: 'subscription:user:g_abc',
      type: 'subscription',
      userId: 'user:g_abc',
      tier: 'free',
      deviceLimit: 2,
      storageLimitMB: 500,
      paidUntil: null,
      updatedAt: 1000,
    };
    const devicesByUser = new Map([['user:g_abc', [{ revoked: false, deviceId: 'd1' }]]]);
    const after = migrateSubscriptionDoc(before, devicesByUser);
    expect(after.entitlements).toEqual([]);
    expect(after.plan).toBe('free');
    expect(after.provider).toBeNull();
    expect(after.status).toBe('active');
    expect(after.freeDeviceGrandfathered).toBe(false);
    expect(after.gracePeriodSeconds).toBe(7 * 86400);
  });

  it('grandfathers a free user with two active devices', () => {
    const before = {
      _id: 'subscription:user:g_abc',
      type: 'subscription',
      userId: 'user:g_abc',
      tier: 'free',
      deviceLimit: 2,
      paidUntil: null,
    };
    const devicesByUser = new Map([
      [
        'user:g_abc',
        [
          { revoked: false, deviceId: 'd1' },
          { revoked: false, deviceId: 'd2' },
        ],
      ],
    ]);
    const after = migrateSubscriptionDoc(before, devicesByUser);
    expect(after.freeDeviceGrandfathered).toBe(true);
  });

  it('paid user gets sync + backup entitlements', () => {
    const before = {
      _id: 'subscription:user:g_abc',
      type: 'subscription',
      userId: 'user:g_abc',
      tier: 'paid',
      deviceLimit: 5,
      paidUntil: Date.now() + 30 * 86400 * 1000,
    };
    const after = migrateSubscriptionDoc(before, new Map());
    expect(after.entitlements).toEqual(['sync', 'backup']);
    expect(after.tier).toBe('paid');
    expect(after.plan).toBe('pro-monthly');
    expect(after.tierKey).toBe('pro');
    expect(after.billingPeriod).toBe('month');
    expect(after.deviceLimit).toBe(2);
    expect(after.backupRetentionMonths).toBe(12);
    expect(after.provider).toBe('bank-transfer'); // no stripeCustomerId → bank
  });

  it('paid user with stripeCustomerId is provider=stripe', () => {
    const before = {
      _id: 'subscription:user:g_abc',
      type: 'subscription',
      userId: 'user:g_abc',
      tier: 'paid',
      paidUntil: Date.now() + 30 * 86400 * 1000,
      stripeCustomerId: 'cus_123',
    };
    const after = migrateSubscriptionDoc(before, new Map());
    expect(after.provider).toBe('stripe');
  });

  it('idempotent — running twice yields the same shape', () => {
    const before = {
      _id: 'subscription:user:g_abc',
      type: 'subscription',
      userId: 'user:g_abc',
      tier: 'free',
      deviceLimit: 2,
      paidUntil: null,
    };
    const devicesByUser = new Map([['user:g_abc', []]]);
    const once = migrateSubscriptionDoc(before, devicesByUser);
    const twice = migrateSubscriptionDoc(once, devicesByUser);
    expect(isMigrationNeeded(once, twice)).toBe(false);
  });

  it('detects when no change needed', () => {
    const before = {
      tier: 'free',
      plan: 'free',
      tierKey: 'free',
      billingPeriod: null,
      provider: null,
      status: 'active',
      entitlements: [],
      deviceLimit: 1,
      backupRetentionMonths: 0,
      gracePeriodSeconds: 7 * 86400,
      freeDeviceGrandfathered: false,
      storageLimitMB: 500,
      paidUntil: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      createdAt: 1,
    };
    const after = migrateSubscriptionDoc(before, new Map());
    expect(isMigrationNeeded(before, after)).toBe(false);
  });

  it('migrates legacy sync-yearly to pro-yearly', () => {
    const before = {
      _id: 'subscription:user:g_abc',
      type: 'subscription',
      userId: 'user:g_abc',
      tier: 'paid',
      plan: 'sync-yearly',
      paidUntil: Date.now() + 100 * 86400 * 1000,
    };
    const after = migrateSubscriptionDoc(before, new Map());
    expect(after.plan).toBe('pro-yearly');
    expect(after.tierKey).toBe('pro');
    expect(after.billingPeriod).toBe('year');
    expect(after.backupRetentionMonths).toBe(12);
  });
});
