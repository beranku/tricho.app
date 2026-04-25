// tricho-auth entry point.
// Assembles the Meta adapter, JWT signer, and HTTP router; starts the server.

import fs from 'node:fs';
import http from 'node:http';
import { createPublicKey } from 'node:crypto';
import { Meta } from './meta.mjs';
import { JwtSigner, generateKeypair } from './jwt.mjs';
import { createRouter } from './routes.mjs';
import { Entitlements } from './billing/entitlements.mjs';
import { createCouchProxy, USERDB_PATH_RE } from './billing/proxy.mjs';

// For every env var listed here, prefer the literal env value if set;
// otherwise, if `<name>_FILE` points at a readable file, load its contents
// into the env so downstream code can keep reading process.env.<name>
// without caring about how the value was provisioned. Trim trailing
// whitespace (Docker secret files often ship a trailing newline).
function hydrateFromSecretFiles(names) {
  for (const name of names) {
    if (process.env[name]) continue;
    const path = process.env[`${name}_FILE`];
    if (!path) continue;
    try {
      const contents = fs.readFileSync(path, 'utf8');
      const trimmed = contents.replace(/\s+$/, '');
      if (trimmed) process.env[name] = trimmed;
    } catch {
      // Missing / unreadable file → leave env unset; downstream code
      // either defaults or no-ops the feature (e.g., Google OAuth stays
      // disabled when its client secret isn't provisioned).
    }
  }
}

hydrateFromSecretFiles([
  'COUCHDB_ADMIN_PASSWORD',
  'TRICHO_AUTH_COOKIE_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'APPLE_CLIENT_SECRET',
]);

const COUCHDB_URL = process.env.COUCHDB_URL ?? 'http://couchdb:5984';
const ADMIN_USER = process.env.COUCHDB_ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.COUCHDB_ADMIN_PASSWORD ?? 'changeme';
const PORT = Number(process.env.PORT ?? 4545);
const META_DB = process.env.TRICHO_META_DB ?? 'tricho_meta';
const JWT_PRIVATE_KEY_PATH = process.env.TRICHO_AUTH_JWT_PRIVATE_KEY_PATH;
const JWT_PUBLIC_KEY_PATH = process.env.TRICHO_AUTH_JWT_PUBLIC_KEY_PATH;
const JWT_KID = process.env.TRICHO_AUTH_JWT_KID ?? `tricho-${new Date().getUTCFullYear()}`;
const DEV_KEY_DIR = process.env.TRICHO_AUTH_DEV_KEY_DIR;
const SHARED_JWT_DIR = process.env.TRICHO_AUTH_SHARED_JWT_DIR ?? '/shared/jwt';

const meta = new Meta({
  couchdbUrl: COUCHDB_URL,
  adminUser: ADMIN_USER,
  adminPassword: ADMIN_PASSWORD,
  dbName: META_DB,
});

/**
 * Returns { privatePem, publicPem, source }. Resolution order:
 *   1. TRICHO_AUTH_JWT_PRIVATE_KEY_PATH file (Docker secret in prod/ci).
 *      Public key is derived from the private key — no separate public mount.
 *   2. DEV_KEY_DIR/jwt-private.pem (persisted across container restarts in
 *      dev mode when no secret is mounted).
 *   3. Freshly generated keypair, persisted to DEV_KEY_DIR for next boot.
 *
 * The legacy TRICHO_AUTH_JWT_PUBLIC_KEY_PATH is still honored for backward
 * compatibility, but is no longer required.
 */
function loadOrCreateKeys() {
  const mountedPrivate = readNonEmpty(JWT_PRIVATE_KEY_PATH);
  if (mountedPrivate) {
    const publicPem =
      readNonEmpty(JWT_PUBLIC_KEY_PATH) ?? derivePublicPem(mountedPrivate);
    return { privatePem: mountedPrivate, publicPem, source: 'mounted' };
  }
  const dir = DEV_KEY_DIR ?? '/tmp/tricho-auth-keys';
  fs.mkdirSync(dir, { recursive: true });
  const priv = `${dir}/jwt-private.pem`;
  const pub = `${dir}/jwt-public.pem`;
  const existingPriv = readNonEmpty(priv);
  const existingPub = readNonEmpty(pub);
  if (existingPriv && existingPub) {
    return { privatePem: existingPriv, publicPem: existingPub, source: 'dev-dir' };
  }
  const { privatePem, publicPem } = generateKeypair();
  fs.writeFileSync(priv, privatePem, { mode: 0o600 });
  fs.writeFileSync(pub, publicPem);
  console.log(`[tricho-auth] generated dev JWT keypair → ${dir}`);
  return { privatePem, publicPem, source: 'generated' };
}

