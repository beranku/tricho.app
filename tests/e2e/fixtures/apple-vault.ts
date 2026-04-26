import { expect, type Page } from '@playwright/test';
import { setMockAppleIdentity, resetMockApple, type AppleIdentity } from './mock-oidc';

export interface AppleVaultUser {
  sub: string;
  email: string | null;
  couchdbUsername: string;
  jwt: string;
  refreshToken: string;
  rawCallbackHtml: string;
}

/**
 * Drive the Apple OAuth chain via mock-oidc's /apple tenant. Apple's callback
 * is `form_post`, so we follow the redirect chain (mock issues an HTML page
 * that auto-submits to /auth/apple/callback) and extract the embedded auth
 * result the same way the Google fixture does.
 *
 * Pass `freshSub: true` to reset the per-sub "first time" state so the next
 * authorize emits the `user` form field again.
 */
export async function openAppleVault(
  page: Page,
  identity: AppleIdentity & { freshSub?: boolean },
): Promise<AppleVaultUser> {
  if (identity.freshSub) await resetMockApple(page, { sub: identity.sub });
  await setMockAppleIdentity(page, identity);

  // Apple uses form_post: /auth/apple/start redirects to mock-oidc which
  // returns a self-submitting HTML form that POSTs to /auth/apple/callback.
  // Use page.goto so the browser executes the form's onload submit; then
  // extract the embedded auth-result from the eventual callback HTML.
  await page.goto('/auth/apple/start');
  // Wait for the callback HTML to render.
  await page.waitForFunction(() => !!document.querySelector('#tricho-auth-result'));

  const payload = await page.evaluate(() => {
    const el = document.getElementById('tricho-auth-result');
    return el ? JSON.parse(el.textContent ?? '{}') : null;
  });
  expect(payload, 'Apple callback should embed a tricho-auth-result payload').not.toBeNull();
  expect(payload.ok, 'Apple OAuth result should succeed').toBe(true);
  expect(payload.deviceApproved, 'device should be approved').toBe(true);

  return {
    sub: identity.sub,
    email: payload.email ?? null,
    couchdbUsername: payload.couchdbUsername,
    jwt: payload.tokens.jwt,
    refreshToken: payload.tokens.refreshToken,
    rawCallbackHtml: await page.content(),
  };
}
