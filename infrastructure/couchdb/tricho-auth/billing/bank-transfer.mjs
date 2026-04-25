// Bank transfer payment intent flow.
//
// 1. The client `POST /auth/billing/bank-transfer/intent` to mint a payment
//    intent with a Czech-standard variable symbol (VS), amount, IBAN.
// 2. The user pays from their bank with that VS as the payment reference.
// 3. An operator (or future bank-API integration) confirms the deposit by
//    calling `POST /auth/billing/bank-transfer/admin/confirm` with the
//    intentId. That endpoint extends `paidUntil` and is idempotent.

import { randomBytes } from 'node:crypto';
import {
  getPlan,
  tierOf,
  billingPeriodOf,
  deviceLimitOf,
  backupRetentionMonthsOf,
} from './plans.mjs';

const VS_LENGTH = 10;
const INTENT_TTL_DAYS = 14;

/** Generate a 10-digit numeric VS that does not collide with any existing intent. */
export async function generateUniqueVS(meta) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const vs = randomDigits(VS_LENGTH);
    const existing = await meta.findPaymentIntentByVS(vs);
    if (!existing) return vs;
  }
  throw new Error('failed to generate unique VS after 10 attempts');
}

function randomDigits(length) {
  const buf = randomBytes(length);
  let out = '';
  for (const b of buf) out += String(b % 10);
  return out;
}

/** Compose a Czech SPAYD payment-QR string. */
export function composeSpaydPayload({ iban, amountMinor, currency, vs, plan }) {
  const major = (amountMinor / 100).toFixed(2);
  // SPAYD escapes asterisks in messages — we keep MSG short and asterisk-free.
  const msg = `Tricho ${plan}`;
  return `SPD*1.0*ACC:${iban}*AM:${major}*CC:${currency}*X-VS:${vs}*MSG:${msg}`;
}

/**
 * Create a new pending intent. Caller must have already verified that the
 * user has no active Stripe subscription.
 *
 * @param {{
 *   meta: any,
 *   env: Record<string,string>,
 *   userId: string, // "user:<canonical>"
 *   plan: 'sync-monthly'|'sync-yearly',
 *   now?: number,
 * }} args
 */
export async function createIntent({ meta, env, userId, plan, now = Date.now() }) {
  const planSpec = getPlan(plan, env);
  if (!planSpec || planSpec.amountMinor <= 0) {
    throw new Error(`invalid plan: ${plan}`);
  }
  const iban = env.BILLING_BANK_IBAN ?? null;
  const accountNumber = env.BILLING_BANK_ACCOUNT ?? null;
  if (!iban || !accountNumber) {
    throw new Error('bank account not configured (BILLING_BANK_IBAN / BILLING_BANK_ACCOUNT)');
  }
  const vs = await generateUniqueVS(meta);
  const intentId = `int_${randomBytes(12).toString('base64url')}`;
  const expiresAt = now + INTENT_TTL_DAYS * 86400 * 1000;
  const intent = {
    intentId,
    userId,
    vs,
    plan,
    amountMinor: planSpec.amountMinor,
    currency: planSpec.currency,
    status: 'pending',
    iban,
    accountNumber,
    createdAt: now,
    expiresAt,
  };
  await meta.createPaymentIntent(intent);
  return {
    ...intent,
    qrCodePayload: composeSpaydPayload({
      iban,
      amountMinor: planSpec.amountMinor,
      currency: planSpec.currency,
      vs,
      plan,
    }),
  };
}

/**
 * Admin-confirm: credit the user's subscription. Idempotent via payment-event
 * dedup. The caller (route handler) checks the admin token before reaching
 * this function.
 */
export async function confirmIntent({ meta, env, intentId, now = Date.now() }) {
  const intent = await meta.getPaymentIntent(intentId);
  if (!intent) return { status: 404, body: { error: 'intent_not_found' } };
  if (intent.status === 'canceled') return { status: 410, body: { error: 'intent_canceled' } };
  if (intent.status === 'expired' || intent.expiresAt < now) {
    if (intent.status !== 'expired') {
      await meta.updatePaymentIntent(intentId, { status: 'expired' });
    }
    return { status: 410, body: { error: 'intent_expired' } };
  }
  const dedup = await meta.recordPaymentEvent({
    provider: 'bank-transfer',
    eventId: intentId,
    payload: { plan: intent.plan, vs: intent.vs },
  });
  if (dedup.deduped) {
    return { status: 200, body: { ok: true, deduped: true, intent } };
  }
  const planSpec = getPlan(intent.plan, env);
  await meta.creditPaidUntil({
    userId: intent.userId,
    plan: intent.plan,
    periodSeconds: planSpec.periodSeconds,
    provider: 'bank-transfer',
    tierKey: tierOf(intent.plan),
    billingPeriod: billingPeriodOf(intent.plan),
    deviceLimit: deviceLimitOf(intent.plan),
    backupRetentionMonths: backupRetentionMonthsOf(intent.plan),
  });
  const updatedIntent = await meta.updatePaymentIntent(intentId, {
    status: 'paid',
    paidAt: now,
  });
  return { status: 200, body: { ok: true, intent: updatedIntent } };
}

export async function cancelIntent({ meta, intentId, userId }) {
  const intent = await meta.getPaymentIntent(intentId);
  if (!intent) return { status: 404, body: { error: 'intent_not_found' } };
  if (intent.userId !== userId) return { status: 403, body: { error: 'forbidden' } };
  if (intent.status !== 'pending') return { status: 409, body: { error: 'not_cancelable', status: intent.status } };
  const updated = await meta.updatePaymentIntent(intentId, { status: 'canceled' });
  return { status: 200, body: { ok: true, intent: updated } };
}