function readNonEmpty(path) {
  if (!path) return null;
  try {
    const contents = fs.readFileSync(path, 'utf8');
    return contents.includes('BEGIN') ? contents : null;
  } catch {
    return null;
  }
}

function derivePublicPem(privatePem) {
  return createPublicKey(privatePem)
    .export({ format: 'pem', type: 'spki' })
    .toString();
}

/**
 * Atomically publish the current public key into the shared volume that
 * CouchDB's entrypoint shim reads. Write-to-temp + rename keeps partial
 * writes invisible to the consumer. Missing directory (non-compose run) is
 * a soft warning — prod always has this mount.
 */
function publishPublicKey(publicPem) {
  try {
    fs.mkdirSync(SHARED_JWT_DIR, { recursive: true });
    const dest = `${SHARED_JWT_DIR}/jwt-public.pem`;
    const tmp = `${dest}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, publicPem, { mode: 0o644 });
    fs.renameSync(tmp, dest);
    console.log(`[tricho-auth] published public key → ${dest}`);
  } catch (err) {
    console.warn(`[tricho-auth] could not publish public key to ${SHARED_JWT_DIR}: ${err.message}`);
  }
}

const { privatePem, publicPem, source: keySource } = loadOrCreateKeys();
console.log(`[tricho-auth] using ${keySource} JWT key (kid=${JWT_KID})`);
publishPublicKey(publicPem);
const signer = new JwtSigner({ privatePem, publicPem, kid: JWT_KID });

async function bootstrap() {
  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await meta.ensureDatabase();
      console.log(`[tricho-auth] meta database "${META_DB}" ready`);
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      console.warn(`[tricho-auth] bootstrap attempt ${attempt}/${maxAttempts} failed:`, err.message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

const entitlements = new Entitlements({ meta });

// Billing flag — when false, the proxy is mounted but waves all requests
// through. This lets us deploy the proxy ahead of flipping enforcement.
const BILLING_ENABLED = process.env.BILLING_ENABLED === 'true';

const couchProxy = createCouchProxy({
  couchdbUrl: COUCHDB_URL,
  couchdbAuthHeader: 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
  signer,
  entitlements,
  billingEnabled: BILLING_ENABLED,
});

const router = createRouter({ meta, signer, env: process.env, entitlements });

function handler(req, res) {
  // Route /userdb-* paths through the entitlement proxy; everything else
  // continues to the existing router.
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  if (USERDB_PATH_RE.test(url.pathname)) {
    return couchProxy(req, res);
  }
  return router(req, res);
}

const server = http.createServer(handler);

bootstrap().then(() => {
  server.listen(PORT, () => {
    console.log(`[tricho-auth] listening on :${PORT} → ${COUCHDB_URL}`);
  });
  maybeStartBackupCron();
});

function maybeStartBackupCron() {
  if (process.env.BACKUP_CRON_ENABLED !== 'true') return;
  const intervalHours = Number.parseFloat(process.env.BACKUP_CRON_INTERVAL_HOURS ?? '24');
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) return;
  const intervalMs = Math.round(intervalHours * 60 * 60 * 1000);
  console.log(`[tricho-auth] backup cron enabled, interval=${intervalHours}h`);

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { runBackupCron } = await import('./billing/backup-cron.mjs');
      const result = await runBackupCron({ meta, env: process.env });
      console.log(`[tricho-auth] backup cron run`, JSON.stringify(result));
    } catch (err) {
      console.error('[tricho-auth] backup cron failed', err);
    } finally {
      running = false;
    }
  };
  // Run once at boot (after a short delay so HTTP is up first), then on the interval.
  setTimeout(() => { void tick(); }, 30_000).unref?.();
  setInterval(() => { void tick(); }, intervalMs).unref?.();
}
