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

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_AUTHORIZE = 'https://appleid.apple.com/auth/authorize';
const APPLE_TOKEN = 'https://appleid.apple.com/auth/token';
const APPLE_JWKS = new URL(`${APPLE_ISSUER}/auth/keys`);

const clientSecretCache = new Map(); // kid -> { jwt, exp }

async function clientSecret(config) {
  const cached = clientSecretCache.get(config.keyId);
  if (cached && cached.exp > Math.floor(Date.now() / 1000) + 60) return cached.jwt;

  const privateKey = await importPKCS8(config.privateKeyPem, 'ES256');
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 5 * 60; // Apple allows up to 6 months; 5 min is plenty.
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setAudience(APPLE_ISSUER)
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
    url: `${APPLE_AUTHORIZE}?${params.toString()}`,
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
  const res = await fetch(APPLE_TOKEN, {
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

  const jwks = createRemoteJWKSet(APPLE_JWKS);
  const { payload } = await jwtVerify(tokenBody.id_token, jwks, {
    issuer: APPLE_ISSUER,
    audience: config.clientId,
  });
  if (payload.nonce && payload.nonce !== nonce) throw new Error('nonce_mismatch');

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
  const email = payload.email ?? null;

  return {
    subject: payload.sub,
    email,
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
  };
}
