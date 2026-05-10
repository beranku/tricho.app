import { test, expect } from '@playwright/test';
import { openAppleVault } from './fixtures/apple-vault';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  const status = await page.evaluate(async () => {
    const r = await fetch('/auth/apple/start', { redirect: 'manual' });
    return r.status;
  });
  test.skip(status === 503, 'Apple is not configured in this CI environment');
});

test('Apple private-relay email user is provisioned successfully', async ({ page }) => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sub = `a-priv-${stamp}`;

  const user = await openAppleVault(page, {
    sub,
    is_private_email: true,
    name: { firstName: 'Private', lastName: 'Relay' },
    freshSub: true,
  });

  expect(user.couchdbUsername).toMatch(/^a_/);
  expect(user.email).toMatch(/@privaterelay\.appleid\.com$/);
  // The user is fully provisioned — JWT works against an authenticated route.
  const r = await page.evaluate(async (jwt) => {
    const res = await fetch('/auth/devices', { headers: { authorization: `Bearer ${jwt}` } });
    return { status: res.status };
  }, user.jwt);
  expect(r.status).toBe(200);
});
