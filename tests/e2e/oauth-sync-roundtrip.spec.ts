import { test, expect } from './fixtures/vault';

// Drives the full Google OAuth path via the shared openVaultAsTestUser
// fixture. Previously ~60 lines of inline setup; now each test gets a
// signed-in user from one line of destructuring.

test('Google OAuth round-trip lands back on the PWA with tokens', async ({ vaultUser }) => {
  expect(vaultUser.couchdbUsername).toMatch(/^g_/);
  expect(vaultUser.jwt).toMatch(/^ey/);
  expect(vaultUser.email).toMatch(/^g-e2e-\d+-[a-z0-9]+@tricho\.test$/);
  expect(vaultUser.refreshToken).toBeTruthy();
});

test('JWT is accepted by tricho-auth on an authenticated endpoint', async ({ page, vaultUser }) => {
  await page.goto('/');
  const res = await page.evaluate(async (jwt) => {
    const r = await fetch('/auth/devices', {
      headers: { authorization: `Bearer ${jwt}` },
    });
    return { status: r.status, body: await r.json() };
  }, vaultUser.jwt);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.devices)).toBe(true);
  expect(res.body.devices.length).toBeGreaterThanOrEqual(1);
});

test.skip('authenticated write appears as ciphertext on CouchDB', async () => {
  // TODO: needs a passkey-prf or pin-fallback unlock fixture so the vault
  // DEK is available to the PouchDB wrapper. Until then, the encryption
  // envelope assertion stays unverified from e2e.
});
