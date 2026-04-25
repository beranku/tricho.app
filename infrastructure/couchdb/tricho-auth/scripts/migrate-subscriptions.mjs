// Idempotent migration: backfill the new fields on `subscription:*` docs.
//
//   node scripts/migrate-subscriptions.mjs
//
// Reads tricho_meta over the admin auth, transforms each subscription doc
// in-place, writes back. Idempotent — running twice is a no-op for
// already-migrated docs (no _rev change).

import { Meta } from '../meta.mjs';

const COUCHDB_URL = process.env.COUCHDB_URL ?? 'http://couchdb:5984';
const ADMIN_USER = process.env.COUCHDB_ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.COUCHDB_ADMIN_PASSWORD ?? 'changeme';
const META_DB = process.env.TRICHO_META_DB ?? 'tricho_meta';

// Map a legacy plan id (sync-monthly / sync-yearly / paid) into the new
// (tier, billingPeriod) tuple. Existing paid users default to `pro` since
// they had only one paid SKU before; operators can promote to `max` manually.
function mapLegacyPlan(legacyPlan, hasStripeCustomer) {
  if (!legacyPlan || legacyPlan === 'free') {
    return { plan: 'free', tierKey: 'free', billingPeriod: null };
  }
  if (legacyPlan === 'sync-yearly' || legacyPlan === 'pro-yearly') {
    return { plan: 'pro-yearly', tierKey: 'pro', billingPeriod: 'year' };
  }
  if (legacyPlan === 'sync-monthly' || legacyPlan === 'pro-monthly') {
    return { plan: 'pro-monthly', tierKey: 'pro', billingPeriod: 'month' };
  }
  if (legacyPlan === 'max-monthly') {
    return { plan: 'max-monthly', tierKey: 'max', billingPeriod: 'month' };
  }
  if (legacyPlan === 'max-yearly') {
    return { plan: 'max-yearly', tierKey: 'max', billingPeriod: 'year' };
  }
  // Generic 'paid' or unknown — treat as pro-monthly.
  return { plan: 'pro-monthly', tierKey: 'pro', billingPeriod: 'month' };
}

const RETENTION_BY_TIER = { free: 0, pro: 12, max: 60 };
const DEVICE_LIMIT_BY_TIER = { free: 1, pro: 2, max: 5 };

export function migrateSubscriptionDoc(doc, devicesByUser) {
  // Treat falsy fields as absent (the existing free-tier doc has only
  // {tier, deviceLimit, paidUntil, storageLimitMB, updatedAt}).
  const isPaid = doc.tier === 'paid' || (typeof doc.paidUntil === 'number' && doc.paidUntil > Date.now());
  const hasStripeCustomer = typeof doc.stripeCustomerId === 'string' && doc.stripeCustomerId.length > 0;

  // Map any legacy/current plan into the canonical (plan, tierKey, period) tuple.
  // If the doc is paid but missing a plan, default to pro-monthly.
  const inputPlan = doc.plan ?? (isPaid ? 'pro-monthly' : 'free');
  const planTuple = mapLegacyPlan(inputPlan, hasStripeCustomer);
  const plan = isPaid ? planTuple.plan : 'free';
  const tierKey = isPaid ? planTuple.tierKey : 'free';
  const billingPeriod = isPaid ? planTuple.billingPeriod : null;

  const provider = isPaid
    ? hasStripeCustomer
      ? 'stripe'
      : doc.provider ?? 'bank-transfer'
    : null;

  const status = doc.status ?? (isPaid ? 'active' : 'active');

  const entitlements = isPaid ? ['sync', 'backup'] : [];

  const activeDeviceCount = (devicesByUser.get(doc.userId) ?? []).filter((d) => !d.revoked).length;
  const grandfather = !isPaid && activeDeviceCount >= 2;

  const next = {
    ...doc,
    type: 'subscription',
    tier: isPaid ? 'paid' : 'free',
    plan,
    tierKey: doc.tierKey ?? tierKey,
    billingPeriod: doc.billingPeriod !== undefined ? doc.billingPeriod : billingPeriod,
    provider: doc.provider !== undefined ? doc.provider : provider,
    status: doc.status ?? status,
    entitlements: doc.entitlements ?? entitlements,
    // First-time migration (no tierKey on the doc) re-derives deviceLimit and
    // backupRetentionMonths from the tier so they match the new model. If the
    // doc was already migrated (`tierKey` present), the operator's manual
    // overrides are preserved.
    deviceLimit:
      doc.tierKey != null
        ? doc.deviceLimit ?? DEVICE_LIMIT_BY_TIER[isPaid ? tierKey : 'free']
        : DEVICE_LIMIT_BY_TIER[isPaid ? tierKey : 'free'],
    backupRetentionMonths:
      doc.tierKey != null
        ? doc.backupRetentionMonths ?? RETENTION_BY_TIER[isPaid ? tierKey : 'free']
        : RETENTION_BY_TIER[isPaid ? tierKey : 'free'],
    gracePeriodSeconds: doc.gracePeriodSeconds ?? 7 * 86400,
    freeDeviceGrandfathered:
      doc.freeDeviceGrandfathered !== undefined ? doc.freeDeviceGrandfathered : grandfather,
    storageLimitMB: doc.storageLimitMB ?? 500,
    paidUntil: doc.paidUntil ?? null,
    stripeCustomerId: doc.stripeCustomerId ?? null,
    stripeSubscriptionId: doc.stripeSubscriptionId ?? null,
    createdAt: doc.createdAt ?? doc.updatedAt ?? Date.now(),
    updatedAt: doc.updatedAt ?? Date.now(),
  };
  return next;
}

