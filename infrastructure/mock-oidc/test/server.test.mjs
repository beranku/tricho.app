import { describe, it, expect, beforeAll } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import { importJWK, jwtVerify } from 'jose';

// Boot the real mock-oidc server on a random free port, then talk to it
// over HTTP. The module listens as a top-level side effect, so we set
// PORT before importing and let the process's default-loop keep it
// alive for the test duration.

describe('mock-oidc (in-process)', () => {
  let localBase;

  beforeAll(async () => {
    // Pick a free port by opening+closing a throwaway server.
    const tmp = http.createServer();
    await new Promise((r) => tmp.listen(0, r));
    const port = tmp.address().port;
    tmp.close();
    process.env.PORT = String(port);
    process.env.MOCK_OIDC_INTERNAL_BASE = `http://localhost:${port}`;
    process.env.MOCK_OIDC_ISSUER = `http://localhost:${port}`;
    process.env.MOCK_OIDC_PUBLIC_BASE = `http://localhost:${port}`;

    // Static path — Vite's dynamic-import checker doesn't tolerate
    // templated specifiers; rely on Node's one-time module cache.
    await import('../server.mjs');
    localBase = `http://localhost:${port}`;
    // give the listen() callback a tick to fire
    await new Promise((r) => setTimeout(r, 50));
  }, 15_000);

  it('publishes a discovery document with required OIDC fields', async () => {
    const r = await fetch(`${localBase}/.well-known/openid-configuration`);
    expect(r.ok).toBe(true);
    const d = await r.json();
    expect(d.issuer).toContain('http');
    expect(d.authorization_endpoint).toMatch(/\/authorize$/);
    expect(d.token_endpoint).toMatch(/\/token$/);
    expect(d.jwks_uri).toMatch(/jwks/);
    expect(d.id_token_signing_alg_values_supported).toContain('RS256');
    expect(d.code_challenge_methods_supported).toEqual(expect.arrayContaining(['S256']));
  });

  it('publishes a JWKS whose key can be imported', async () => {
    const r = await fetch(`${localBase}/.well-known/jwks.json`);
    const jwks = await r.json();
    expect(jwks.keys).toHaveLength(1);
    const key = await importJWK(jwks.keys[0], 'RS256');
    expect(key).toBeDefined();
  });

  it('authorize → code → token round-trip issues a verifiable id_token', async () => {
    // 1. Set the next identity.
    await fetch(`${localBase}/mock/identity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub: 'mock-sub-rt', email: 'rt@test', email_verified: true }),
    });

    // 2. Drive authorize with PKCE.
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    const authUrl = new URL(`${localBase}/authorize`);
    authUrl.searchParams.set('client_id', 'test-client');
    authUrl.searchParams.set('redirect_uri', 'http://client/cb');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid');
    authUrl.searchParams.set('state', 'st');
    authUrl.searchParams.set('nonce', 'no');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    const authRes = await fetch(authUrl, { redirect: 'manual' });
    expect(authRes.status).toBe(302);
    const location = authRes.headers.get('location');
    const code = new URL(location).searchParams.get('code');
    expect(code).toBeTruthy();

    // 3. Exchange the code for a token.
    const tokenRes = await fetch(`${localBase}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://client/cb',
        code_verifier: verifier,
      }).toString(),
    });
    expect(tokenRes.ok).toBe(true);
    const tokens = await tokenRes.json();
    expect(tokens.id_token).toMatch(/^ey/);
    expect(tokens.token_type).toBe('Bearer');

    // 4. Verify the id_token against the JWKS.
    const jwks = await (await fetch(`${localBase}/.well-known/jwks.json`)).json();
    const pub = await importJWK(jwks.keys[0], 'RS256');
    const { payload } = await jwtVerify(tokens.id_token, pub);
    expect(payload.sub).toBe('mock-sub-rt');
    expect(payload.email).toBe('rt@test');
    expect(payload.email_verified).toBe(true);
    expect(payload.nonce).toBe('no');
  }, 15_000);

  it('PKCE verifier mismatch yields invalid_grant', async () => {
    await fetch(`${localBase}/mock/identity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub: 'mock-sub-pkce', email: 'p@t', email_verified: true }),
    });
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const authUrl = new URL(`${localBase}/authorize`);
    authUrl.searchParams.set('client_id', 'test');
    authUrl.searchParams.set('redirect_uri', 'http://client/cb');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    const authRes = await fetch(authUrl, { redirect: 'manual' });
    const code = new URL(authRes.headers.get('location')).searchParams.get('code');

    // Send a DIFFERENT verifier.
    const wrong = crypto.randomBytes(32).toString('base64url');
    const tokenRes = await fetch(`${localBase}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://client/cb',
        code_verifier: wrong,
      }).toString(),
    });
    expect(tokenRes.status).toBe(400);
    const body = await tokenRes.json();
    expect(body.error).toBe('invalid_grant');
  });

  it('POST /mock/identity mutates the next authorize response', async () => {
    await fetch(`${localBase}/mock/identity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub: 'mutated-sub', email: 'x@y', email_verified: true }),
    });
    const authUrl = new URL(`${localBase}/authorize`);
    authUrl.searchParams.set('client_id', 'c');
    authUrl.searchParams.set('redirect_uri', 'http://client/cb');
    authUrl.searchParams.set('response_type', 'code');
    const r = await fetch(authUrl, { redirect: 'manual' });
    const code = new URL(r.headers.get('location')).searchParams.get('code');
    const tr = await fetch(`${localBase}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'http://client/cb' }).toString(),
    });
    const tokens = await tr.json();
    const jwks = await (await fetch(`${localBase}/.well-known/jwks.json`)).json();
    const pub = await importJWK(jwks.keys[0], 'RS256');
    const { payload } = await jwtVerify(tokens.id_token, pub);
    expect(payload.sub).toBe('mutated-sub');
  });

  it('exposes a tenanted Google discovery doc at /google/.well-known/openid-configuration', async () => {
    const r = await fetch(`${localBase}/google/.well-known/openid-configuration`);
    expect(r.ok).toBe(true);
    const d = await r.json();
    expect(d.issuer).toMatch(/\/google$/);
    expect(d.authorization_endpoint).toMatch(/\/google\/authorize$/);
    expect(d.token_endpoint).toMatch(/\/google\/token$/);
    expect(d.jwks_uri).toMatch(/\/google\/\.well-known\/jwks\.json$/);
  });

  it('Google tenant round-trip works under /google/* prefix', async () => {
    await fetch(`${localBase}/google/mock/identity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub: 'google-tenanted', email: 'g@t', email_verified: true }),
    });
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const authUrl = new URL(`${localBase}/google/authorize`);
    authUrl.searchParams.set('client_id', 'c');
    authUrl.searchParams.set('redirect_uri', 'http://client/cb');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    const r = await fetch(authUrl, { redirect: 'manual' });
    const code = new URL(r.headers.get('location')).searchParams.get('code');
    const tr = await fetch(`${localBase}/google/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'http://client/cb', code_verifier: verifier }).toString(),
    });
    expect(tr.ok).toBe(true);
    const tokens = await tr.json();
    const jwks = await (await fetch(`${localBase}/google/.well-known/jwks.json`)).json();
    const pub = await importJWK(jwks.keys[0], 'RS256');
    const { payload } = await jwtVerify(tokens.id_token, pub);
    expect(payload.iss).toMatch(/\/google$/);
    expect(payload.sub).toBe('google-tenanted');
  });

  it('Apple tenant publishes JWKS at the issuer-relative /auth/keys path', async () => {
    const r = await fetch(`${localBase}/apple/auth/keys`);
    expect(r.ok).toBe(true);
    const j = await r.json();
    expect(j.keys).toHaveLength(1);
    expect(j.keys[0].alg).toBe('RS256');
  });

  async function appleAuthorize(localBase, { sub, email, is_private_email, name } = {}) {
    if (sub) {
      await fetch(`${localBase}/apple/mock/identity`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sub, email, is_private_email, name }),
      });
    }
    const authUrl = new URL(`${localBase}/apple/auth/authorize`);
    authUrl.searchParams.set('client_id', 'com.tricho.app');
    authUrl.searchParams.set('redirect_uri', 'http://client/cb');
    authUrl.searchParams.set('response_type', 'code id_token');
    authUrl.searchParams.set('response_mode', 'form_post');
    authUrl.searchParams.set('state', 'st');
    authUrl.searchParams.set('nonce', 'no');
    return fetch(authUrl);
  }

  function parseFormPost(htmlBody) {
    const fields = {};
    const re = /<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*\/>/g;
    let m;
    while ((m = re.exec(htmlBody))) {
      fields[m[1]] = m[2]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'");
    }
    return fields;
  }

  it('Apple authorize returns a form_post HTML page', async () => {
    const r = await appleAuthorize(localBase, { sub: 'a-form-1', email: 'a@t', is_private_email: false, name: { firstName: 'Anna', lastName: 'Nováková' } });
    expect(r.ok).toBe(true);
    expect(r.headers.get('content-type')).toMatch(/text\/html/);
    const body = await r.text();
    expect(body).toMatch(/<form method="POST"/);
    const fields = parseFormPost(body);
    expect(fields.code).toBeTruthy();
    expect(fields.state).toBe('st');
  });

  it('Apple first-time authorization includes the user form field, returning omits it', async () => {
    // Reset to make sure we are first-time for this sub.
    await fetch(`${localBase}/apple/mock/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub: 'a-first-1' }),
    });
    const r1 = await appleAuthorize(localBase, { sub: 'a-first-1', email: 'a@t', is_private_email: false, name: { firstName: 'Anna', lastName: 'Nováková' } });
    const fields1 = parseFormPost(await r1.text());
    expect(fields1.user).toBeTruthy();
    expect(JSON.parse(fields1.user)).toEqual({ name: { firstName: 'Anna', lastName: 'Nováková' } });

    // Exchange the first code so the tenant marks the sub as seen.
    await fetch(`${localBase}/apple/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: fields1.code, redirect_uri: 'http://client/cb' }).toString(),
    });

    // Re-authorize with the same sub — now the user field MUST be absent.
    const r2 = await appleAuthorize(localBase);
    const fields2 = parseFormPost(await r2.text());
    expect(fields2.user).toBeUndefined();
  });

  it('Apple mock/reset clears the per-sub state so first-time fires again', async () => {
    // Make sure sub is "seen" by exchanging once.
    await fetch(`${localBase}/apple/mock/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub: 'a-reset-1' }),
    });
    const r1 = await appleAuthorize(localBase, { sub: 'a-reset-1', email: 'a@t', name: { firstName: 'A', lastName: 'B' } });
    const f1 = parseFormPost(await r1.text());
    await fetch(`${localBase}/apple/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: f1.code, redirect_uri: 'http://client/cb' }).toString(),
    });
    // Confirm second authorize omits user.
    const r2 = await appleAuthorize(localBase);
    expect(parseFormPost(await r2.text()).user).toBeUndefined();

    // Reset and reauthorize — user field should appear again.
    await fetch(`${localBase}/apple/mock/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub: 'a-reset-1' }),
    });
    const r3 = await appleAuthorize(localBase);
    expect(parseFormPost(await r3.text()).user).toBeTruthy();
  });

  it('Apple private-relay identity yields a privaterelay email and is_private_email=true in id_token', async () => {
    await fetch(`${localBase}/apple/mock/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const r = await appleAuthorize(localBase, { sub: 'a-priv-1', is_private_email: true, name: null });
    const fields = parseFormPost(await r.text());
    const tr = await fetch(`${localBase}/apple/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: fields.code, redirect_uri: 'http://client/cb' }).toString(),
    });
    expect(tr.ok).toBe(true);
    const tokens = await tr.json();
    const jwks = await (await fetch(`${localBase}/apple/auth/keys`)).json();
    const pub = await importJWK(jwks.keys[0], 'RS256');
    const { payload } = await jwtVerify(tokens.id_token, pub);
    expect(payload.is_private_email).toBe(true);
    expect(payload.email).toMatch(/@privaterelay\.appleid\.com$/);
    expect(payload.iss).toMatch(/\/apple$/);
  });

  it('Apple id_token honours expires_in override (for refresh-path testing)', async () => {
    await fetch(`${localBase}/apple/mock/identity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub: 'a-short', email: 's@t' }),
    });
    const authUrl = new URL(`${localBase}/apple/auth/authorize`);
    authUrl.searchParams.set('client_id', 'c');
    authUrl.searchParams.set('redirect_uri', 'http://client/cb');
    authUrl.searchParams.set('response_type', 'code id_token');
    authUrl.searchParams.set('response_mode', 'form_post');
    authUrl.searchParams.set('expires_in', '30');
    const r = await fetch(authUrl);
    const fields = parseFormPost(await r.text());
    const tr = await fetch(`${localBase}/apple/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: fields.code, redirect_uri: 'http://client/cb' }).toString(),
    });
    const tokens = await tr.json();
    expect(tokens.expires_in).toBe(30);
  });

  it('cross-tenant code exchange is rejected', async () => {
    // Mint a Google code, try to exchange via /apple/auth/token.
    const r = await fetch(new URL(`${localBase}/google/authorize?client_id=c&redirect_uri=http://client/cb&response_type=code`), { redirect: 'manual' });
    const code = new URL(r.headers.get('location')).searchParams.get('code');
    const tr = await fetch(`${localBase}/apple/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'http://client/cb' }).toString(),
    });
    expect(tr.status).toBe(400);
    const body = await tr.json();
    expect(body.error).toBe('invalid_grant');
    expect(body.error_description).toMatch(/tenant mismatch/);
  });
});
