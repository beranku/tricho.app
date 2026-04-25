// Stripe webhook handler. Verifies signature, deduplicates by event.id,
// applies the event to local subscription state, invalidates the entitlement
// cache for the affected user.

import { verifyWebhookSignature, applyStripeEvent, InvalidSignatureError } from './stripe.mjs';

/**
 * @param {{
 *   meta: any,
 *   entitlements: import('./entitlements.mjs').Entitlements | null,
 *   env: Record<string,string>,
 *   rawBody: string|Buffer,
 *   signatureHeader: string|undefined,
 * }} args
 * @returns {Promise<{status: number, body: any, canonicalUsername: string|null}>}
 */
export async function handleStripeWebhook({ meta, entitlements, env, rawBody, signatureHeader }) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return { status: 503, body: { error: 'webhook_not_configured' }, canonicalUsername: null };
  }
  try {
    verifyWebhookSignature({ rawBody, signatureHeader, secret });
  } catch (err) {
    if (err instanceof InvalidSignatureError) {
      return { status: 400, body: { error: 'invalid_signature' }, canonicalUsername: null };
    }
    throw err;
  }
  let event;
  try {
    event = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
  } catch {
    return { status: 400, body: { error: 'invalid_json' }, canonicalUsername: null };
  }
  if (!event?.id || !event?.type) {
    return { status: 400, body: { error: 'malformed_event' }, canonicalUsername: null };
  }
  const dedup = await meta.recordPaymentEvent({
    provider: 'stripe',
    eventId: event.id,
    payload: { type: event.type },
  });
  if (dedup.deduped) {
    return { status: 200, body: { ok: true, deduped: true }, canonicalUsername: null };
  }
  const result = await applyStripeEvent({ meta, env, event });
  if (entitlements && result.canonicalUsername) {
    entitlements.invalidate(result.canonicalUsername);
  }
  return { status: 200, body: { ok: true, action: result.action }, canonicalUsername: result.canonicalUsername };
}
