// Admin CLI: confirm a single bank-transfer payment intent.
//
//   ADMIN_BEARER_TOKEN=… AUTH_URL=http://localhost:4545 \
//     node scripts/admin-confirm-bank-transfer.mjs --intent-id=int_abc
//
// In production, run from the operator's workstation against the live
// tricho-auth host. Idempotent — replaying the same intentId returns 200.

const args = parseArgs(process.argv.slice(2));
const intentId = args['--intent-id'];
const AUTH_URL = (process.env.AUTH_URL ?? 'http://localhost:4545').replace(/\/$/, '');
const ADMIN_TOKEN = process.env.ADMIN_BEARER_TOKEN;

if (!intentId) {
  console.error('usage: admin-confirm-bank-transfer.mjs --intent-id=<id>');
  process.exit(2);
}
if (!ADMIN_TOKEN) {
  console.error('ADMIN_BEARER_TOKEN env var is required');
  process.exit(2);
}

const res = await fetch(`${AUTH_URL}/auth/billing/bank-transfer/admin/confirm`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${ADMIN_TOKEN}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ intentId }),
});
const body = await res.json().catch(() => ({}));
console.log(`status=${res.status}`);
console.log(JSON.stringify(body, null, 2));
process.exit(res.ok ? 0 : 1);

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^(--[\w-]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? '';
  }
  return out;
}
