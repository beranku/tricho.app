import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { request } from '@playwright/test';

const COUCHDB_USER = process.env.COUCHDB_USER ?? 'admin';
const SECRET_FILE_DEFAULT = resolve(process.cwd(), '.secrets-runtime/couchdb_password');

function loadCouchdbPassword(): string {
  if (process.env.COUCHDB_PASSWORD) return process.env.COUCHDB_PASSWORD;
  const path = process.env.COUCHDB_PASSWORD_FILE ?? SECRET_FILE_DEFAULT;
  if (!existsSync(path)) {
    throw new Error(
      `[e2e admin] CouchDB admin password not available — set COUCHDB_PASSWORD or render the ci secret to ${path} (run \`make ci\` or \`make e2e\`).`,
    );
  }
  return readFileSync(path, 'utf8').trim();
}

const baseUrl = process.env.E2E_BASE_URL ?? 'https://tricho.test';

let cached: APIRequestContext | null = null;

async function adminContext(): Promise<APIRequestContext> {
  if (cached) return cached;
  const password = loadCouchdbPassword();
  const auth = Buffer.from(`${COUCHDB_USER}:${password}`).toString('base64');
  cached = await request.newContext({
    baseURL: baseUrl,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      authorization: `Basic ${auth}`,
      // Tag every admin call so leakage greps in logs trivially.
      'user-agent': 'tricho-e2e-admin',
      accept: 'application/json',
    },
  });
  return cached;
}

export async function closeAdmin(): Promise<void> {
  if (cached) {
    await cached.dispose();
    cached = null;
  }
}

export function userDbHexFor(username: string): string {
  return Array.from(new TextEncoder().encode(username))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * GET a doc from a per-user database through the Traefik edge using ci-profile
 * admin credentials. `docPath` should look like `userdb-<hex>/<docid>`.
 */
export async function adminGet<T = unknown>(docPath: string): Promise<T> {
  const ctx = await adminContext();
  const res = await ctx.get(`/${docPath}`);
  if (!res.ok()) {
    throw new Error(`adminGet ${docPath}: HTTP ${res.status()} ${res.statusText()}`);
  }
  return (await res.json()) as T;
}

/**
 * PUT a doc to a per-user database through the Traefik edge using ci-profile
 * admin credentials. Used by the tamper test to mutate ciphertext on the
 * server, then watch Device B's reader reject it.
 */
export async function adminPut<T = unknown>(docPath: string, doc: unknown): Promise<T> {
  const ctx = await adminContext();
  const res = await ctx.put(`/${docPath}`, { data: doc });
  if (!res.ok()) {
    throw new Error(`adminPut ${docPath}: HTTP ${res.status()} ${res.statusText()}`);
  }
  return (await res.json()) as T;
}

/**
 * Find the first document in `userdb-<hex>/` whose `type` matches and return
 * its `_id`. Used to locate the customer doc the test just wrote without
 * needing to know its generated id.
 */
export async function adminFindDocId(username: string, type: string): Promise<{ _id: string; _rev: string } | null> {
  const dbHex = userDbHexFor(username);
  const ctx = await adminContext();
  const res = await ctx.post(`/userdb-${dbHex}/_find`, {
    data: { selector: { type }, limit: 5 },
  });
  if (!res.ok()) {
    throw new Error(`adminFindDocId: HTTP ${res.status()} ${res.statusText()}`);
  }
  const body = (await res.json()) as { docs: Array<{ _id: string; _rev: string }> };
  if (!body.docs.length) return null;
  return { _id: body.docs[0]!._id, _rev: body.docs[0]!._rev };
}
