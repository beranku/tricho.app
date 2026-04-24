import { test, expect } from '@playwright/test';

// Drives the full Google OAuth path against the mock-oidc provider and
// confirms tricho-auth issues a JWT. The "write a doc through PouchDB and
// observe ciphertext at /userdb-<hex>/" portion of the spec is TODO —
// needs the vault-keystore unlock fixture (passkey-prf stub or pin
// fallback) which isn't wired yet. Keeping the OAuth half gives CI the
// "end-to-end happy path" coverage the spec calls for; the encryption
// assertion comes in a follow-up once the stub exists.

const MOCK_IDENTITY_URL = '/mock-oidc/mock/identity';

test.beforeEach(async ({ request }) => {
  // Select which identity the next /authorize returns.
  const res = await request.post(MOCK_IDENTITY_URL, {
    data: {
      sub: 'g-e2e-roundtrip',
      email: 'roundtrip@tricho.test',
      email_verified: true,
      name: 'Roundtrip User',
    },
  });
  expect(res.ok()).toBe(true);
});

test('Google OAuth round-trip lands back on the PWA with tokens', async ({ page }) => {
  await page.goto('/auth/google/start');

  // Wait for the mock-oidc authorize → tricho-auth callback → PWA redirect
  // chain to finish. The callback HTML redirects to /#tricho-auth-complete
  // after writing sessionStorage.
  await page.waitForURL(/#tricho-auth-complete$/, { timeout: 30_000 });

  // The callback stashes the result in sessionStorage — inspect it directly.
  const result = await page.evaluate(() =>
    JSON.parse(window.sessionStorage.getItem('tricho-oauth-result') ?? 'null'),
  );
  expect(result).toBeTruthy();
  expect(result.ok).toBe(true);
  expect(result.deviceApproved).toBe(true);
  expect(result.tokens).toBeTruthy();
  expect(result.tokens.jwt).toMatch(/^ey/); // compact JWS
  expect(result.email).toBe('roundtrip@tricho.test');
  expect(result.provider).toBe('google');
  expect(result.couchdbUsername).toMatch(/^g_/);
});

test.skip('authenticated write appears as ciphertext on CouchDB', async () => {
  // TODO: needs a passkey-prf or pin-fallback unlock fixture so the vault
  // DEK is available to the PouchDB wrapper. Until then, the encryption
  // envelope assertion stays unverified from e2e.
});