export function isMigrationNeeded(before, after) {
  // Compare every key we may set; if any differs, we must write.
  const keys = [
    'tier', 'plan', 'tierKey', 'billingPeriod', 'provider', 'status', 'entitlements',
    'deviceLimit', 'backupRetentionMonths', 'gracePeriodSeconds', 'freeDeviceGrandfathered',
    'storageLimitMB', 'paidUntil', 'stripeCustomerId', 'stripeSubscriptionId',
    'createdAt',
  ];
  for (const k of keys) {
    const a = before?.[k];
    const b = after?.[k];
    if (Array.isArray(a) || Array.isArray(b)) {
      if (JSON.stringify(a ?? []) !== JSON.stringify(b ?? [])) return true;
    } else if (a !== b) {
      return true;
    }
  }
  return false;
}

async function listAllSubscriptions(meta) {
  // Use the public view via the existing #view shim — but that's private.
  // Re-issue a direct GET on the view here for simplicity.
  const url = `${meta.couchdbUrl}/${meta.dbName}/_design/tricho/_view/subscriptions_by_user?include_docs=true`;
  const res = await fetch(url, { headers: { authorization: meta.auth } });
  if (!res.ok) throw new Error(`view failed (${res.status})`);
  const body = await res.json();
  return body.rows.map((r) => r.doc);
}

async function listAllDevices(meta) {
  const url = `${meta.couchdbUrl}/${meta.dbName}/_design/tricho/_view/devices_by_user?include_docs=true`;
  const res = await fetch(url, { headers: { authorization: meta.auth } });
  if (!res.ok) throw new Error(`view failed (${res.status})`);
  const body = await res.json();
  return body.rows.map((r) => r.doc);
}

async function putDoc(meta, doc) {
  const url = `${meta.couchdbUrl}/${meta.dbName}/${encodeURIComponent(doc._id)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { authorization: meta.auth, 'content-type': 'application/json' },
    body: JSON.stringify(doc),
  });
  if (!res.ok) throw new Error(`put failed (${res.status})`);
  return res.json();
}

export async function runMigration(meta) {
  const subs = await listAllSubscriptions(meta);
  const devices = await listAllDevices(meta);
  const devicesByUser = new Map();
  for (const d of devices) {
    if (!devicesByUser.has(d.userId)) devicesByUser.set(d.userId, []);
    devicesByUser.get(d.userId).push(d);
  }
  let migrated = 0;
  let skipped = 0;
  for (const sub of subs) {
    const next = migrateSubscriptionDoc(sub, devicesByUser);
    if (!isMigrationNeeded(sub, next)) {
      skipped += 1;
      continue;
    }
    next.updatedAt = Date.now();
    await putDoc(meta, next);
    migrated += 1;
  }
  return { migrated, skipped, total: subs.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const meta = new Meta({
    couchdbUrl: COUCHDB_URL,
    adminUser: ADMIN_USER,
    adminPassword: ADMIN_PASSWORD,
    dbName: META_DB,
  });
  runMigration(meta)
    .then((r) => {
      console.log(`[migrate-subscriptions] migrated=${r.migrated} skipped=${r.skipped} total=${r.total}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[migrate-subscriptions] failed', err);
      process.exit(1);
    });
}
