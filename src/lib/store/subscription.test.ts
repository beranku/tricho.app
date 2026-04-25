import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSubscription, refreshSubscription, subscriptionStore, setSubscriptionForTests } from './subscription';
import type { Subscription } from '../../auth/subscription';

const FREE_SUB: Subscription = {
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
  gracePeriodEndsAt: null,
  freeDeviceGrandfathered: false,
  storageLimitMB: 500,
  paidUntil: null,
};

describe('subscription store', () => {
  beforeEach(() => {
    setSubscriptionForTests(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loadSubscription with null jwt clears the store', async () => {
    setSubscriptionForTests(FREE_SUB);
    const r = await loadSubscription(null);
    expect(r).toBeNull();
    expect(subscriptionStore.get()).toBeNull();
  });

  it('loadSubscription populates store from server', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ subscription: FREE_SUB }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const r = await loadSubscription('jwt-x');
    expect(r?.tier).toBe('free');
    expect(subscriptionStore.get()?.tier).toBe('free');
  });

  it('refreshSubscription bypasses inflight cache', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount += 1;
      return new Response(JSON.stringify({ subscription: FREE_SUB }), { status: 200 });
    });
    await loadSubscription('jwt-x');
    await refreshSubscription('jwt-x');
    expect(callCount).toBe(2);
  });
});
