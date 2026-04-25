import { describe, it, expect } from 'vitest';
import {
  loadPlanCatalog,
  publicPlanCatalog,
  getPlan,
  isPaidPlan,
  mapStripePriceToPlanId,
  tierOf,
  billingPeriodOf,
  deviceLimitOf,
  backupRetentionMonthsOf,
  PLAN_IDS,
  PAID_PLAN_IDS,
} from '../billing/plans.mjs';

describe('plan catalog', () => {
  it('exposes exactly free + pro x{monthly,yearly} + max x{monthly,yearly}', () => {
    expect(PLAN_IDS).toEqual(['free', 'pro-monthly', 'pro-yearly', 'max-monthly', 'max-yearly']);
    expect(PAID_PLAN_IDS).toEqual(['pro-monthly', 'pro-yearly', 'max-monthly', 'max-yearly']);
    const cat = loadPlanCatalog({});
    expect(Object.keys(cat).sort()).toEqual([...PLAN_IDS].sort());
  });

  it('free plan has no period and zero amount', () => {
    const free = getPlan('free', {});
    expect(free.periodSeconds).toBeNull();
    expect(free.amountMinor).toBe(0);
    expect(free.entitlements).toEqual([]);
    expect(free.deviceLimit).toBe(1);
    expect(free.backupRetentionMonths).toBe(0);
  });

  it('paid monthly plans are 30 days, yearly plans are 365 days', () => {
    expect(getPlan('pro-monthly', {}).periodSeconds).toBe(30 * 86400);
    expect(getPlan('pro-yearly', {}).periodSeconds).toBe(365 * 86400);
    expect(getPlan('max-monthly', {}).periodSeconds).toBe(30 * 86400);
    expect(getPlan('max-yearly', {}).periodSeconds).toBe(365 * 86400);
  });

  it('all paid plans grant sync + backup', () => {
    for (const id of PAID_PLAN_IDS) {
      const p = getPlan(id, {});
      expect(p.entitlements).toContain('sync');
      expect(p.entitlements).toContain('backup');
    }
  });

  it('pro = 2 devices + 12 month retention', () => {
    expect(getPlan('pro-monthly', {}).deviceLimit).toBe(2);
    expect(getPlan('pro-yearly', {}).deviceLimit).toBe(2);
    expect(getPlan('pro-monthly', {}).backupRetentionMonths).toBe(12);
    expect(getPlan('pro-yearly', {}).backupRetentionMonths).toBe(12);
  });

  it('max = 5 devices + 60 month retention', () => {
    expect(getPlan('max-monthly', {}).deviceLimit).toBe(5);
    expect(getPlan('max-yearly', {}).deviceLimit).toBe(5);
    expect(getPlan('max-monthly', {}).backupRetentionMonths).toBe(60);
    expect(getPlan('max-yearly', {}).backupRetentionMonths).toBe(60);
  });

  it('reflects operator-configured prices', () => {
    const cat = loadPlanCatalog({
      PLAN_PRO_MONTHLY_AMOUNT_MINOR: '12345',
      PLAN_PRO_YEARLY_AMOUNT_MINOR: '99999',
      PLAN_MAX_MONTHLY_AMOUNT_MINOR: '54321',
      PLAN_MAX_YEARLY_AMOUNT_MINOR: '345678',
      BILLING_CURRENCY: 'EUR',
    });
    expect(cat['pro-monthly'].amountMinor).toBe(12345);
    expect(cat['pro-monthly'].currency).toBe('EUR');
    expect(cat['pro-yearly'].amountMinor).toBe(99999);
    expect(cat['max-monthly'].amountMinor).toBe(54321);
    expect(cat['max-yearly'].amountMinor).toBe(345678);
  });

  it('public catalog omits internal stripe price IDs but includes shape fields', () => {
    const pub = publicPlanCatalog({
      PLAN_PRO_MONTHLY_STRIPE_PRICE_ID: 'price_pm',
    });
    const monthly = pub.find((p) => p.id === 'pro-monthly');
    expect(monthly).toBeDefined();
    expect(monthly.stripePriceId).toBeUndefined();
    expect(Object.keys(monthly)).toEqual(
      expect.arrayContaining([
        'id', 'tier', 'billingPeriod', 'label', 'periodSeconds',
        'amountMinor', 'currency', 'deviceLimit', 'backupRetentionMonths',
      ]),
    );
  });

  it('isPaidPlan classifier', () => {
    expect(isPaidPlan('free')).toBe(false);
    expect(isPaidPlan('pro-monthly')).toBe(true);
    expect(isPaidPlan('pro-yearly')).toBe(true);
    expect(isPaidPlan('max-monthly')).toBe(true);
    expect(isPaidPlan('max-yearly')).toBe(true);
    expect(isPaidPlan('garbage')).toBe(false);
  });

  it('tierOf / billingPeriodOf classifiers', () => {
    expect(tierOf('free')).toBe('free');
    expect(tierOf('pro-monthly')).toBe('pro');
    expect(tierOf('pro-yearly')).toBe('pro');
    expect(tierOf('max-monthly')).toBe('max');
    expect(tierOf('max-yearly')).toBe('max');
    expect(billingPeriodOf('free')).toBeNull();
    expect(billingPeriodOf('pro-monthly')).toBe('month');
    expect(billingPeriodOf('pro-yearly')).toBe('year');
    expect(billingPeriodOf('max-monthly')).toBe('month');
    expect(billingPeriodOf('max-yearly')).toBe('year');
  });

  it('deviceLimitOf and backupRetentionMonthsOf cover all tiers', () => {
    expect(deviceLimitOf('free')).toBe(1);
    expect(deviceLimitOf('pro-monthly')).toBe(2);
    expect(deviceLimitOf('max-monthly')).toBe(5);
    expect(backupRetentionMonthsOf('free')).toBe(0);
    expect(backupRetentionMonthsOf('pro-yearly')).toBe(12);
    expect(backupRetentionMonthsOf('max-yearly')).toBe(60);
  });

  it('mapStripePriceToPlanId resolves env-configured price IDs', () => {
    const env = {
      PLAN_PRO_MONTHLY_STRIPE_PRICE_ID: 'price_pm',
      PLAN_PRO_YEARLY_STRIPE_PRICE_ID: 'price_py',
      PLAN_MAX_MONTHLY_STRIPE_PRICE_ID: 'price_mm',
      PLAN_MAX_YEARLY_STRIPE_PRICE_ID: 'price_my',
    };
    expect(mapStripePriceToPlanId('price_pm', env)).toBe('pro-monthly');
    expect(mapStripePriceToPlanId('price_py', env)).toBe('pro-yearly');
    expect(mapStripePriceToPlanId('price_mm', env)).toBe('max-monthly');
    expect(mapStripePriceToPlanId('price_my', env)).toBe('max-yearly');
    expect(mapStripePriceToPlanId('price_unknown', env)).toBeNull();
    expect(mapStripePriceToPlanId(null, env)).toBeNull();
  });

  it('falls back to defaults when env values missing', () => {
    const monthly = getPlan('pro-monthly', {});
    expect(monthly.amountMinor).toBeGreaterThan(0);
    expect(monthly.currency).toBe('CZK');
  });
});
