// Mock OIDC provider for TrichoApp CI runs.
//
// Implements just enough of Google's discovery + PKCE + id_token flow that
// openid-client (as used by providers/google.mjs) treats it as a real IdP.
// Two URL schemes in the discovery document keep browser + backend flows
// happy: authorization_endpoint is the public Traefik URL (so the browser
// can reach it), token/userinfo/jwks live at the internal service name (so
// tricho-auth talks to us without needing to trust the self-signed TLS).
//
// NOT for production — ships only under the `ci` compose profile.

import http from 'node:http';
import crypto from 'node:crypto';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';

const PORT = Number(process.env.PORT ?? 8080);
// Issuer claim put into id_tokens — MUST match what tricho-auth's discovery
// request resolves (i.e., the base URL of this service).
const ISSUER = process.env.MOCK_OIDC_ISSUER ?? `http://mock-oidc:${PORT}`;
// Public base URL reachable from the browser (through Traefik).
const PUBLIC_BASE = process.env.MOCK_OIDC_PUBLIC_BASE ?? 'https://tricho.test/mock-oidc';
// Internal base URL reachable from tricho-auth over the docker network.
const INTERNAL_BASE = process.env.MOCK_OIDC_INTERNAL_BASE ?? `http://mock-oidc:${PORT}`;
const KID = 'mock-oidc-rsa-1';

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: KID, use: 'sig', alg: 'RS256' }] };

// Currently-selected identity — tests POST to /mock/identity to change it.
// Defaults let the smoke suite run without extra setup.
let currentIdentity = {
  sub: 'mock-sub-default',
  email: 'e2e@tricho.test',
  email_verified: true,
  name: 'E2E User',
  picture: null,
};

// Short-lived auth codes → {identity, nonce, code_challenge, client_id}.
const codes = new Map();

function json(res, status, body, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // Discovery — tells openid-client every other endpoint.
  if (req.method === 'GET' && path === '/.well-known/openid-configuration') {
    return json(res, 200, {
      issuer: ISSUER,
      authorization_endpoint: `${PUBLIC_BASE}/authorize`,
      token_endpoint: `${INTERNAL_BASE}/token`,
      userinfo_endpoint: `${INTERNAL_BASE}/userinfo`,
      jwks_uri: `${INTERNAL_BASE}/.well-known/jwks.json`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'email', 'profile'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256', 'plain'],
    });
  }

  if (req.method === 'GET' && path === '/.well-known/jwks.json') {
    return json(res, 200, jwks, { 'cache-control': 'public, max-age=60' });
  }

  // Authorize — skip UI; mint a code tied to the current mock identity and
  // redirect straight back to the client's callback.
  if (req.method === 'GET' && path === '/authorize') {
    const q = Object.fromEntries(url.searchParams);
    const redirect = q.redirect_uri;
    if (!redirect) return json(res, 400, { error: 'missing redirect_uri' });
    const code = base64urlNoPad(crypto.randomBytes(24));
    codes.set(code, {
      identity: { ...currentIdentity },
      nonce: q.nonce ?? null,
      code_challenge: q.code_challenge ?? null,
      code_challenge_method: q.code_challenge_method ?? null,
      client_id: q.client_id ?? null,
      redirect_uri: redirect,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    const target = new URL(redirect);
    target.searchParams.set('code', code);
    if (q.state) target.searchParams.set('state', q.state);
    res.writeHead(302, { location: target.toString() });
    return res.end();
  }

  if (req.method === 'POST' && path === '/token') {
    const body = await readBody(req);
    const entry = codes.get(body.code);
    codes.delete(body.code);
    if (!entry || entry.expiresAt < Date.now())
      return json(res, 400, { error: 'invalid_grant' });
    if (entry.code_challenge && !verifyPkce(body.code_verifier ?? '', entry.code_challenge, entry.code_challenge_method))
      return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
    if (entry.redirect_uri !== body.redirect_uri)
      return json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });

    const now = Math.floor(Date.now() / 1000);
    const idToken = await new SignJWT({
      email: entry.identity.email,
      email_verified: entry.identity.email_verified,
      name: entry.identity.name,
      picture: entry.identity.picture,
      nonce: entry.nonce ?? undefined,
    })
      .setProtectedHeader({ alg: 'RS256', kid: KID, typ: 'JWT' })
      .setIssuer(ISSUER)
      .setSubject(entry.identity.sub)
      .setAudience(entry.client_id ?? 'mock-client')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(privateKey);
    const accessToken = base64urlNoPad(crypto.randomBytes(24));
    return json(res, 200, {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: idToken,
      scope: 'openid email profile',
    });
  }

  if (req.method === 'GET' && path === '/userinfo') {
    // We don't track access tokens to mock identities; just return the
    // current identity. Good enough for E2E's purposes.
    return json(res, 200, {
      sub: currentIdentity.sub,
      email: currentIdentity.email,
      email_verified: currentIdentity.email_verified,
      name: currentIdentity.name,
      picture: currentIdentity.picture,
    });
  }

  // Test-control endpoint — select which identity the next /authorize uses.
  if (req.method === 'POST' && path === '/mock/identity') {
    const body = await readBody(req);
    currentIdentity = {
      sub: String(body.sub ?? 'mock-sub-default'),
      email: String(body.email ?? 'e2e@tricho.test'),
      email_verified: body.email_verified !== false,
      name: body.name ?? null,
      picture: body.picture ?? null,
    };
    return json(res, 200, { ok: true, identity: currentIdentity });
  }

  if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true });

  return json(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => {
  console.log(`[mock-oidc] listening on :${PORT}, issuer=${ISSUER}`);
  console.log(`[mock-oidc] authorize (public) = ${PUBLIC_BASE}/authorize`);
  console.log(`[mock-oidc] token (internal)   = ${INTERNAL_BASE}/token`);
});
