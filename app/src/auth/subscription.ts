import { getAuthOrigin } from './oauth';
import type { OAuthSubscription, PlanId, PaidPlanId, TierKey, BillingPeriod } from './oauth';

export type Subscription = OAuthSubscription;
export type { PlanId, PaidPlanId, TierKey, BillingPeriod };

export interface PublicPlan {
  id: PlanId;
  tier: TierKey;
  billingPeriod: BillingPeriod;
  label: string;
  /** legacy field — kept for backward-compat with existing tests; mirrors billingPeriod */
  period?: 'none' | 'month' | 'year';
  periodSeconds: number | null;
  amountMinor: number;
  currency: string;
  deviceLimit: number;
  backupRetentionMonths: number;
}

export class PlanExpiredError extends Error {
  paidUntil: number | null;
  gracePeriodEndsAt: number | null;
  reason: string;
  constructor(opts: { paidUntil: number | null; gracePeriodEndsAt: number | null; reason: string }) {
    super(`plan_expired: ${opts.reason}`);
    this.name = 'PlanExpiredError';
    this.paidUntil = opts.paidUntil;
    this.gracePeriodEndsAt = opts.gracePeriodEndsAt;
    this.reason = opts.reason;
  }
}

export async function fetchSubscription(jwt: string): Promise<Subscription | null> {
  const res = await fetch(`${getAuthOrigin()}/auth/subscription`, {
    headers: { authorization: `Bearer ${jwt}` },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const body = (await res.json().catch(() => null)) as { subscription: Subscription | null } | null;
  return body?.subscription ?? null;
}

export async function fetchPublicPlans(): Promise<PublicPlan[]> {
  const res = await fetch(`${getAuthOrigin()}/auth/plans`).catch(() => null);
  if (!res || !res.ok) return [];
  const body = (await res.json().catch(() => null)) as { plans: PublicPlan[] } | null;
  return body?.plans ?? [];
}

export async function cancelSubscription(jwt: string): Promise<boolean> {
  const res = await fetch(`${getAuthOrigin()}/auth/subscription/cancel`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}` },
  }).catch(() => null);
  return Boolean(res && res.ok);
}

export async function startStripeCheckout(
  jwt: string,
  args: { plan: PaidPlanId; successUrl: string; cancelUrl: string },
): Promise<{ checkoutUrl: string } | null> {
  const res = await fetch(`${getAuthOrigin()}/auth/billing/stripe/checkout`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
}

export async function openStripePortal(jwt: string, returnUrl: string): Promise<{ portalUrl: string } | null> {
  const res = await fetch(
    `${getAuthOrigin()}/auth/billing/stripe/portal?return_url=${encodeURIComponent(returnUrl)}`,
    { headers: { authorization: `Bearer ${jwt}` } },
  ).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json().catch(() => null);
}

export interface BankTransferIntent {
  intentId: string;
  vs: string;
  plan: PaidPlanId;
  amountMinor: number;
  currency: string;
  iban: string;
  accountNumber: string;
  status: 'pending' | 'paid' | 'canceled' | 'expired';
  createdAt: number;
  expiresAt: number;
  qrCodePayload: string;
  paidAt?: number;
}

export async function createBankTransferIntent(
  jwt: string,
  plan: PaidPlanId,
): Promise<BankTransferIntent | null> {
  const res = await fetch(`${getAuthOrigin()}/auth/billing/bank-transfer/intent`, {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ plan }),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const body = (await res.json().catch(() => null)) as { intent: BankTransferIntent } | null;
  return body?.intent ?? null;
}

export async function fetchBankTransferIntent(
  jwt: string,
  intentId: string,
): Promise<BankTransferIntent | null> {
  const res = await fetch(
    `${getAuthOrigin()}/auth/billing/bank-transfer/intent/${encodeURIComponent(intentId)}`,
    { headers: { authorization: `Bearer ${jwt}` } },
  ).catch(() => null);
  if (!res || !res.ok) return null;
  const body = (await res.json().catch(() => null)) as { intent: BankTransferIntent } | null;
  return body?.intent ?? null;
}

export async function cancelBankTransferIntent(jwt: string, intentId: string): Promise<boolean> {
  const res = await fetch(
    `${getAuthOrigin()}/auth/billing/bank-transfer/intent/${encodeURIComponent(intentId)}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${jwt}` } },
  ).catch(() => null);
  return Boolean(res && res.ok);
}

/** Convenience: minor units → display string (e.g., 29900 CZK → "299,00"). */
export function formatAmount(amountMinor: number, currency: string, locale: 'cs' | 'en'): string {
  const major = (amountMinor / 100).toFixed(2);
  if (locale === 'cs') {
    // CZ uses comma decimal + space thousands.
    const [whole, frac] = major.split('.');
    const wholeWithSep = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${wholeWithSep},${frac} ${currency}`;
  }
  const [whole, frac] = major.split('.');
  const wholeWithSep = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${wholeWithSep}.${frac}`;
}

export function daysRemaining(paidUntil: number | null, now: number = Date.now()): number {
  if (paidUntil == null) return 0;
  const ms = paidUntil - now;
  if (ms <= 0) return 0;
  return Math.ceil(ms / (86400 * 1000));
}

export function isInGrace(sub: Subscription, now: number = Date.now()): boolean {
  if (sub.tier !== 'paid' || sub.paidUntil == null) return false;
  if (now <= sub.paidUntil) return false;
  if (sub.gracePeriodEndsAt == null) return false;
  return now <= sub.gracePeriodEndsAt;
}
