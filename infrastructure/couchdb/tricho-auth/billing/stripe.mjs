// Stripe wrapper. The Stripe SDK is loaded lazily so unit tests that don't
// touch billing don't require STRIPE_SECRET_KEY.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  getPlan,
  mapStripePriceToPlanId,
  tierOf,
  billingPeriodOf,
  deviceLimitOf,
  backupRetentionMonthsOf,
} from './plans.mjs';

const requireFromHere = createRequire(import.meta.url);

let stripeClient = null;

// Convert a STRIPE_API_BASE URL (e.g. http://stripe-mock:12111) into the
// host/port/protocol options the Stripe SDK exposes for this exact use case.
// Returns an empty object when the input is undefined/empty so the SDK falls
// back to its default (api.stripe.com).
export function parseStripeBase(base) {
  if (!base) return {};
  const url = new URL(base);
  const protocol = url.protocol.replace(/:$/, '');
  const port = url.port ? Number(url.port) : protocol === 'https' ? 443 : 80;
  return { host: url.hostname, port, protocol };
}

function client(env) {
  if (stripeClient) return stripeClient;
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  const Stripe = requireFromHere('stripe');
  stripeClient = new Stripe(key, {
    apiVersion: env.STRIPE_API_VERSION ?? null,
    ...parseStripeBase(env.STRIPE_API_BASE),
  });
  return stripeClient;
}

// Test seam — let unit tests substitute a fake.
export function _setStripeClient(c) {
  stripeClient = c;
}

/** Look up an existing Stripe customer by metadata.canonicalUsername, or create one. */
export async function getOrCreateCustomer({ env, canonicalUsername, email }) {
  const stripe = client(env);
  // Search Customers by metadata. Stripe's `search` API requires a billable
  // dashboard; if unavailable we fall back to listing recent customers and
  // filtering. For volume this is fine; large operators should rely on the
  // `stripeCustomerId` cached in the subscription doc.
  let found = null;
  try {
    const search = await stripe.customers.search({
      query: `metadata['canonicalUsername']:'${canonicalUsername}'`,
      limit: 1,
    });
    found = search.data[0] ?? null;
  } catch {
    // search not enabled — fall back
    const list = await stripe.customers.list({ email, limit: 100 });
    found = list.data.find((c) => c.metadata?.canonicalUsername === canonicalUsername) ?? null;
  }
  if (found) return found;
  return stripe.customers.create({
    email,
    metadata: { canonicalUsername },
  });
}

/**
 * Create a Stripe Checkout Session for a paid plan.
 *
 * @param {{
 *   env: Record<string,string>,
 *   user: {canonicalUsername: string, email: string|null},
 *   plan: 'sync-monthly'|'sync-yearly',
 *   successUrl: string,
 *   cancelUrl: string,
 *   trialDays?: number,
 * }} args
 */
export async function createCheckoutSession({ env, user, plan, successUrl, cancelUrl, trialDays = 0 }) {
  const planSpec = getPlan(plan, env);
  if (!planSpec || !planSpec.stripePriceId) throw new Error(`stripe price not configured for plan ${plan}`);
  const stripe = client(env);
  const customer = await getOrCreateCustomer({
    env,
    canonicalUsername: user.canonicalUsername,
    email: user.email ?? undefined,
  });
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: planSpec.stripePriceId, quantity: 1 }],
    customer: customer.id,
    client_reference_id: user.canonicalUsername,
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      metadata: { canonicalUsername: user.canonicalUsername },
      ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
    },
  });
  return { checkoutUrl: session.url, customerId: customer.id, sessionId: session.id };
}

/** Open the Stripe customer portal for managing existing subscriptions. */
export async function openCustomerPortal({ env, stripeCustomerId, returnUrl }) {
  const stripe = client(env);
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });
  return { portalUrl: session.url };
}

/** Cancel the user's Stripe subscription at period end. */
export async function cancelStripeSubscription({ env, stripeSubscriptionId }) {
  const stripe = client(env);
  return stripe.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: true });
}

/**
 * Verify a Stripe webhook signature against the raw body. Pure function — no
 * network calls, can be tested with synthetic signatures.
 *
 * Stripe-Signature header format: `t=<timestamp>,v1=<sig1>,v1=<sig2>,...`
 * The signed payload is `<timestamp>.<rawBody>` with HMAC-SHA256 and the
 * webhook secret as the key.
 *
 * @param {{ rawBody: string|Buffer, signatureHeader: string|undefined, secret: string, toleranceSec?: number, now?: number }} args
 */
export function verifyWebhookSignature({ rawBody, signatureHeader, secret, toleranceSec = 300, now = Date.now() / 1000 }) {
  if (!signatureHeader || !secret) throw new InvalidSignatureError('missing signature or secret');
  const parts = String(signatureHeader)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  let timestamp = null;
  const v1Sigs = [];
  for (const part of parts) {
    const [k, v] = part.split('=');
    if (k === 't') timestamp = Number.parseInt(v, 10);
    else if (k === 'v1') v1Sigs.push(v);
  }
  if (!Number.isFinite(timestamp) || v1Sigs.length === 0) {
    throw new InvalidSignatureError('malformed signature header');
  }
  if (Math.abs(now - timestamp) > toleranceSec) {
    throw new InvalidSignatureError('timestamp out of tolerance');
  }
  const payload =
    typeof rawBody === 'string' ? `${timestamp}.${rawBody}` : Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]);
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const expBuf = Buffer.from(expected);
  let matched = false;
  for (const sig of v1Sigs) {
    if (sig.length !== expected.length) continue;
    const sigBuf = Buffer.from(sig);
    if (timingSafeEqual(sigBuf, expBuf)) {
      matched = true;
      break;
    }
  }
  if (!matched) throw new InvalidSignatureError('signature mismatch');
  // Stripe SDK exposes constructEvent for the parsed JSON body. We only
  // verify; the caller is responsible for JSON.parse on the rawBody.
  return { timestamp };
}

