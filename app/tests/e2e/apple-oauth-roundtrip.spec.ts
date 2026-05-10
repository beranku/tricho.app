import { test, expect } from '@playwright/test';
import { openAppleVault } from './fixtures/apple-vault';

// Skip the entire file when tricho-auth wasn't started with APPLE_CLIENT_ID.
// /auth/apple/start returns 503 in that case, signalling the operator hasn't
// rendered an Apple test key + client id into the CI secret store. The mock
// infrastructure is in place; the gate is operator-side.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  const status = await page.evaluate(async () => {
    const r = await fetch('/auth/apple/start', { redirect: 'manual' });
    return r.status;
  });
  test.skip(status === 503, 'Apple is not configured in this CI environment');
});

test('Apple OAuth round-trip lands back on the PWA with tokens', async ({ page }) => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sub = `a-rt-${stamp}`;
  const user = await openAppleVault(page, {
    sub,
    email: `${sub}@tricho.test`,
    is_private_email: false,
    name: { firstName: 'Apple', lastName: 'Tester' },
    freshSub: true,
  });
  expect(user.couchdbUsername).toMatch(/^a_/);
  expect(user.jwt).toMatch(/^ey/);
  expect(user.refreshToken).toBeTruthy();
});
