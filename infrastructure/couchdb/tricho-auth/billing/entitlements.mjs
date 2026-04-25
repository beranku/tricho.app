// Entitlement check used by the CouchDB reverse proxy and the backup
// endpoints. The check applies grace-window math and an in-process cache
// keyed by canonical username so a sustained sync session does not hammer
// the meta DB.

const DEFAULT_TTL_MS = 30 * 1000;

export class Entitlements {
  /** @param {{meta: any, ttlMs?: number, now?: () => number}} opts */
  constructor({ meta, ttlMs = DEFAULT_TTL_MS, now = () => Date.now() }) {
    this.meta = meta;
    this.ttlMs = ttlMs;
    this.now = now;
    /** @type {Map<string, {fetchedAt: number, sub: any}>} */
    this.cache = new Map();
  }

  invalidate(canonicalUsername) {
    this.cache.delete(canonicalUsername);
  }

  invalidateAll() {
    this.cache.clear();
  }

  async #loadSubscription(canonicalUsername) {
    const now = this.now();
    const cached = this.cache.get(canonicalUsername);
    if (cached && now - cached.fetchedAt < this.ttlMs) return cached.sub;
    const sub = await this.meta.getSubscription(`user:${canonicalUsername}`);
    this.cache.set(canonicalUsername, { fetchedAt: now, sub });
    return sub;
  }

  /**
   * Returns `{allowed, reason, subscription, gracePeriodEndsAt, inGrace}`.
   * `reason` is one of: "ok" | "no_subscription" | "missing_entitlement" |
   * "plan_expired".
   */
  async check(canonicalUsername, entitlement) {
    const sub = await this.#loadSubscription(canonicalUsername);
    if (!sub) {
      return {
        allowed: false,
        reason: 'no_subscription',
        subscription: null,
        gracePeriodEndsAt: null,
        inGrace: false,
      };
    }
    const ents = Array.isArray(sub.entitlements) ? sub.entitlements : [];
    const grace = (sub.gracePeriodSeconds ?? 7 * 86400) * 1000;
    const gracePeriodEndsAt = sub.paidUntil != null ? sub.paidUntil + grace : null;

    if (!ents.includes(entitlement)) {
      return {
        allowed: false,
        reason: 'missing_entitlement',
        subscription: sub,
        gracePeriodEndsAt,
        inGrace: false,
      };
    }

    // paidUntil null + has entitlement is unusual (only happens for hand-set
    // operator records). Treat as allowed to avoid false denials.
    if (sub.paidUntil == null) {
      return {
        allowed: true,
        reason: 'ok',
        subscription: sub,
        gracePeriodEndsAt,
        inGrace: false,
      };
    }

    const now = this.now();
    if (now <= sub.paidUntil) {
      return {
        allowed: true,
        reason: 'ok',
        subscription: sub,
        gracePeriodEndsAt,
        inGrace: false,
      };
    }
    if (now <= gracePeriodEndsAt) {
      return {
        allowed: true,
        reason: 'ok',
        subscription: sub,
        gracePeriodEndsAt,
        inGrace: true,
      };
    }
    return {
      allowed: false,
      reason: 'plan_expired',
      subscription: sub,
      gracePeriodEndsAt,
      inGrace: false,
    };
  }
}
