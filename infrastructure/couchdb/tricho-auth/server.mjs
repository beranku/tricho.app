// tricho-auth entry point.
// Assembles the Meta adapter, JWT signer, and HTTP router; starts the server.

import fs from 'node:fs';
import http from 'node:http';
import { Meta } from './meta.mjs';
import { JwtSigner, generateKeypair } from './jwt.mjs';
import { createRouter } from './routes.mjs';

const COUCHDB_URL = process.env.COUCHDB_URL ?? 'http://couchdb:5984';
const ADMIN_USER = process.env.COUCHDB_ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.COUCHDB_ADMIN_PASSWORD ?? 'changeme';
const PORT = Number(process.env.PORT ?? 4545);
const META_DB = process.env.TRICHO_META_DB ?? 'tricho_meta';
const JWT_PRIVATE_KEY_PATH = process.env.TRICHO_AUTH_JWT_PRIVATE_KEY_PATH;
const JWT_PUBLIC_KEY_PATH = process.env.TRICHO_AUTH_JWT_PUBLIC_KEY_PATH;
const JWT_KID = process.env.TRICHO_AUTH_JWT_KID ?? `tricho-${new Date().getUTCFullYear()}`;
const DEV_KEY_DIR = process.env.TRICHO_AUTH_DEV_KEY_DIR;

const meta = new Meta({
  couchdbUrl: COUCHDB_URL,
  adminUser: ADMIN_USER,
  adminPassword: ADMIN_PASSWORD,
  dbName: META_DB,
});

/**
 * Returns { privatePem, publicPem }. Prefers explicit paths; falls back to a
 * persisted dev key in DEV_KEY_DIR; last resort generates in-memory (logged).
 */
function loadOrCreateKeys() {
  if (JWT_PRIVATE_KEY_PATH && JWT_PUBLIC_KEY_PATH) {
    return {
      privatePem: fs.readFileSync(JWT_PRIVATE_KEY_PATH, 'utf8'),
      publicPem: fs.readFileSync(JWT_PUBLIC_KEY_PATH, 'utf8'),
    };
  }
  const dir = DEV_KEY_DIR ?? '/tmp/tricho-auth-keys';
  fs.mkdirSync(dir, { recursive: true });
  const priv = `${dir}/jwt-private.pem`;
  const pub = `${dir}/jwt-public.pem`;
  if (fs.existsSync(priv) && fs.existsSync(pub)) {
    return { privatePem: fs.readFileSync(priv, 'utf8'), publicPem: fs.readFileSync(pub, 'utf8') };
  }
  const { privatePem, publicPem } = generateKeypair();
  fs.writeFileSync(priv, privatePem, { mode: 0o600 });
  fs.writeFileSync(pub, publicPem);
  console.log(`[tricho-auth] generated dev JWT keypair → ${dir}`);
  console.log(`[tricho-auth] add the public key to CouchDB local.ini:\n${publicPem}`);
  return { privatePem, publicPem };
}

const { privatePem, publicPem } = loadOrCreateKeys();
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

const router = createRouter({ meta, signer, env: process.env });
const server = http.createServer(router);

bootstrap().then(() => {
  server.listen(PORT, () => {
    console.log(`[tricho-auth] listening on :${PORT} → ${COUCHDB_URL}`);
  });
});