export class InvalidSignatureError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidSignatureError';
  }
}

/**
 * Apply a Stripe webhook event to the local subscription state.
 * The caller MUST call `meta.recordPaymentEvent` first and short-circuit on
 * dedup; this function is the actual mutation.
 *
 * @param {{ meta: any, env: Record<string,string>, event: any }} args
 * @returns {{ canonicalUsername: string|null, action: string }}
 */
export async function applyStripeEvent({ meta, env, event }) {
  const type = event.type;
  const data = event.data?.object ?? {};
  if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
    return upsertFromSubscriptionObject({ meta, env, sub: data });
  }
  if (type === 'invoice.paid') {
    return creditFromInvoice({ meta, env, invoice: data });
  }
  if (type === 'customer.subscription.deleted') {
    return setStatusFromSubscription({ meta, env, sub: data, status: 'canceled' });
  }
  if (type === 'invoice.payment_failed') {
    return setStatusFromInvoice({ meta, env, invoice: data, status: 'past_due' });
  }
  return { canonicalUsername: null, action: 'noop' };
}

async function resolveUserIdFromCustomer({ meta, env, customerId, fallbackCanonicalUsername }) {
  if (fallbackCanonicalUsername) return `user:${fallbackCanonicalUsername}`;
  if (!customerId) return null;
  const stripe = client(env);
  const c = await stripe.customers.retrieve(customerId);
  if (c?.deleted) return null;
  const cu = c?.metadata?.canonicalUsername;
  return cu ? `user:${cu}` : null;
}

async function upsertFromSubscriptionObject({ meta, env, sub }) {
  const canonicalUsername = sub.metadata?.canonicalUsername;
  const userId = canonicalUsername
    ? `user:${canonicalUsername}`
    : await resolveUserIdFromCustomer({ meta, env, customerId: sub.customer });
  if (!userId) return { canonicalUsername: null, action: 'no-user' };
  const priceId = sub.items?.data?.[0]?.price?.id;
  const planId = mapStripePriceToPlanId(priceId, env);
  const status = mapStripeStatus(sub.status);
  const patch = {
    stripeCustomerId: sub.customer,
    stripeSubscriptionId: sub.id,
    provider: 'stripe',
    status,
  };
  if (planId) patch.plan = planId;
  await meta.updateSubscription(userId, patch);
  return { canonicalUsername: userId.slice('user:'.length), action: 'upsert' };
}

async function creditFromInvoice({ meta, env, invoice }) {
  const subId = invoice.subscription;
  let canonicalUsername = invoice.subscription_details?.metadata?.canonicalUsername ?? null;
  let userId = null;
  if (canonicalUsername) userId = `user:${canonicalUsername}`;
  if (!userId && subId) {
    const stripe = client(env);
    const sub = await stripe.subscriptions.retrieve(subId);
    canonicalUsername = sub?.metadata?.canonicalUsername ?? null;
    if (canonicalUsername) userId = `user:${canonicalUsername}`;
    if (!userId) userId = await resolveUserIdFromCustomer({ meta, env, customerId: invoice.customer });
  }
  if (!userId) return { canonicalUsername: null, action: 'no-user' };
  const priceId = invoice.lines?.data?.[0]?.price?.id;
  const planId = mapStripePriceToPlanId(priceId, env) ?? 'pro-monthly';
  const planSpec = getPlan(planId, env);
  const periodSeconds = planSpec?.periodSeconds ?? 30 * 86400;
  await meta.creditPaidUntil({
    userId,
    plan: planId,
    periodSeconds,
    provider: 'stripe',
    tierKey: tierOf(planId),
    billingPeriod: billingPeriodOf(planId),
    deviceLimit: deviceLimitOf(planId),
    backupRetentionMonths: backupRetentionMonthsOf(planId),
    extra: {
      stripeCustomerId: invoice.customer,
      stripeSubscriptionId: subId,
    },
  });
  return { canonicalUsername: userId.slice('user:'.length), action: 'credited' };
}

async function setStatusFromSubscription({ meta, env, sub, status }) {
  const canonicalUsername = sub.metadata?.canonicalUsername;
  const userId = canonicalUsername
    ? `user:${canonicalUsername}`
    : await resolveUserIdFromCustomer({ meta, env, customerId: sub.customer });
  if (!userId) return { canonicalUsername: null, action: 'no-user' };
  await meta.updateSubscription(userId, { status, stripeSubscriptionId: sub.id });
  return { canonicalUsername: userId.slice('user:'.length), action: status };
}

async function setStatusFromInvoice({ meta, env, invoice, status }) {
  const customerId = invoice.customer;
  const userId = await resolveUserIdFromCustomer({ meta, env, customerId });
  if (!userId) return { canonicalUsername: null, action: 'no-user' };
  await meta.updateSubscription(userId, { status });
  return { canonicalUsername: userId.slice('user:'.length), action: status };
}

function mapStripeStatus(s) {
  switch (s) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return 'active';
  }
}
