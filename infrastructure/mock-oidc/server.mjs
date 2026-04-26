// Mock OIDC provider for TrichoApp CI runs.
//
// Two tenants live behind path prefixes:
//   /google/*  — Google-shaped: discovery + PKCE + RS256 id_token + GET /authorize
//                redirect callback.
//   /apple/*   — Apple-shaped: NO discovery doc, RS256 id_token (real Apple is
//                ES256 but for the mock RS256 is enough), POST `form_post`
//                callback, per-`sub` first-vs-returning `name` semantics,
//                optional private-relay email shape.
//
// Top-level routes (`/.well-known/openid-configuration`, `/authorize`,
// `/token`, `/userinfo`, `/mock/identity`) are kept as backwards-compatible
// aliases to `/google/*` so existing e2e tests do not have to move in
// lockstep. A follow-up change can flip GOOGLE_ISSUER_URL to point at the
// `/google` prefix and remove the aliases.
//
// NOT for production — ships only under the `ci` compose profile.

import http from 'node:http';
import crypto from 'node:crypto';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';

const PORT = Number(process.env.PORT ?? 8080);
const ISSUER_BASE = (process.env.MOCK_OIDC_ISSUER ?? `http://mock-oidc:${PORT}`).replace(/\/+$/, '');
const PUBLIC_BASE = (process.env.MOCK_OIDC_PUBLIC_BASE ?? 'https://tricho.test/mock-oidc').replace(/\/+$/, '');
const INTERNAL_BASE = (process.env.MOCK_OIDC_INTERNAL_BASE ?? `http://mock-oidc:${PORT}`).replace(/\/+$/, '');
const KID = 'mock-oidc-rsa-1';

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: KID, use: 'sig', alg: 'RS256' }] };

// ── Tenant state ────────────────────────────────────────────────────────────
// Each tenant has its own currently-selected identity (mutated via
// /<tenant>/mock/identity) and its own per-sub "has authorized once" flag
// (used by the Apple tenant to drive the first-vs-returning `name` semantics).

function defaultGoogleIdentity() {
  return {
    sub: 'mock-sub-default',
    email: 'e2e@tricho.test',
    email_verified: true,
    name: 'E2E User',
    picture: null,
  };
}

function defaultAppleIdentity() {
  return {
    sub: 'mock-apple-sub-default',
    email: 'apple-e2e@tricho.test',
    email_verified: true,
    is_private_email: false,
    name: { firstName: 'Apple', lastName: 'User' },
  };
}

const tenants = {
  google: {
    currentIdentity: defaultGoogleIdentity(),
    authorizedOnce: new Set(),
    flavor: 'google',
  },
  apple: {
    currentIdentity: defaultAppleIdentity(),
    authorizedOnce: new Set(),
    flavor: 'apple',
  },
};

// Short-lived auth codes → {tenant, identity, nonce, code_challenge, client_id}.
const codes = new Map();

// ── HTTP helpers ────────────────────────────────────────────────────────────

