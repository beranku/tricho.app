import { test, expect } from './fixtures/vault';
import { openVaultAsTestUser } from './fixtures/vault';
import { grandfatherFreeDevices } from './fixtures/admin';

// Drive three OAuth callbacks with the SAME sub (so all three land on
// the same user), assert the 3rd is rejected with deviceApproved: false
// because the free-tier subscription tops out at 2 devices (grandfathered).

test('third device on free tier is rejected', async ({ page }) => {
  const sub = `device-limit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `${sub}@tricho.test`;

  // First device — creates the user.
  const u1 = await openVaultAsTestUser(page, { sub, email });
  // Free tier ships at deviceLimit=1; grandfather to lift it to 2 so the
  // walk has somewhere to overflow.
  await grandfatherFreeDevices(u1.couchdbUsername);

  // Second device — fresh cookies, same sub.
  await page.context().clearCookies();
  await openVaultAsTestUser(page, { sub, email });

  // Third device — same sub, no cookies → tricho-auth rejects. Use the
  // real browser navigation so the URL fragment survives the redirect
  // chain (fetch() strips fragments from the final URL).
  await page.context().clearCookies();
  await page.evaluate(async (s) => {
    await fetch('/mock-oidc/mock/identity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub: s, email: `${s}@tricho.test`, email_verified: true }),
    });
  }, sub);
  await page.goto('/auth/google/start');
  const json = await page.waitForFunction(
    () => sessionStorage.getItem('tricho-pending-oauth'),
    null,
    { timeout: 20_000 },
  );
  const raw = (await json.jsonValue()) as string;
  const payload = JSON.parse(raw) as { deviceApproved: boolean; tokens: unknown };
  expect(payload.deviceApproved).toBe(false);
  expect(payload.tokens).toBeNull();
});
