import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPair, exportPKCS8 } from 'jose';
import { appleConfig, resolveAppleEndpoints, handleCallback } from '../providers/apple.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FAKE_P8 = `-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgevZzL1gdAFr88hb2
OF/2NxApJCzGCEDdfSp6VQO30hyhRANCAAQRWz+jn65BtOMvdyHKcvjBeBSDZH2r
1RTwjmYSi9R/zpBnuQ4EiMnCqfMPWiZqB4QdbAd0E7oH50VpuZ1P087G
-----END PRIVATE KEY-----`;

describe('appleConfig', () => {
  it('null when any env var is missing', () => {
    expect(appleConfig({})).toBeNull();
    expect(appleConfig({ APPLE_CLIENT_ID: 'x' })).toBeNull();
    expect(appleConfig({
      APPLE_CLIENT_ID: 'x',
      APPLE_TEAM_ID: 'y',
      APPLE_KEY_ID: 'z',
      APPLE_REDIRECT_URI: 'https://host/cb',
      // no APPLE_PRIVATE_KEY{,PATH} — config must be null
    })).toBeNull();
  });

  it('returns full config when APPLE_PRIVATE_KEY is inlined', () => {
    const cfg = appleConfig({
      APPLE_CLIENT_ID: 'com.tricho.app',
      APPLE_TEAM_ID: 'TEAM1234',
      APPLE_KEY_ID: 'KEY5678',
      APPLE_REDIRECT_URI: 'https://host/auth/apple/callback',
      APPLE_PRIVATE_KEY: FAKE_P8,
    });
    expect(cfg).toMatchObject({
      clientId: 'com.tricho.app',
      teamId: 'TEAM1234',
      keyId: 'KEY5678',
      redirectUri: 'https://host/auth/apple/callback',
    });
    expect(cfg.privateKeyPem).toContain('BEGIN PRIVATE KEY');
  });

  it('resolves endpoints from real Apple by default', () => {
    const cfg = appleConfig({
      APPLE_CLIENT_ID: 'com.tricho.app',
      APPLE_TEAM_ID: 'TEAM1234',
      APPLE_KEY_ID: 'KEY5678',
      APPLE_REDIRECT_URI: 'https://host/cb',
      APPLE_PRIVATE_KEY: FAKE_P8,
    });
    expect(cfg.endpoints).toEqual({
      issuer: 'https://appleid.apple.com',
      authorize: 'https://appleid.apple.com/auth/authorize',
      token: 'https://appleid.apple.com/auth/token',
      jwks: new URL('https://appleid.apple.com/auth/keys'),
    });
  });

  it('honours APPLE_OIDC_ISSUER override (CI / mock)', () => {
    const cfg = appleConfig({
      APPLE_CLIENT_ID: 'com.tricho.app',
      APPLE_TEAM_ID: 'TEAM1234',
      APPLE_KEY_ID: 'KEY5678',
      APPLE_REDIRECT_URI: 'https://host/cb',
      APPLE_PRIVATE_KEY: FAKE_P8,
      APPLE_OIDC_ISSUER: 'http://mock-oidc:8080/apple',
    });
    expect(cfg.endpoints.issuer).toBe('http://mock-oidc:8080/apple');
    expect(cfg.endpoints.token).toBe('http://mock-oidc:8080/apple/auth/token');
    expect(cfg.endpoints.authorize).toBe('http://mock-oidc:8080/apple/auth/authorize');
    expect(cfg.endpoints.jwks).toEqual(new URL('http://mock-oidc:8080/apple/auth/keys'));
  });
});

describe('resolveAppleEndpoints', () => {
  it('strips trailing slashes from the issuer', () => {
    const r = resolveAppleEndpoints('https://example.com/apple/');
    expect(r.issuer).toBe('https://example.com/apple');
    expect(r.token).toBe('https://example.com/apple/auth/token');
  });

  it('falls back to real Apple when issuer is undefined', () => {
    const r = resolveAppleEndpoints(undefined);
    expect(r.issuer).toBe('https://appleid.apple.com');
  });

  it('falls back to real Apple when issuer is null', () => {
    const r = resolveAppleEndpoints(null);
    expect(r.issuer).toBe('https://appleid.apple.com');
  });
});

// End-to-end provider round-trip against a programmatically-launched mock-oidc.
// Validates that APPLE_OIDC_ISSUER is honoured all the way through clientSecret
// minting → token POST → JWKS fetch → id_token verification.
describe('handleCallback against mock-oidc Apple tenant', () => {
  let proc;
  let issuer;

  beforeAll(async () => {
    const tmp = http.createServer();
    await new Promise((r) => tmp.listen(0, r));
    const port = tmp.address().port;
    tmp.close();
    issuer = `http://localhost:${port}/apple`;

    const mockServerPath = path.resolve(__dirname, '../../../mock-oidc/server.mjs');
    proc = spawn('node', [mockServerPath], {
      env: {
        ...process.env,
        PORT: String(port),
        MOCK_OIDC_ISSUER: `http://localhost:${port}`,
        MOCK_OIDC_INTERNAL_BASE: `http://localhost:${port}`,
        MOCK_OIDC_PUBLIC_BASE: `http://localhost:${port}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Wait until the mock answers /health.
    const start = Date.now();
    while (Date.now() - start < 5000) {
      try {
        const r = await fetch(`http://localhost:${port}/health`);
        if (r.ok) return;
      } catch {
        // not yet listening
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('mock-oidc child did not start within 5s');
  }, 10_000);

  afterAll(() => {
    proc?.kill('SIGTERM');
  });

  async function makeAppleConfig() {
    // Mint a real ES256 PKCS8 PEM so SignJWT().sign(privateKey) succeeds.
    const { privateKey } = await generateKeyPair('ES256');
    const pkcs8 = await exportPKCS8(privateKey);
    return {
      ...appleConfig({
        APPLE_CLIENT_ID: 'com.tricho.app',
        APPLE_TEAM_ID: 'TEAM1234',
        APPLE_KEY_ID: 'KEY5678',
        APPLE_REDIRECT_URI: 'http://client/cb',
        APPLE_PRIVATE_KEY: pkcs8,
        APPLE_OIDC_ISSUER: issuer,
      }),
    };
  }

  async function authorizeAndGetCode({ sub, email, is_private_email = false, name = null, expiresIn }) {
    const port = new URL(issuer).port;
    await fetch(`http://localhost:${port}/apple/mock/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub }),
    });
    await fetch(`http://localhost:${port}/apple/mock/identity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub, email, is_private_email, name, email_verified: true }),
    });
    const u = new URL(`http://localhost:${port}/apple/auth/authorize`);
    u.searchParams.set('client_id', 'com.tricho.app');
    u.searchParams.set('redirect_uri', 'http://client/cb');
    u.searchParams.set('response_type', 'code id_token');
    u.searchParams.set('response_mode', 'form_post');
    u.searchParams.set('state', 's1');
    u.searchParams.set('nonce', 'n1');
    if (expiresIn) u.searchParams.set('expires_in', String(expiresIn));
    const html = await (await fetch(u)).text();
    const m = html.match(/name="code"\s+value="([^"]+)"/);
    if (!m) throw new Error('no code in form_post');
    let userField;
    const um = html.match(/name="user"\s+value="([^"]+)"/);
    if (um) userField = um[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    return { code: m[1], userField };
  }

  it('round-trips an Apple id_token via the env-overridden issuer', async () => {
    const cfg = await makeAppleConfig();
    const { code, userField } = await authorizeAndGetCode({
      sub: 'a-rt-1',
      email: 'rt@t',
      name: { firstName: 'Anna', lastName: 'Nováková' },
    });
    const identity = await handleCallback(cfg, {
      form: { state: 's1', code, user: userField },
      state: 's1',
      nonce: 'n1',
    });
    expect(identity).toMatchObject({
      provider: 'apple',
      subject: 'a-rt-1',
      email: 'rt@t',
      name: 'Anna Nováková',
    });
  });

  it('returning user (no `user` field) succeeds with name=null', async () => {
    const cfg = await makeAppleConfig();
    // First login marks sub as seen.
    const first = await authorizeAndGetCode({
      sub: 'a-returning-1',
      email: 'r@t',
      name: { firstName: 'A', lastName: 'B' },
    });
    await handleCallback(cfg, { form: { state: 's1', code: first.code, user: first.userField }, state: 's1', nonce: 'n1' });
    // Second login: no user field expected.
    const port = new URL(issuer).port;
    const u = new URL(`http://localhost:${port}/apple/auth/authorize`);
    u.searchParams.set('client_id', 'com.tricho.app');
    u.searchParams.set('redirect_uri', 'http://client/cb');
    u.searchParams.set('response_type', 'code id_token');
    u.searchParams.set('response_mode', 'form_post');
    u.searchParams.set('state', 's2');
    u.searchParams.set('nonce', 'n2');
    const html = await (await fetch(u)).text();
    const code = html.match(/name="code"\s+value="([^"]+)"/)[1];
    const hasUser = /name="user"/.test(html);
    expect(hasUser).toBe(false);
    const identity = await handleCallback(cfg, { form: { state: 's2', code }, state: 's2', nonce: 'n2' });
    expect(identity.subject).toBe('a-returning-1');
    expect(identity.name).toBeNull();
  });

  it('private-relay identity is accepted without explicit email_verified', async () => {
    const cfg = await makeAppleConfig();
    const { code } = await authorizeAndGetCode({
      sub: 'a-priv-rt',
      is_private_email: true,
      email: undefined,
    });
    const identity = await handleCallback(cfg, { form: { state: 's1', code }, state: 's1', nonce: 'n1' });
    expect(identity.email).toMatch(/@privaterelay\.appleid\.com$/);
  });

  it('wrong audience id_token is rejected', async () => {
    const cfg = await makeAppleConfig();
    const wrongAudCfg = { ...cfg, clientId: 'wrong.client.id' };
    const { code } = await authorizeAndGetCode({ sub: 'a-aud-1', email: 'a@t' });
    await expect(
      handleCallback(wrongAudCfg, { form: { state: 's1', code }, state: 's1', nonce: 'n1' }),
    ).rejects.toThrow();
  });
});
