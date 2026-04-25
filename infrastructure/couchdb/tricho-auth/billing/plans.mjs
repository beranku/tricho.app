// Plan catalog. Five plan IDs:
//   `free`           — 1 device, no cloud sync, no cloud backup
//   `pro-monthly`    — 2 devices, sync, 12-month cloud backup retention
//   `pro-yearly`     — same entitlements as pro-monthly, 365-day billing period
//   `max-monthly`    — 5 devices, sync, 60-month cloud backup retention
//   `max-yearly`     — same entitlements as max-monthly, 365-day billing period
//
// Operator picks pricing via env. The shape (tier × period) is fixed.

const SECONDS_PER_DAY = 86400;
const PRO_RETENTION_MONTHS = 12;
const MAX_RETENTION_MONTHS = 60;

export const PLAN_IDS = ['free', 'pro-monthly', 'pro-yearly', 'max-monthly', 'max-yearly'];
export const PAID_PLAN_IDS = ['pro-monthly', 'pro-yearly', 'max-monthly', 'max-yearly'];

export const TIER_KEYS = ['free', 'pro', 'max'];

export function tierOf(planId) {
  if (planId === 'pro-monthly' || planId === 'pro-yearly') return 'pro';
  if (planId === 'max-monthly' || planId === 'max-yearly') return 'max';
  return 'free';
}

export function billingPeriodOf(planId) {
  if (planId === 'pro-monthly' || planId === 'max-monthly') return 'month';
  if (planId === 'pro-yearly' || planId === 'max-yearly') return 'year';
  return null;
}

export function deviceLimitOf(planId) {
  switch (tierOf(planId)) {
    case 'pro': return 2;
    case 'max': return 5;
    default: return 1;
  }
}

export function backupRetentionMonthsOf(planId) {
  switch (tierOf(planId)) {
    case 'pro': return PRO_RETENTION_MONTHS;
    case 'max': return MAX_RETENTION_MONTHS;
    default: return 0;
  }
}

export function periodSecondsOf(planId) {
  if (planId === 'free') return null;
  if (billingPeriodOf(planId) === 'month') return 30 * SECONDS_PER_DAY;
  if (billingPeriodOf(planId) === 'year') return 365 * SECONDS_PER_DAY;
  return null;
}

export function entitlementsOf(planId) {
  return tierOf(planId) === 'free' ? [] : ['sync', 'backup'];
}

function envAmountFor(planId, env) {
  const map = {
    'pro-monthly': 'PLAN_PRO_MONTHLY_AMOUNT_MINOR',
    'pro-yearly': 'PLAN_PRO_YEARLY_AMOUNT_MINOR',
    'max-monthly': 'PLAN_MAX_MONTHLY_AMOUNT_MINOR',
    'max-yearly': 'PLAN_MAX_YEARLY_AMOUNT_MINOR',
  };
  const defaults = {
    'pro-monthly': 19900,
    'pro-yearly': 199000,
    'max-monthly': 49900,
    'max-yearly': 499000,
  };
  if (planId === 'free') return 0;
  return parseIntOr(env[map[planId]], defaults[planId]);
}

function envStripePriceFor(planId, env) {
  const map = {
    'pro-monthly': 'PLAN_PRO_MONTHLY_STRIPE_PRICE_ID',
    'pro-yearly': 'PLAN_PRO_YEARLY_STRIPE_PRICE_ID',
    'max-monthly': 'PLAN_MAX_MONTHLY_STRIPE_PRICE_ID',
    'max-yearly': 'PLAN_MAX_YEARLY_STRIPE_PRICE_ID',
  };
  if (planId === 'free') return null;
  return env[map[planId]] ?? null;
}

export function loadPlanCatalog(env = process.env) {
  const currency = env.BILLING_CURRENCY ?? 'CZK';
  const result = {};
  for (const id of PLAN_IDS) {
    result[id] = {
      id,
      tier: tierOf(id),
      billingPeriod: billingPeriodOf(id),
      label: labelFor(id),
      periodSeconds: periodSecondsOf(id),
      amountMinor: envAmountFor(id, env),
      currency,
      deviceLimit: deviceLimitOf(id),
      backupRetentionMonths: backupRetentionMonthsOf(id),
      entitlements: entitlementsOf(id),
      stripePriceId: envStripePriceFor(id, env),
    };
  }
  return result;
}

export function publicPlanCatalog(env = process.env) {
  const cat = loadPlanCatalog(env);
  return PLAN_IDS.map((id) => {
    const p = cat[id];
    return {
      id: p.id,
      tier: p.tier,
      billingPeriod: p.billingPeriod,
      label: p.label,
      periodSeconds: p.periodSeconds,
      amountMinor: p.amountMinor,
      currency: p.currency,
      deviceLimit: p.deviceLimit,
      backupRetentionMonths: p.backupRetentionMonths,
    };
  });
}

export function getPlan(id, env = process.env) {
  return loadPlanCatalog(env)[id] ?? null;
}

export function isPaidPlan(id) {
  return PAID_PLAN_IDS.includes(id);
}

export function mapStripePriceToPlanId(priceId, env = process.env) {
  if (!priceId) return null;
  for (const id of PAID_PLAN_IDS) {
    if (envStripePriceFor(id, env) === priceId) return id;
  }
  return null;
}

function labelFor(planId) {
  switch (planId) {
    case 'free': return 'Free';
    case 'pro-monthly': return 'Pro (monthly)';
    case 'pro-yearly': return 'Pro (yearly)';
    case 'max-monthly': return 'Max (monthly)';
    case 'max-yearly': return 'Max (yearly)';
    default: return planId;
  }
}

function parseIntOr(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
