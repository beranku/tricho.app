// Admin CLI: list pending bank-transfer intents — what to match against
// today's bank statement.
//
//   COUCHDB_URL=… COUCHDB_ADMIN_PASSWORD=… \
//     node scripts/list-pending-intents.mjs

import { Meta } from '../meta.mjs';

const meta = new Meta({
  couchdbUrl: process.env.COUCHDB_URL ?? 'http://couchdb:5984',
  adminUser: process.env.COUCHDB_ADMIN_USER ?? 'admin',
  adminPassword: process.env.COUCHDB_ADMIN_PASSWORD ?? 'changeme',
  dbName: process.env.TRICHO_META_DB ?? 'tricho_meta',
});

// Manually query the view since meta has no public list-all-intents helper;
// the operator's view is via the same API.
const url = `${meta.couchdbUrl}/${meta.dbName}/_design/tricho/_view/payment_intents_by_user?include_docs=true`;
const res = await fetch(url, { headers: { authorization: meta.auth } });
if (!res.ok) {
  console.error(`view fetch failed: ${res.status}`);
  process.exit(1);
}
const body = await res.json();
const rows = (body.rows ?? []).map((r) => r.doc).filter((d) => d?.status === 'pending');
console.log(`pending intents: ${rows.length}`);
for (const intent of rows) {
  const major = (intent.amountMinor / 100).toFixed(2);
  console.log(
    [
      intent.intentId,
      intent.userId,
      intent.plan,
      `${major} ${intent.currency}`,
      `vs=${intent.vs}`,
      `expires=${new Date(intent.expiresAt).toISOString().slice(0, 10)}`,
    ].join('  '),
  );
}
