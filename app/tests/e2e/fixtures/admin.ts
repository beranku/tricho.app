import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const COUCHDB_USER = process.env.COUCHDB_USER ?? 'admin';
const SECRET_FILE_CANDIDATES = [
  resolve(process.cwd(), '.secrets-runtime/couchdb_password'),
  // When tests run from `app/`, the secret is rendered into the repo root.
  resolve(process.cwd(), '..', '.secrets-runtime/couchdb_password'),
];

function loadCouchdbPassword(): string {
  if (process.env.COUCHDB_PASSWORD) return process.env.COUCHDB_PASSWORD;
  const explicit = process.env.COUCHDB_PASSWORD_FILE;
  const candidates = explicit ? [explicit] : SECRET_FILE_CANDIDATES;
  for (const path of candidates) {
    if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  }
  throw new Error(
    `[e2e admin] CouchDB admin password not available — set COUCHDB_PASSWORD or render the ci secret to one of ${candidates.join(', ')} (run \`make ci\` or \`make e2e\`).`,
  );
}

// Admin requests go through `docker exec tricho_couchdb curl` — Node's
// HTTP client cannot resolve `tricho.test`, and the traefik routes for
// `/userdb-*` now pass through tricho-auth's CouchDB proxy (which only
// accepts Bearer JWT, not the admin Basic auth this module needs).
function couchdbExecCurl(args: string[]): { status: number; body: string } {
  const password = loadCouchdbPassword();
  const auth = `${COUCHDB_USER}:${password}`;
  const fullArgs = [
    'exec', 'tricho_couchdb', 'curl', '-sS',
    '-u', auth,
    '-H', 'user-agent: tricho-e2e-admin',
    '-H', 'accept: application/json',
    '-w', '\nHTTPSTATUS:%{http_code}',
    ...args,
  ];
  const r = spawnSync('docker', fullArgs, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`couchdb admin curl failed: ${r.stderr || r.stdout}`);
  }
  const out = r.stdout ?? '';
  const m = out.match(/\nHTTPSTATUS:(\d+)$/);
  const status = m ? Number(m[1]) : 0;
  const body = m ? out.slice(0, -m[0].length) : out;
  return { status, body };
}

export async function closeAdmin(): Promise<void> {
  // No-op now that admin uses docker exec instead of a long-lived
  // APIRequestContext. Kept for backwards compatibility with specs that
  // call it from afterAll().
}

export function userDbHexFor(username: string): string {
  return Array.from(new TextEncoder().encode(username))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * GET a doc from a per-user database via the CouchDB admin port. Routed
 * through `docker exec` to bypass the tricho-auth proxy on the public edge.
 */
export async function adminGet<T = unknown>(docPath: string): Promise<T> {
  const url = `http://localhost:5984/${docPath}`;
  const r = couchdbExecCurl([url]);
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`adminGet ${docPath}: HTTP ${r.status} ${r.body}`);
  }
  return JSON.parse(r.body) as T;
}

/**
 * PUT a doc into a per-user database via CouchDB admin port. Used by the
 * tamper tests to mutate ciphertext on the server, then watch Device B's
 * reader reject it.
 */
export async function adminPut<T = unknown>(docPath: string, doc: unknown): Promise<T> {
  const url = `http://localhost:5984/${docPath}`;
  const r = couchdbExecCurl([
    '-X', 'PUT',
    '-H', 'content-type: application/json',
    '-d', JSON.stringify(doc),
    url,
  ]);
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`adminPut ${docPath}: HTTP ${r.status} ${r.body}`);
  }
  return JSON.parse(r.body) as T;
}

/**
 * Poll the user's CouchDB userdb until a `vault-state` doc exists.
 * Returns when present, throws on timeout. Used by walks that need
 * Device A's vault-state to be on the server before Device B's wizard
 * probes for it.
 */
export async function waitForServerVaultState(couchdbUsername: string, timeoutMs = 30_000): Promise<void> {
  const password = loadCouchdbPassword();
  const dbHex = userDbHexFor(couchdbUsername);
  const url = `http://${COUCHDB_USER}:${password}@127.0.0.1:5984/userdb-${dbHex}/vault-state`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = spawnSync('docker', ['exec', 'tricho_couchdb', 'curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}', url], { encoding: 'utf8' });
    if (r.stdout.trim() === '200') return;
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`waitForServerVaultState(${couchdbUsername}): timed out after ${timeoutMs}ms`);
}

/**
 * Flip the `tricho_meta` subscription doc for the given couchdb username
 * to `freeDeviceGrandfathered: true`, lifting the implicit free-tier
 * device limit from 1 to 2. Used by sync walks that need a second device
 * for the same `sub` without going through Stripe / bank-transfer.
 *
 * The test calls this BETWEEN Device A and Device B sign-in: A creates
 * the subscription record (deviceLimit=1), the test grandfathers, then
 * B's OAuth callback hits the `Math.max(baseLimit, 2)` branch.
 *
 * Uses `docker exec` against the running `tricho_couchdb` container —
 * Node's HTTP client cannot resolve `tricho.test`, and CouchDB's admin
 * port is not host-mapped in the ci profile.
 */
export async function grandfatherFreeDevices(couchdbUsername: string): Promise<void> {
  const password = loadCouchdbPassword();
  const docId = `subscription:user:${couchdbUsername}`;
  const url = `http://${COUCHDB_USER}:${password}@127.0.0.1:5984/tricho_meta/${docId}`;
  // Read current doc.
  const get = spawnSync('docker', ['exec', 'tricho_couchdb', 'curl', '-sS', url], { encoding: 'utf8' });
  if (get.status !== 0) {
    throw new Error(`grandfatherFreeDevices: GET failed: ${get.stderr || get.stdout}`);
  }
  const doc = JSON.parse(get.stdout) as Record<string, unknown>;
  if (typeof doc.error === 'string') {
    throw new Error(`grandfatherFreeDevices: ${doc.error} for ${docId}`);
  }
  const next = { ...doc, freeDeviceGrandfathered: true, updatedAt: Date.now() };
  const put = spawnSync(
    'docker',
    [
      'exec', 'tricho_couchdb', 'curl', '-sS',
      '-X', 'PUT',
      '-H', 'content-type: application/json',
      '-d', JSON.stringify(next),
      url,
    ],
    { encoding: 'utf8' },
  );
  if (put.status !== 0) {
    throw new Error(`grandfatherFreeDevices: PUT failed: ${put.stderr || put.stdout}`);
  }
  const putBody = JSON.parse(put.stdout) as Record<string, unknown>;
  if (!putBody.ok) {
    throw new Error(`grandfatherFreeDevices: PUT not ok: ${put.stdout}`);
  }
}

/**
 * Find the first document in `userdb-<hex>/` whose `type` matches and return
 * its `_id`. Used to locate the customer doc the test just wrote without
 * needing to know its generated id.
 */
export async function adminFindDocId(username: string, type: string): Promise<{ _id: string; _rev: string } | null> {
  const dbHex = userDbHexFor(username);
  const url = `http://localhost:5984/userdb-${dbHex}/_find`;
  const r = couchdbExecCurl([
    '-X', 'POST',
    '-H', 'content-type: application/json',
    '-d', JSON.stringify({ selector: { type }, limit: 5 }),
    url,
  ]);
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`adminFindDocId: HTTP ${r.status} ${r.body}`);
  }
  const body = JSON.parse(r.body) as { docs: Array<{ _id: string; _rev: string }> };
  if (!body.docs.length) return null;
  return { _id: body.docs[0]!._id, _rev: body.docs[0]!._rev };
}
