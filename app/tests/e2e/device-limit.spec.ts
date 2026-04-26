import { test, expect } from './fixtures/vault';
import { openVaultAsTestUser } from './fixtures/vault';

// Drive three OAuth callbacks with the SAME sub (so all three land on
// the same user), assert the 3rd is rejected with deviceApproved: false
// because the free-tier subscription allows 2 devices.

test('third device on free tier is rejected', async ({ page }) => {
  const sub = `device-limit-${Date.now()}`;

  // Each call opens a new "device" because the browser context is fresh
  // per login inside openVaultAsTestUser (no tricho_device cookie carry).
  // But with the same sub, they all map to the same user.
  await openVaultAsTestUser(page, { sub, email: `${sub}@tricho.test` });
  // clear cookies to simulate a fresh device
  await page.context().clearCookies();
  await openVaultAsTestUser(page, { sub, email: `${sub}@tricho.test` });
  await page.context().clearCookies();

  // Third attempt — still same sub, no cookies → tricho-auth sees this as
  // a third device and rejects.
  const result = await page.evaluate(async (s) => {
    await fetch('/mock-oidc/mock/identity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub: s, email: `${s}@tricho.test`, email_verified: true }),
    });
    const r = await fetch('/auth/google/start', { redirect: 'follow', credentials: 'include' });
    return { status: r.status, body: await r.text() };
  }, sub);

  expect(result.status).toBe(200);
  const match = result.body.match(/<script id="tricho-auth-result"[^>]*>([\s\S]*?)<\/script>/);
  expect(match).not.toBeNull();
  const payload = JSON.parse(match![1]);
  expect(payload.deviceApproved).toBe(false);
  expect(payload.tokens).toBeNull();
});
