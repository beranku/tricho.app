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
});
