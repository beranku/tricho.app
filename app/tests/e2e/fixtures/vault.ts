import { test as base, expect, type Page } from '@playwright/test';
import { setMockGoogleIdentity } from './mock-oidc';

export interface VaultUser {
  sub: string;
  email: string;
  couchdbUsername: string;
  jwt: string;
  refreshToken: string;
}

const PENDING_OAUTH_KEY = 'tricho-pending-oauth';

/**
 * Drive the full OAuth chain against mock-oidc + tricho-auth and hand the
 * test a signed-in VaultUser. Each invocation uses a fresh `sub` so device
 * limits don't leak between tests.
 *
 * Flow shape (since commit e702e03 — "fix(auth): cross-origin OAuth
 * completion via URL fragment"): tricho-auth's callback issues a 302 to
 * `${APP_ORIGIN}/app/#tricho-auth-complete=<base64url(JSON)>`. The browser
 * follows the chain — fragments survive 302 — and AppShell on /app/
 * consumes the fragment, stashes the parsed result into
 * `sessionStorage['tricho-pending-oauth']`, and clears the hash. We poll
 * sessionStorage for the result instead of racing with that cleanup.
 *
 * The previous mechanism (an inline `<script id="tricho-auth-result">` in
 * the callback HTML) no longer exists; do not look for it.
 */
export async function openVaultAsTestUser(
  page: Page,
  overrides: Partial<{ sub: string; email: string }> = {},
): Promise<VaultUser> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sub = overrides.sub ?? `g-e2e-${stamp}`;
  const email = overrides.email ?? `${sub}@tricho.test`;

  await setMockGoogleIdentity(page, { sub, email, name: 'E2E Vault User' });

  // Drive the OAuth chain through real navigation. The browser follows the
  // 302 chain start → /authorize → /callback → /app/#tricho-auth-complete=…
  // and AppShell drains the fragment into sessionStorage on first paint.
  await page.goto('/auth/google/start');
  const json = await page.waitForFunction(
    (key) => sessionStorage.getItem(key),
    PENDING_OAUTH_KEY,
    { timeout: 20_000 },
  );
  const raw = await json.jsonValue();
  expect(raw, 'sessionStorage[tricho-pending-oauth]').not.toBeNull();
  const payload = JSON.parse(raw as unknown as string) as {
    ok: boolean;
    deviceApproved: boolean;
    couchdbUsername: string;
    tokens: { jwt: string; refreshToken: string } | null;
  };

  expect(payload.ok, 'OAuth result should succeed').toBe(true);
  expect(payload.deviceApproved, 'device should be approved').toBe(true);
  expect(payload.tokens, 'OAuth result should carry tokens').not.toBeNull();

  return {
    sub,
    email,
    couchdbUsername: payload.couchdbUsername,
    jwt: payload.tokens!.jwt,
    refreshToken: payload.tokens!.refreshToken,
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
