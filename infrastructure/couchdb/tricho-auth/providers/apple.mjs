// Apple Sign In / OIDC provider.
//
// Apple quirks that matter vs Google:
//   1. The "client secret" is a JWT we mint ourselves, signed ES256 with an
//      Apple-issued private key (.p8 file).
//   2. The callback is a POST form_post, not a GET query. We accept
//      application/x-www-form-urlencoded on the callback route.
//   3. `name` and `email` are returned ONLY on the very first authorization.
//      Subsequent sign-ins give just `sub` — callers must persist name+email
//      on the first pass.

import fs from 'node:fs';
import { SignJWT, jwtVerify, createRemoteJWKSet, importPKCS8 } from 'jose';

// Apple does not publish a `.well-known/openid-configuration`, so we derive
// the four endpoint URLs from a single issuer base. Production resolves to
// https://appleid.apple.com; CI overrides via APPLE_OIDC_ISSUER to point at
// the in-stack mock-oidc Apple tenant.
const DEFAULT_APPLE_ISSUER = 'https://appleid.apple.com';

export function resolveAppleEndpoints(issuer) {
  const base = (issuer ?? DEFAULT_APPLE_ISSUER).replace(/\/+$/, '');
  return {
    issuer: base,
    authorize: `${base}/auth/authorize`,
    token: `${base}/auth/token`,
    jwks: new URL(`${base}/auth/keys`),
  };
}

const clientSecretCache = new Map(); // kid -> { jwt, exp }

async function clientSecret(config) {
  const cached = clientSecretCache.get(config.keyId);
  if (cached && cached.exp > Math.floor(Date.now() / 1000) + 60) return cached.jwt;

  const privateKey = await importPKCS8(config.privateKeyPem, 'ES256');
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 5 * 60; // Apple allows up to 6 months; 5 min is plenty.
  // The client_secret JWT's `aud` is the issuer URL of the IdP (Apple in
  // prod, mock-oidc in CI). Apple validates this; the mock skips validation
  // but we still mint a correctly-shaped JWT for parity.
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setAudience(config.endpoints.issuer)
    .setSubject(config.clientId)
    .sign(privateKey);
  clientSecretCache.set(config.keyId, { jwt, exp });
  return jwt;
}

function randomToken() {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}

export async function startAuthorize(config) {
  const state = randomToken();
  const nonce = randomToken();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code id_token',
    scope: 'name email',
    response_mode: 'form_post',
    state,
    nonce,
  });
  return {
    url: `${config.endpoints.authorize}?${params.toString()}`,
    state,
    nonce,
    codeVerifier: null, // Apple does not support PKCE public-client style
  };
}

export async function handleCallback(config, { form, state, nonce }) {
  if (form.state !== state) throw new Error('state_mismatch');
  if (form.error) throw new Error(`apple_error:${form.error}`);
  if (!form.code) throw new Error('missing_code');

  const secret = await clientSecret(config);
  const res = await fetch(config.endpoints.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: secret,
      code: form.code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    }).toString(),
  });
  if (!res.ok) throw new Error(`apple_token_failed:${res.status}`);
  const tokenBody = await res.json();
  if (!tokenBody.id_token) throw new Error('no_id_token');

  const jwks = createRemoteJWKSet(config.endpoints.jwks);
  const { payload } = await jwtVerify(tokenBody.id_token, jwks, {
    issuer: config.endpoints.issuer,
    audience: config.clientId,
  });
  if (payload.nonce && payload.nonce !== nonce) throw new Error('nonce_mismatch');

  // Private-relay emails (`*@privaterelay.appleid.com`) are verified by
  // construction — Apple proxies them. For non-relay addresses, we require
  // an explicit email_verified === true (parity with Google).
  const emailFromPayload = payload.email ?? null;
  const isPrivateRelay =
    payload.is_private_email === true ||
    (typeof emailFromPayload === 'string' && /@privaterelay\.appleid\.com$/i.test(emailFromPayload));
  if (!isPrivateRelay && payload.email_verified !== true) {
    throw new Error('email_not_verified');
  }

  // Apple only returns user info ON THE FIRST AUTHORIZATION, and it comes via
  // the `user` form field (JSON-encoded). Subsequent authorizations omit it.
  let name = null;
  if (form.user) {
    try {
      const parsed = JSON.parse(form.user);
      if (parsed?.name) {
        const first = parsed.name.firstName ?? '';
        const last = parsed.name.lastName ?? '';
        const combined = `${first} ${last}`.trim();
        if (combined) name = combined;
      }
    } catch {
      // Malformed — best-effort.
    }
  }
  return {
    subject: payload.sub,
    email: emailFromPayload,
    name,
    picture: null, // Apple never provides a picture.
    provider: 'apple',
  };
}

export function appleConfig(env) {
  const missing = [];
  if (!env.APPLE_CLIENT_ID) missing.push('APPLE_CLIENT_ID');
  if (!env.APPLE_TEAM_ID) missing.push('APPLE_TEAM_ID');
  if (!env.APPLE_KEY_ID) missing.push('APPLE_KEY_ID');
  if (!env.APPLE_REDIRECT_URI) missing.push('APPLE_REDIRECT_URI');
  if (missing.length) return null;

  // Either the PEM is supplied directly or via a file path.
  let privateKeyPem = env.APPLE_PRIVATE_KEY;
  if (!privateKeyPem && env.APPLE_PRIVATE_KEY_PATH) {
    privateKeyPem = fs.readFileSync(env.APPLE_PRIVATE_KEY_PATH, 'utf8');
  }
  if (!privateKeyPem) return null;

  return {
    clientId: env.APPLE_CLIENT_ID,
    teamId: env.APPLE_TEAM_ID,
    keyId: env.APPLE_KEY_ID,
    redirectUri: env.APPLE_REDIRECT_URI,
    privateKeyPem,
    endpoints: resolveAppleEndpoints(env.APPLE_OIDC_ISSUER),
  };
}
