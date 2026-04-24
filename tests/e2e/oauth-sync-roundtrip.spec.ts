import { test, expect } from '@playwright/test';

// Drives the full Google OAuth path against the mock-oidc provider and
// confirms tricho-auth issues a JWT. The "write a doc through PouchDB and
// observe ciphertext at /userdb-<hex>/" portion of the spec is TODO —
// needs the vault-keystore unlock fixture (passkey-prf stub or pin
// fallback) which isn't wired yet. Keeping the OAuth half gives CI the
// "end-to-end happy path" coverage the spec calls for; the encryption
// assertion comes in a follow-up once the stub exists.
//
// The test drives the flow via `fetch()` from the page context rather than
// `page.goto()` chains because the callback HTML's `location.replace(...)`
// discards the response buffer before Playwright can read it. Fetching it
// manually keeps the entire HTML body inspectable.

const MOCK_IDENTITY_URL = '/mock-oidc/mock/identity';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (url) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        // Unique subject per test run so the device-limit check doesn't
        // carry over stale devices from previous runs.
        sub: `g-e2e-roundtrip-${Date.now()}`,
        email: `roundtrip-${Date.now()}@tricho.test`,
        email_verified: true,
        name: 'Roundtrip User',
      }),
    });
    return { ok: r.ok, status: r.status };
  }, MOCK_IDENTITY_URL);
  expect(result.ok, `mock-oidc identity set returned ${result.status}`).toBe(true);
});

test('Google OAuth round-trip lands back on the PWA with tokens', async ({ page }) => {
  await page.goto('/');

  // Walk the OAuth chain manually. `credentials: 'include'` carries the
  // working OAuth cookie set by /auth/google/start through the round-trip.
  const body = await page.evaluate(async () => {
    const res = await fetch('/auth/google/start', {
      redirect: 'follow',
      credentials: 'include',
    });
    return { status: res.status, body: await res.text() };
  });

  expect(body.status, 'callback HTML should return 200').toBe(200);

  const match = body.body.match(
    /<script id="tricho-auth-result" type="application\/json">([\s\S]*?)<\/script>/,
  );
  expect(match, 'callback HTML did not embed a tricho-auth-result payload').not.toBeNull();
  const result = JSON.parse(match![1]);

  expect(result.ok).toBe(true);
  expect(result.deviceApproved).toBe(true);
  expect(result.tokens).toBeTruthy();
  expect(result.tokens.jwt).toMatch(/^ey/); // compact JWS
  expect(result.email).toMatch(/^roundtrip-\d+@tricho\.test$/);
  expect(result.provider).toBe('google');
  expect(result.couchdbUsername).toMatch(/^g_/);
});

test.skip('authenticated write appears as ciphertext on CouchDB', async () => {
  // TODO: needs a passkey-prf or pin-fallback unlock fixture so the vault
  // DEK is available to the PouchDB wrapper. Until then, the encryption
  // envelope assertion stays unverified from e2e.
});