function json(res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

function html(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (!buf.length) return resolve({});
      const type = req.headers['content-type'] ?? '';
      try {
        if (type.includes('application/json')) resolve(JSON.parse(buf.toString('utf8')));
        else if (type.includes('application/x-www-form-urlencoded'))
          resolve(Object.fromEntries(new URLSearchParams(buf.toString('utf8'))));
        else resolve({ raw: buf.toString('utf8') });
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function base64urlNoPad(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function verifyPkce(codeVerifier, codeChallenge, method) {
  if (method === 'plain') return codeVerifier === codeChallenge;
  if (method === 'S256') {
    const hash = crypto.createHash('sha256').update(codeVerifier).digest();
    return base64urlNoPad(hash) === codeChallenge;
  }
  return false;
}

// ── Tenant-shaped identities ────────────────────────────────────────────────

function applyAppleIdentityShape(identity) {
  // If is_private_email is set, make sure the email shape matches Apple's
  // private-relay convention regardless of what the test seeded.
  if (identity.is_private_email && (!identity.email || !/@privaterelay\.appleid\.com$/i.test(identity.email))) {
    return {
      ...identity,
      email: `${(identity.sub ?? 'unknown').replace(/[^a-z0-9]/gi, '')}@privaterelay.appleid.com`,
    };
  }
  return identity;
}

// ── Discovery / JWKS / identity-control endpoints (per tenant) ──────────────

function discoveryDoc(tenant) {
  const tenantIssuer = `${ISSUER_BASE}/${tenant}`;
  return {
    issuer: tenantIssuer,
    authorization_endpoint: `${PUBLIC_BASE}/${tenant}/authorize`,
    token_endpoint: `${INTERNAL_BASE}/${tenant}/token`,
    userinfo_endpoint: `${INTERNAL_BASE}/${tenant}/userinfo`,
    jwks_uri: `${INTERNAL_BASE}/${tenant}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'email', 'profile'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    code_challenge_methods_supported: ['S256', 'plain'],
  };
}

// Mints a token-and-identity payload for the code in `entry`. Tenant-specific
// shaping (e.g. Apple's first-vs-returning `name`, private-relay) happens in
// the per-tenant /token handlers, not here.
async function mintIdToken({ entry, tenantIssuer, claims }) {
  const now = Math.floor(Date.now() / 1000);
  const idToken = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: KID, typ: 'JWT' })
    .setIssuer(tenantIssuer)
    .setSubject(entry.identity.sub)
    .setAudience(entry.client_id ?? 'mock-client')
    .setIssuedAt(now)
    .setExpirationTime(now + (entry.expiresIn ?? 3600))
    .sign(privateKey);
  const accessToken = base64urlNoPad(crypto.randomBytes(24));
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: entry.expiresIn ?? 3600,
    id_token: idToken,
    scope: 'openid email profile',
  };
}

// ── Per-tenant route handlers ───────────────────────────────────────────────

async function handleTenantRoute({ req, res, tenantName, subPath, url }) {
  const tenant = tenants[tenantName];
  if (!tenant) return false;
  const tenantIssuer = `${ISSUER_BASE}/${tenantName}`;

  // Discovery
  if (req.method === 'GET' && subPath === '/.well-known/openid-configuration') {
    json(res, 200, discoveryDoc(tenantName));
    return true;
  }
  // JWKS — Google convention is /<tenant>/.well-known/jwks.json
  // Apple convention (matching real Apple) is /<tenant>/auth/keys
  if (
    req.method === 'GET' &&
    (subPath === '/.well-known/jwks.json' || (tenantName === 'apple' && subPath === '/auth/keys'))
  ) {
    json(res, 200, jwks, { 'cache-control': 'public, max-age=60' });
    return true;
  }

  // Authorize endpoint paths differ between Google (`/authorize`) and Apple
  // (`/auth/authorize`). Both also accept the short form for convenience.
  if (
    req.method === 'GET' &&
    (subPath === '/authorize' || (tenantName === 'apple' && subPath === '/auth/authorize'))
  ) {
    return handleAuthorize({ req, res, tenant, tenantName, url });
  }

  if (
    req.method === 'POST' &&
    (subPath === '/token' || (tenantName === 'apple' && subPath === '/auth/token'))
  ) {
    return handleToken({ req, res, tenant, tenantName, tenantIssuer });
  }

  if (req.method === 'GET' && subPath === '/userinfo') {
    json(res, 200, {
      sub: tenant.currentIdentity.sub,
      email: tenant.currentIdentity.email,
      email_verified: tenant.currentIdentity.email_verified,
      name: typeof tenant.currentIdentity.name === 'string' ? tenant.currentIdentity.name : null,
      picture: tenant.currentIdentity.picture ?? null,
    });
    return true;
  }

  // Test-control endpoints — present on every tenant.
  if (req.method === 'POST' && subPath === '/mock/identity') {
    const body = await readBody(req);
    if (tenantName === 'google') {
      tenant.currentIdentity = {
        sub: String(body.sub ?? defaultGoogleIdentity().sub),
        email: String(body.email ?? defaultGoogleIdentity().email),
        email_verified: body.email_verified !== false,
        name: body.name ?? null,
        picture: body.picture ?? null,
      };
    } else {
      tenant.currentIdentity = applyAppleIdentityShape({
        sub: String(body.sub ?? defaultAppleIdentity().sub),
        email: body.email ?? defaultAppleIdentity().email,
        email_verified: body.email_verified !== false,
        is_private_email: body.is_private_email === true,
        name: body.name ?? null, // {firstName, lastName} or null
      });
    }
    json(res, 200, { ok: true, identity: tenant.currentIdentity });
    return true;
  }

  if (req.method === 'POST' && subPath === '/mock/reset') {
    const body = await readBody(req);
    if (body.sub) tenant.authorizedOnce.delete(String(body.sub));
    else tenant.authorizedOnce.clear();
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}

function handleAuthorize({ req, res, tenant, tenantName, url }) {
  const q = Object.fromEntries(url.searchParams);
  const redirect = q.redirect_uri;
  if (!redirect) {
    json(res, 400, { error: 'missing redirect_uri' });
    return true;
  }
  const code = base64urlNoPad(crypto.randomBytes(24));
  const expiresIn = q.expires_in ? Number(q.expires_in) : undefined;
  codes.set(code, {
    tenant: tenantName,
    identity: { ...tenant.currentIdentity },
    nonce: q.nonce ?? null,
    code_challenge: q.code_challenge ?? null,
    code_challenge_method: q.code_challenge_method ?? null,
    client_id: q.client_id ?? null,
    redirect_uri: redirect,
    expiresAt: Date.now() + 5 * 60 * 1000,
    response_mode: q.response_mode ?? null,
    state: q.state ?? null,
    expiresIn,
  });

  // Apple uses form_post — emit a self-submitting HTML form so the browser
  // does the POST exactly like real Apple does. Google (and any other
  // response_mode) gets a 302 redirect with the code on the query string.
  if (tenantName === 'apple' && q.response_mode === 'form_post') {
    const userField =
      !tenant.authorizedOnce.has(tenant.currentIdentity.sub) && tenant.currentIdentity.name
        ? JSON.stringify({ name: tenant.currentIdentity.name })
        : null;
    // We mark "first-time-seen" only when the token is actually exchanged
    // for an id_token (in /token), not here, so a test that walks /authorize
    // without exchanging doesn't accidentally consume the first-time flag.
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fields = [
      `<input type="hidden" name="state" value="${escape(q.state ?? '')}"/>`,
      `<input type="hidden" name="code" value="${escape(code)}"/>`,
    ];
    if (userField) fields.push(`<input type="hidden" name="user" value="${escape(userField)}"/>`);
    // For token-flavored Apple auth (response_type includes id_token), real
    // Apple ALSO posts the id_token here. We omit it; tricho-auth always
    // exchanges the code for a token even when both are sent.
    res.end(`<!doctype html><html><body onload="document.forms[0].submit()"><form method="POST" action="${escape(redirect)}">${fields.join('')}</form></body></html>`);
    return true;
  }

  const target = new URL(redirect);
  target.searchParams.set('code', code);
  if (q.state) target.searchParams.set('state', q.state);
  res.writeHead(302, { location: target.toString() });
  res.end();
  return true;
}

async function handleToken({ req, res, tenant, tenantName, tenantIssuer }) {
  const body = await readBody(req);
  const entry = codes.get(body.code);
  codes.delete(body.code);
  if (!entry || entry.expiresAt < Date.now()) {
    json(res, 400, { error: 'invalid_grant' });
    return true;
  }
  if (entry.tenant !== tenantName) {
    json(res, 400, { error: 'invalid_grant', error_description: 'tenant mismatch' });
    return true;
  }
  if (entry.code_challenge && !verifyPkce(body.code_verifier ?? '', entry.code_challenge, entry.code_challenge_method)) {
    json(res, 400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
    return true;
  }
  if (entry.redirect_uri !== body.redirect_uri) {
    json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    return true;
  }

  const claims = { nonce: entry.nonce ?? undefined };
  if (tenantName === 'google') {
    claims.email = entry.identity.email;
    claims.email_verified = entry.identity.email_verified;
    claims.name = entry.identity.name;
    claims.picture = entry.identity.picture;
  } else {
    claims.email = entry.identity.email;
    claims.email_verified = entry.identity.email_verified;
    claims.is_private_email = entry.identity.is_private_email === true;
    // Apple does NOT include `name` in id_token claims; the firstName/lastName
    // arrives via the `user` form field on the first authorization. We mark
    // the sub as seen on token exchange so a second `/authorize` for the same
    // sub omits the `user` field.
    tenant.authorizedOnce.add(entry.identity.sub);
  }
  const tokens = await mintIdToken({ entry, tenantIssuer, claims });
  json(res, 200, tokens);
  return true;
}

// ── Top-level alias router (legacy /authorize, /token, /mock/identity) ──────
// Maps a top-level path to the equivalent path under /google/.

function aliasToGoogle(path) {
  if (path.startsWith('/google/')) return null;
  if (path.startsWith('/apple/')) return null;
  if (
    path === '/.well-known/openid-configuration' ||
    path === '/.well-known/jwks.json' ||
    path === '/authorize' ||
    path === '/token' ||
    path === '/userinfo' ||
    path === '/mock/identity' ||
    path === '/mock/reset'
  ) {
    return `/google${path === '/' ? '' : path}`;
  }
  return null;
}

// ── Top-level dispatcher ────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === '/health' && req.method === 'GET') {
    return json(res, 200, { ok: true });
  }

  // Tenant-prefixed paths.
  for (const tenantName of Object.keys(tenants)) {
    const prefix = `/${tenantName}`;
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      const subPath = path.slice(prefix.length) || '/';
      const handled = await handleTenantRoute({ req, res, tenantName, subPath, url });
      if (handled) return;
      return json(res, 404, { error: 'not_found' });
    }
  }

  // Backwards-compat aliases — top-level routes map to /google/*.
  const aliased = aliasToGoogle(path);
  if (aliased) {
    const subPath = aliased.slice('/google'.length) || '/';
    const handled = await handleTenantRoute({ req, res, tenantName: 'google', subPath, url });
    if (handled) return;
  }

  json(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => {
  console.log(`[mock-oidc] listening on :${PORT}, issuer=${ISSUER_BASE}`);
  console.log(`[mock-oidc] tenants: /google, /apple`);
  console.log(`[mock-oidc] google authorize (public) = ${PUBLIC_BASE}/google/authorize`);
  console.log(`[mock-oidc] apple authorize (public)  = ${PUBLIC_BASE}/apple/authorize`);
});
