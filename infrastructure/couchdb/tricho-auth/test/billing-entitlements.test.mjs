import { describe, it, expect } from 'vitest';
import { Entitlements } from '../billing/entitlements.mjs';
import { fakeMeta } from './fixtures/meta.mjs';

const USER_ID = 'user:g_abc';
const CANONICAL = 'g_abc';

function buildEnt({ now } = {}) {
  const { meta } = fakeMeta();
  const ent = new Entitlements({ meta, now });
  return { meta, ent };
}

async function withSub(meta, patch) {
  await meta.ensureSubscription(USER_ID, {});
  await meta.updateSubscription(USER_ID, patch);
}

describe('Entitlements.check', () => {
  it('free user is denied sync', async () => {
    const { meta, ent } = buildEnt();
    await withSub(meta, { entitlements: [], paidUntil: null });
    const r = await ent.check(CANONICAL, 'sync');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('missing_entitlement');
  });

  it('paid user with active paidUntil is allowed', async () => {
    let now = 1_700_000_000_000;
    const { meta, ent } = buildEnt({ now: () => now });
    await withSub(meta, {
      entitlements: ['sync', 'backup'],
      paidUntil: now + 5 * 86400 * 1000,
    });
    const r = await ent.check(CANONICAL, 'sync');
    expect(r.allowed).toBe(true);
    expect(r.inGrace).toBe(false);
  });

  it('paid user inside grace window is allowed and inGrace flagged', async () => {
    let now = 1_700_000_000_000;
    const { meta, ent } = buildEnt({ now: () => now });
    await withSub(meta, {
      entitlements: ['sync', 'backup'],
      paidUntil: now - 3 * 86400 * 1000,
      gracePeriodSeconds: 7 * 86400,
    });
    const r = await ent.check(CANONICAL, 'sync');
    expect(r.allowed).toBe(true);
    expect(r.inGrace).toBe(true);
    expect(r.gracePeriodEndsAt).toBe(now - 3 * 86400 * 1000 + 7 * 86400 * 1000);
  });

  it('paid user past grace window is denied', async () => {
    let now = 1_700_000_000_000;
    const { meta, ent } = buildEnt({ now: () => now });
    await withSub(meta, {
      entitlements: ['sync', 'backup'],
      paidUntil: now - 8 * 86400 * 1000,
      gracePeriodSeconds: 7 * 86400,
    });
    const r = await ent.check(CANONICAL, 'sync');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('plan_expired');
  });

  it('missing subscription denies', async () => {
    const { ent } = buildEnt();
    const r = await ent.check('unknown_user', 'sync');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('no_subscription');
  });

  it('cache returns same answer until invalidated', async () => {
    let now = 1_700_000_000_000;
    const { meta, ent } = buildEnt({ now: () => now });
    await withSub(meta, { entitlements: ['sync'], paidUntil: now + 86400 * 1000 });
    const r1 = await ent.check(CANONICAL, 'sync');
    expect(r1.allowed).toBe(true);

    // Mutate underlying state — without invalidate, the cached value wins.
    await meta.updateSubscription(USER_ID, { entitlements: [] });
    const r2 = await ent.check(CANONICAL, 'sync');
    expect(r2.allowed).toBe(true);

    ent.invalidate(CANONICAL);
    const r3 = await ent.check(CANONICAL, 'sync');
    expect(r3.allowed).toBe(false);
  });

  it('cache TTL expires automatically', async () => {
    let now = 1_700_000_000_000;
    const { meta, ent } = buildEnt({ now: () => now });
    Object.assign(ent, { ttlMs: 1000 });
    await withSub(meta, { entitlements: ['sync'], paidUntil: now + 86400 * 1000 });
    const r1 = await ent.check(CANONICAL, 'sync');
    expect(r1.allowed).toBe(true);
    await meta.updateSubscription(USER_ID, { entitlements: [] });
    now += 5000;
    const r2 = await ent.check(CANONICAL, 'sync');
    expect(r2.allowed).toBe(false);
  });

  it('separates sync vs backup entitlements', async () => {
    let now = 1_700_000_000_000;
    const { meta, ent } = buildEnt({ now: () => now });
    await withSub(meta, {
      entitlements: ['sync'],
      paidUntil: now + 86400 * 1000,
    });
    expect((await ent.check(CANONICAL, 'sync')).allowed).toBe(true);
    expect((await ent.check(CANONICAL, 'backup')).allowed).toBe(false);
  });
});
