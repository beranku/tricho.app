import type { Page } from '@playwright/test';

// Subscription state stubs for the e2e billing walkthrough. Each factory
// returns a plain JSON-serialisable object whose shape matches what
// `tricho-auth`'s `GET /auth/subscription` endpoint actually returns
// (see `OAuthSubscription` in `app/src/auth/oauth.ts`).

export type Tier = 'pro' | 'max';
export type Period = 'month' | 'year';

interface BaseSub {
  tier: 'free' | 'paid';
  plan: string;
  tierKey: 'free' | 'pro' | 'max';
  billingPeriod: 'month' | 'year' | null;
  provider: 'stripe' | 'bank-transfer' | null;
  status: string;
  entitlements: string[];
  deviceLimit: number;
  backupRetentionMonths: number;
  gracePeriodSeconds: number;
  gracePeriodEndsAt: number | null;
  freeDeviceGrandfathered: boolean;
  storageLimitMB: number;
  paidUntil: number | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

function planId(tier: Tier, period: Period): string {
  return `${tier}-${period === 'month' ? 'monthly' : 'yearly'}`;
}

function deviceLimitFor(tier: Tier): number {
  return tier === 'pro' ? 2 : 5;
}

function retentionMonthsFor(tier: Tier): number {
  return tier === 'pro' ? 12 : 60;
}

export function freeSubscription(): BaseSub {
  return {
    tier: 'free',
    plan: 'free',
    tierKey: 'free',
    billingPeriod: null,
    provider: null,
    status: 'active',
    entitlements: [],
    deviceLimit: 1,
    backupRetentionMonths: 0,
    gracePeriodSeconds: WEEK_MS / 1000,
    gracePeriodEndsAt: null,
    freeDeviceGrandfathered: false,
    storageLimitMB: 500,
    paidUntil: null,
  };
}

export function activeStripeSubscription({
  tier = 'pro',
  period = 'year',
  paidUntil = Date.now() + 90 * DAY_MS,
}: { tier?: Tier; period?: Period; paidUntil?: number } = {}): BaseSub {
  return {
    tier: 'paid',
    plan: planId(tier, period),
    tierKey: tier,
    billingPeriod: period,
    provider: 'stripe',
    status: 'active',
    entitlements: ['sync', 'backup'],
    deviceLimit: deviceLimitFor(tier),
    backupRetentionMonths: retentionMonthsFor(tier),
    gracePeriodSeconds: WEEK_MS / 1000,
    gracePeriodEndsAt: null,
    freeDeviceGrandfathered: false,
    storageLimitMB: 5_000,
    paidUntil,
    stripeCustomerId: 'cus_test_e2e',
    stripeSubscriptionId: 'sub_test_e2e',
  };
}

export function activeBankTransferSubscription({
  tier = 'pro',
  period = 'year',
  paidUntil = Date.now() + 90 * DAY_MS,
}: { tier?: Tier; period?: Period; paidUntil?: number } = {}): BaseSub {
  return {
    tier: 'paid',
    plan: planId(tier, period),
    tierKey: tier,
    billingPeriod: period,
    provider: 'bank-transfer',
    status: 'active',
    entitlements: ['sync', 'backup'],
    deviceLimit: deviceLimitFor(tier),
    backupRetentionMonths: retentionMonthsFor(tier),
    gracePeriodSeconds: WEEK_MS / 1000,
    gracePeriodEndsAt: null,
    freeDeviceGrandfathered: false,
    storageLimitMB: 5_000,
    paidUntil,
  };
}

export function canceledSubscription({
  tier = 'pro',
  period = 'year',
  paidUntil = Date.now() + 30 * DAY_MS,
  provider = 'stripe',
}: { tier?: Tier; period?: Period; paidUntil?: number; provider?: 'stripe' | 'bank-transfer' } = {}): BaseSub {
  return {
    tier: 'paid',
    plan: planId(tier, period),
    tierKey: tier,
    billingPeriod: period,
    provider,
    status: 'canceled',
    entitlements: ['sync', 'backup'],
    deviceLimit: deviceLimitFor(tier),
    backupRetentionMonths: retentionMonthsFor(tier),
    gracePeriodSeconds: WEEK_MS / 1000,
    gracePeriodEndsAt: null,
    freeDeviceGrandfathered: false,
    storageLimitMB: 5_000,
    paidUntil,
    stripeCustomerId: provider === 'stripe' ? 'cus_test_canceled' : null,
    stripeSubscriptionId: provider === 'stripe' ? 'sub_test_canceled' : null,
  };
}

export function inGraceSubscription({
  tier = 'pro',
  period = 'year',
}: { tier?: Tier; period?: Period } = {}): BaseSub {
  const now = Date.now();
  return {
    tier: 'paid',
    plan: planId(tier, period),
    tierKey: tier,
    billingPeriod: period,
    provider: 'stripe',
    status: 'active',
    entitlements: ['sync', 'backup'],
    deviceLimit: deviceLimitFor(tier),
    backupRetentionMonths: retentionMonthsFor(tier),
    gracePeriodSeconds: WEEK_MS / 1000,
    gracePeriodEndsAt: now + 5 * DAY_MS,
    freeDeviceGrandfathered: false,
    storageLimitMB: 5_000,
    paidUntil: now - DAY_MS,
    stripeCustomerId: 'cus_test_grace',
    stripeSubscriptionId: 'sub_test_grace',
  };
}

export function expiredSubscription({
  tier = 'pro',
  period = 'year',
}: { tier?: Tier; period?: Period } = {}): BaseSub {
  const now = Date.now();
  return {
    tier: 'paid',
    plan: planId(tier, period),
    tierKey: tier,
    billingPeriod: period,
    provider: 'stripe',
    status: 'canceled',
    entitlements: [],
    deviceLimit: deviceLimitFor(tier),
    backupRetentionMonths: retentionMonthsFor(tier),
    gracePeriodSeconds: WEEK_MS / 1000,
    gracePeriodEndsAt: now - DAY_MS,
    freeDeviceGrandfathered: false,
    storageLimitMB: 5_000,
    paidUntil: now - 10 * DAY_MS,
    stripeCustomerId: 'cus_test_expired',
    stripeSubscriptionId: 'sub_test_expired',
  };
}

export function stubPlans(): {
  plans: Array<{
    id: string;
    tier: 'free' | 'pro' | 'max';
    billingPeriod: 'month' | 'year' | null;
    label: string;
    periodSeconds: number | null;
    amountMinor: number;
    currency: 'CZK';
    deviceLimit: number;
    backupRetentionMonths: number;
  }>;
} {
  return {
    plans: [
      { id: 'free', tier: 'free', billingPeriod: null, label: 'Free', periodSeconds: null, amountMinor: 0, currency: 'CZK', deviceLimit: 1, backupRetentionMonths: 0 },
      { id: 'pro-monthly', tier: 'pro', billingPeriod: 'month', label: 'Pro (m)', periodSeconds: 30 * 86_400, amountMinor: 19_900, currency: 'CZK', deviceLimit: 2, backupRetentionMonths: 12 },
      { id: 'pro-yearly', tier: 'pro', billingPeriod: 'year', label: 'Pro (y)', periodSeconds: 365 * 86_400, amountMinor: 199_000, currency: 'CZK', deviceLimit: 2, backupRetentionMonths: 12 },
      { id: 'max-monthly', tier: 'max', billingPeriod: 'month', label: 'Max (m)', periodSeconds: 30 * 86_400, amountMinor: 49_900, currency: 'CZK', deviceLimit: 5, backupRetentionMonths: 60 },
      { id: 'max-yearly', tier: 'max', billingPeriod: 'year', label: 'Max (y)', periodSeconds: 365 * 86_400, amountMinor: 499_000, currency: 'CZK', deviceLimit: 5, backupRetentionMonths: 60 },
    ],
  };
}

/**
 * Wire `page.route(...)` so that `/auth/subscription` returns the given
 * subscription stub and `/auth/plans` returns the canonical Pro/Max
 * monthly+yearly catalogue. Idempotent — calling twice replaces the
 * previous handlers.
 */
export async function stubSubscription(page: Page, sub: BaseSub): Promise<void> {
  await page.route('**/auth/subscription', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subscription: sub }),
    });
  });
  await page.route('**/auth/plans', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stubPlans()),
    });
  });
}

/**
 * Open the Plan view directly via the e2e bridge (`__trichoE2E.setView`).
 * Avoids drilling through Settings → Předplatné, which is conditional on
 * `BILLING_UI_ENABLED` at build time.
 *
 * Caller MUST have `localStorage['tricho-e2e-bridge'] === '1'` set
 * (`enableTestBridge(context)`) and the AppShell must be mounted.
 */
export async function openPlanViaBridge(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __trichoE2E?: { setView?: (v: string) => void } };
    if (!w.__trichoE2E?.setView) {
      throw new Error('e2e bridge has no setView — was the bridge enabled?');
    }
    w.__trichoE2E.setView('plan');
  });
}
