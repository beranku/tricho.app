import { describe, it, expect } from 'vitest';
import { mountRouter } from './fixtures/routes.mjs';
import { fakeMeta } from './fixtures/meta.mjs';
import { testSigner } from './fixtures/jwt.mjs';
import { _internals } from '../routes.mjs';

function harness({ env = {} } = {}) {
  const { meta, state } = fakeMeta();
  const signer = testSigner();
  const { req } = mountRouter({
    env: { TRICHO_AUTH_COOKIE_SECRET: 'test-cookie-secret', APP_ORIGIN: 'https://tricho.test', ...env },
    meta,
    signer,
  });
  return { req, meta, signer, state };
}

describe('OPTIONS + CORS', () => {
  it('OPTIONS preflight returns 204 with CORS headers', async () => {
    const { req } = harness();
    const r = await req('OPTIONS', '/auth/health');
    expect(r.status).toBe(204);
    // Headers keep original case from writeHead.
    const keys = Object.keys(r.headers).map((k) => k.toLowerCase());
    expect(keys).toContain('access-control-allow-origin');
  });
});

describe('/health', () => {
  it('GET /health → 200 ok', async () => {
    const { req } = harness();
    const r = await req('GET', '/health');
    expect(r.status).toBe(200);
    expect(r.json().ok).toBe(true);
  });

  it('GET /auth/health → 200 ok (alias)', async () => {
    const { req } = harness();
    const r = await req('GET', '/auth/health');
    expect(r.status).toBe(200);
  });
});

describe('/auth/session', () => {
  it('returns 401 authenticated:false when no session cookie', async () => {
    const { req } = harness();
    const r = await req('GET', '/auth/session');
    expect(r.status).toBe(401);
    expect(r.json().authenticated).toBe(false);
  });
});

describe('/auth/google/start — misconfigured', () => {
  it('503 google_not_configured when env vars are missing', async () => {
    const { req } = harness();
    const r = await req('GET', '/auth/google/start');
    expect(r.status).toBe(503);
    expect(r.json().error).toBe('google_not_configured');
  });
});

describe('/auth/apple/start — misconfigured', () => {
  it('503 apple_not_configured when env vars are missing', async () => {
    const { req } = harness();
    const r = await req('GET', '/auth/apple/start');
    expect(r.status).toBe(503);
  });
});

describe('/auth/refresh', () => {
  it('400 invalid_request when body lacks required fields', async () => {
    const { req } = harness();
    const r = await req('POST', '/auth/refresh', {
      headers: { 'content-type': 'application/json' },
      body: {},
    });
    expect(r.status).toBe(400);
    expect(r.json().error).toBe('invalid_request');
  });

  it('401 invalid_refresh_token when token unknown', async () => {
    const { req } = harness();
    const r = await req('POST', '/auth/refresh', {
      headers: { 'content-type': 'application/json' },
      body: { refreshToken: 'nope', deviceId: 'dev-1' },
    });
    expect(r.status).toBe(401);
    expect(r.json().error).toBe('invalid_refresh_token');
  });

  it('401 device_mismatch when token exists but device differs + revokes token', async () => {
    const { req, meta, state } = harness();
    await meta.storeRefreshToken({
      userId: 'user:g_abc',
      deviceId: 'real-device',
      refreshToken: 'ref-xyz',
      expiresAt: Date.now() + 60_000,
    });
    const r = await req('POST', '/auth/refresh', {
      headers: { 'content-type': 'application/json' },
      body: { refreshToken: 'ref-xyz', deviceId: 'WRONG-device' },
    });
    expect(r.status).toBe(401);
    expect(r.json().error).toBe('device_mismatch');
    expect(state.tokens.get('ref-xyz').revoked).toBe(true);
  });
});

describe('/auth/devices — auth required', () => {
  it('401 unauthorized without a Bearer token', async () => {
    const { req } = harness();
    const r = await req('GET', '/auth/devices');
    expect(r.status).toBe(401);
  });

  it('DELETE requires a valid Bearer JWT', async () => {
    const { req } = harness();
    const r = await req('DELETE', '/auth/devices/some-id');
    expect(r.status).toBe(401);
  });
});

describe('/auth/.well-known/jwks.json', () => {
  it('returns the JWKS with cache-control', async () => {
    const { req } = harness();
    const r = await req('GET', '/auth/.well-known/jwks.json');
    expect(r.status).toBe(200);
    const body = r.json();
    expect(Array.isArray(body.keys)).toBe(true);
    expect(body.keys.length).toBe(1);
    expect(body.keys[0].kty).toBe('RSA');
    expect(r.headers['cache-control']).toContain('public');
  });
});

describe('/auth/logout', () => {
  it('accepts a POST + clears the device cookie', async () => {
    const { req } = harness();
    const r = await req('POST', '/auth/logout', {
      headers: { 'content-type': 'application/json' },
      body: { refreshToken: 'whatever' },
    });
    expect(r.status).toBe(200);
    const cookieRaw = r.headers['set-cookie'];
    const cookies = Array.isArray(cookieRaw) ? cookieRaw : [cookieRaw];
    expect(cookies.some((c) => c.startsWith('tricho_device=;'))).toBe(true);
  });
});

describe('404 fallthrough', () => {
  it('unknown path returns 404', async () => {
    const { req } = harness();
    const r = await req('GET', '/does/not/exist');
    expect(r.status).toBe(404);
  });
});

describe('_internals.couchUsernameForSubject', () => {
  it('returns a stable hash per (provider, subject) pair', () => {
    const u1 = _internals.couchUsernameForSubject('google', 'sub-123');
    const u2 = _internals.couchUsernameForSubject('google', 'sub-123');
    expect(u1).toBe(u2);
    expect(u1).toMatch(/^g_[a-f0-9]{32}$/);
  });

  it('apple prefix is a_', () => {
    expect(_internals.couchUsernameForSubject('apple', 'x')).toMatch(/^a_/);
  });

  it('different subjects → different usernames', () => {
    expect(
      _internals.couchUsernameForSubject('google', 'a'),
    ).not.toBe(_internals.couchUsernameForSubject('google', 'b'));
  });
});

describe('_internals.signedCookieValue / verifySignedCookieValue', () => {
  it('round-trips a payload through HMAC signing', () => {
    const value = _internals.signedCookieValue('secret', { a: 1, b: 'two' });
    const back = _internals.verifySignedCookieValue('secret', value);
    expect(back).toEqual({ a: 1, b: 'two' });
  });

  it('returns null on signature mismatch', () => {
    const value = _internals.signedCookieValue('secret', { x: 1 });
    const tampered = value.slice(0, -5) + 'XXXXX';
    expect(_internals.verifySignedCookieValue('secret', tampered)).toBeNull();
  });
});
