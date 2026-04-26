/**
 * Subscription store. Mirrors the server's `GET /auth/subscription` shape
 * and refreshes when explicitly asked. The shape is the source of truth
 * for entitlement-driven UI gating; do NOT trust it for security gates —
 * the server enforces those independently.
 */
import { atom } from 'nanostores';
import {
  fetchSubscription,
  cancelSubscription as cancelOnServer,
  type Subscription,
} from '../../auth/subscription';

export const subscriptionStore = atom<Subscription | null>(null);

let inflight: Promise<Subscription | null> | null = null;

export async function loadSubscription(jwt: string | null): Promise<Subscription | null> {
  if (!jwt) {
    subscriptionStore.set(null);
    return null;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const sub = await fetchSubscription(jwt);
      subscriptionStore.set(sub);
      return sub;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function refreshSubscription(jwt: string | null): Promise<Subscription | null> {
  inflight = null;
  return loadSubscription(jwt);
}

export async function cancelSubscription(jwt: string): Promise<boolean> {
  const ok = await cancelOnServer(jwt);
  if (ok) await refreshSubscription(jwt);
  return ok;
}

export function setSubscriptionForTests(sub: Subscription | null): void {
  subscriptionStore.set(sub);
  inflight = null;
}
