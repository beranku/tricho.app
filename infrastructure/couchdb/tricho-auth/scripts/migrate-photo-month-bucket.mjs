// Idempotent migration: backfill plaintext top-level `monthBucket` field on
// existing photo-meta docs that predate the field. The bucket is computed
// from `updatedAt` (UTC) since `takenAt` is inside the encrypted payload and
// not available to the server. This is best-effort — clients writing new
// photo-meta docs after this migration will use `takenAt` precisely.
//
// Iterates every userdb-<hex> reachable via admin auth. Skips docs that
// already have a `monthBucket` field.
//
//   COUCHDB_URL=… COUCHDB_ADMIN_USER=admin COUCHDB_ADMIN_PASSWORD=… \
//     node scripts/migrate-photo-month-bucket.mjs

import { Meta } from '../meta.mjs';

const COUCHDB_URL = process.env.COUCHDB_URL ?? 'http://couchdb:5984';
const ADMIN_USER = process.env.COUCHDB_ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.COUCHDB_ADMIN_PASSWORD ?? 'changeme';
const META_DB = process.env.TRICHO_META_DB ?? 'tricho_meta';

export function deriveMonthBucketFromUpdatedAt(updatedAt) {
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null;
  const d = new Date(updatedAt);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function fetchAllDbs(meta) {
  const res = await fetch(`${meta.couchdbUrl}/_all_dbs`, {
    headers: { authorization: meta.auth, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`_all_dbs failed (${res.status})`);
  const list = await res.json();
  return list.filter((n) => typeof n === 'string' && n.startsWith('userdb-'));
}

async function migrateOneDb(meta, dbName) {
  const url = `${meta.couchdbUrl}/${dbName}/_all_docs?include_docs=true`;
  const res = await fetch(url, { headers: { authorization: meta.auth, accept: 'application/json' } });
  if (!res.ok) {
    if (res.status === 404) return { migrated: 0, total: 0 };
    throw new Error(`fetch ${dbName} failed (${res.status})`);
  }
  const body = await res.json();
  const rows = Array.isArray(body.rows) ? body.rows : [];
  let migrated = 0;
  let scanned = 0;
  for (const row of rows) {
    const doc = row.doc;
    if (!doc || doc.type !== 'photo-meta') continue;
    scanned += 1;
    if (typeof doc.monthBucket === 'string' && doc.monthBucket) continue;
    const bucket = deriveMonthBucketFromUpdatedAt(doc.updatedAt);
    if (!bucket) continue;
    const next = { ...doc, monthBucket: bucket };
    const putRes = await fetch(
      `${meta.couchdbUrl}/${dbName}/${encodeURIComponent(doc._id)}`,
      {
        method: 'PUT',
        headers: { authorization: meta.auth, 'content-type': 'application/json' },
        body: JSON.stringify(next),
      },
    );
    if (putRes.ok) migrated += 1;
  }
  return { migrated, scanned };
}

export async function runMigration(meta) {
  const dbs = await fetchAllDbs(meta);
  let totalMigrated = 0;
  let totalScanned = 0;
  for (const db of dbs) {
    const { migrated, scanned } = await migrateOneDb(meta, db);
    totalMigrated += migrated;
    totalScanned += scanned;
  }
  return { dbs: dbs.length, scanned: totalScanned, migrated: totalMigrated };
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
      console.log(`[migrate-photo-month-bucket] dbs=${r.dbs} scanned=${r.scanned} migrated=${r.migrated}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[migrate-photo-month-bucket] failed', err);
      process.exit(1);
    });
}
