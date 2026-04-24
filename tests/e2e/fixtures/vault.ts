import { test as base, expect, type Page } from '@playwright/test';
import { setMockIdentity } from './mock-oidc';

export interface VaultUser {
  sub: string;
  email: string;
  couchdbUsername: string;
  jwt: string;
  refreshToken: string;
  rawCallbackHtml: string;
}

/**
 * Drive the full OAuth chain against mock-oidc + tricho-auth and hand the
 * test a signed-in VaultUser. Each invocation uses a fresh `sub` so device
 * limits don't leak between tests.
 */
export async function openVaultAsTestUser(
  page: Page,
  overrides: Partial<{ sub: string; email: string }> = {},
): Promise<VaultUser> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sub = overrides.sub ?? `g-e2e-${stamp}`;
  const email = overrides.email ?? `${sub}@tricho.test`;

  await setMockIdentity(page, { sub, email, name: 'E2E Vault User' });

  const flow = await page.evaluate(async () => {
    const res = await fetch('/auth/google/start', {
      redirect: 'follow',
      credentials: 'include',
    });
    return { status: res.status, body: await res.text() };
  });

  expect(flow.status, 'OAuth callback HTML').toBe(200);

  const match = flow.body.match(
    /<script id="tricho-auth-result" type="application\/json">([\s\S]*?)<\/script>/,
  );
  expect(match, 'callback HTML should embed a tricho-auth-result payload').not.toBeNull();
  const payload = JSON.parse(match![1]);

  expect(payload.ok, 'OAuth result should succeed').toBe(true);
  expect(payload.deviceApproved, 'device should be approved').toBe(true);

  return {
    sub,
    email,
    couchdbUsername: payload.couchdbUsername,
    jwt: payload.tokens.jwt,
    refreshToken: payload.tokens.refreshToken,
    rawCallbackHtml: flow.body,
  };
}

/**
 * Playwright fixture extension — lets tests declare `{ vaultUser }` in
 * their signature and arrive signed in.
 *
 *   import { test } from './fixtures/vault';
 *   test('my test', async ({ page, vaultUser }) => { ... });
 */
export const test = base.extend<{ vaultUser: VaultUser }>({
  vaultUser: async ({ page }, use) => {
    const user = await openVaultAsTestUser(page);
    await use(user);
  },
});

export { expect };
