// Google OAuth 2.0 / OIDC provider.
//
// openid-client handles discovery + PKCE + id_token verification. We expose
// only two helpers: build the authorize URL, and validate a callback.

import { Issuer, generators } from 'openid-client';

let cachedClient = null;

async function getClient(config) {
  if (cachedClient) return cachedClient;
  const issuer = await Issuer.discover(config.issuerUrl);
  cachedClient = new issuer.Client({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uris: [config.redirectUri],
    response_types: ['code'],
  });
  return cachedClient;
}

export async function startAuthorize(config) {
  const client = await getClient(config);
  const state = generators.state();
  const nonce = generators.nonce();
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);

  const url = client.authorizationUrl({
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });

  return { url, state, nonce, codeVerifier };
}

export async function handleCallback(config, { query, state, nonce, codeVerifier }) {
  const client = await getClient(config);
  const params = client.callbackParams({ url: '/?' + new URLSearchParams(query).toString() });
  const tokenSet = await client.callback(config.redirectUri, params, {
    state,
    nonce,
    code_verifier: codeVerifier,
  });
  const claims = tokenSet.claims();
  if (claims.email_verified !== true) {
    throw new Error('email_not_verified');
  }
  return {
    subject: claims.sub,
    email: claims.email,
    name: claims.name ?? null,
    picture: claims.picture ?? null,
    provider: 'google',
  };
}

export function googleConfig(env) {
  const missing = [];
  if (!env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  if (!env.GOOGLE_REDIRECT_URI) missing.push('GOOGLE_REDIRECT_URI');
  if (missing.length) return null;
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
    // CI runs swap this for the mock-oidc container's base URL.
    issuerUrl: env.GOOGLE_ISSUER_URL ?? 'https://accounts.google.com',
  };
}
