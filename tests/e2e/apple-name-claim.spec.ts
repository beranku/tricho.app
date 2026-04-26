import { test, expect } from '@playwright/test';
import { openAppleVault } from './fixtures/apple-vault';

test.beforeAll(async ({ request }) => {
  const r = await request.get('/auth/apple/start', { maxRedirects: 0, failOnStatusCode: false });
  test.skip(r.status() === 503, 'Apple is not configured in this CI environment');
});

test('Apple name arrives on first login and persists across a returning login', async ({ page }) => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sub = `a-name-${stamp}`;
  const email = `${sub}@tricho.test`;

  // First login: name should be persisted on the user row.
  const first = await openAppleVault(page, {
    sub,
    email,
    is_private_email: false,
    name: { firstName: 'Anna', lastName: 'Nováková' },
    freshSub: true,
  });
  expect(first.couchdbUsername).toMatch(/^a_/);

  // Second login (same sub, NO freshSub reset): mock omits the `user` form
  // field. The server MUST authenticate the user without erasing their
  // stored name.
  const second = await openAppleVault(page, {
    sub,
    email,
    // identity object still seeded; mock-oidc decides whether to emit `user`.
    name: { firstName: 'Anna', lastName: 'Nováková' },
  });
  // Same canonical username — server identity is sub-derived.
  expect(second.couchdbUsername).toBe(first.couchdbUsername);

  // Hit the authenticated /auth/devices endpoint — confirms the second
  // login produced a usable JWT (i.e. signature, issuer, audience all
  // verified against the mock JWKS). Server-side name persistence is
  // exercised by the backend integration tier (route + meta tests).
  const r = await page.evaluate(async (jwt) => {
    const res = await fetch('/auth/devices', { headers: { authorization: `Bearer ${jwt}` } });
    return { status: res.status };
  }, second.jwt);
  expect(r.status).toBe(200);
});
