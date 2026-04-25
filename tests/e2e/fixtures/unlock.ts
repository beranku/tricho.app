import { expect, type Page } from '@playwright/test';
import { openVaultAsTestUser, type VaultUser } from './vault';
import { attachVirtualAuthenticator } from './webauthn';

const SESSION_OAUTH_KEY = 'tricho-oauth-result';

export interface CreatedVault {
  user: VaultUser;
  /**
   * The full Recovery Secret as the production UI displays it (with formatting
   * dashes/spaces stripped — i.e. ready to paste back into a recovery textarea).
   */
  recoverySecret: string;
}

/**
 * Drive Device A through OAuth → vault creation → unlock end-to-end.
 *
 * Side effects:
 *   - Sets sessionStorage['tricho-oauth-result'] so AppShell can consume it.
 *   - Attaches a virtual WebAuthn authenticator to the page.
 *   - Navigates to `/`, completes RS confirm + passkey register, lands unlocked.
 *
 * Returns the OAuth user (with JWT) plus the displayed RS so a sibling device
 * can use it via `joinVaultWithRs`.
 */
export async function createVaultWithRs(
  page: Page,
  opts: { sub?: string; email?: string } = {},
): Promise<CreatedVault> {
  const user = await openVaultAsTestUser(page, opts);
  await attachVirtualAuthenticator(page);

  // Hand the OAuth result to the PWA the same way the real callback does:
  // sessionStorage entry that AppShell.consumePendingOAuthResult() reads on mount.
  // We also stash it under the pending-OAuth key AppShell uses internally so a
  // reload/route still has it.
  await page.addInitScript(
    ({ key, payload }) => {
      try {
        sessionStorage.setItem(key, payload);
      } catch {
        /* noop */
      }
    },
    {
      key: SESSION_OAUTH_KEY,
      payload: JSON.stringify({
        ok: true,
        isNewUser: true,
        deviceApproved: true,
        hasRemoteVault: false,
        couchdbUsername: user.couchdbUsername,
        email: user.email,
        name: null,
        picture: null,
        provider: 'google',
        deviceId: `device-${user.sub}`,
        devices: [],
        subscription: { tier: 'free', deviceLimit: 2, storageLimitMB: 100, paidUntil: null },
        tokens: {
          jwt: user.jwt,
          jwtExp: Math.floor(Date.now() / 1000) + 3600,
          refreshToken: user.refreshToken,
          refreshTokenExp: Math.floor(Date.now() / 1000) + 86400,
        },
      }),
    },
  );

  await page.goto('/');

  // create_rs view shows the RS in the rs-confirmation__rs-value div with the
  // checksum echoed beside the input.
  const rsValue = page.locator('.rs-confirmation__rs-value');
  await expect(rsValue).toBeVisible({ timeout: 15_000 });
  const displayedRs = (await rsValue.innerText()).trim();
  const recoverySecret = displayedRs.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  expect(recoverySecret.length).toBeGreaterThan(0);

  const checksumHint = await page.locator('.rs-confirmation__char-highlight').innerText();
  await page.locator('#rs-checksum').fill(checksumHint.trim());
  await page.getByRole('button', { name: /^Confirm$/ }).click();

  // register_passkey view → click "Register Passkey", virtual authenticator handles it.
  await page.getByRole('button', { name: /Register Passkey/i }).click();

  // After unlock the AppShell renders the phone shell — wait for any element
  // distinctive to the unlocked view. The phone container is reliable across
  // both unlocked variants (DailySchedule / ClientDetail).
  await expect(page.locator('.phone-inner')).toBeVisible({ timeout: 20_000 });

  return { user, recoverySecret };
}

/**
 * Drive Device B through OAuth → join existing vault → unlock end-to-end.
 *
 * Assumes Device A has already created a vault for the same `sub`. The
 * production AppShell's mount probe will detect the server-side vault-state
 * doc and route to JoinVaultScreen automatically.
 */
export async function joinVaultWithRs(
  page: Page,
  opts: { sub: string; recoverySecret: string; email?: string },
): Promise<VaultUser> {
  const user = await openVaultAsTestUser(page, { sub: opts.sub, email: opts.email });
  await attachVirtualAuthenticator(page);

  await page.addInitScript(
    ({ key, payload }) => {
      try {
        sessionStorage.setItem(key, payload);
      } catch {
        /* noop */
      }
    },
    {
      key: SESSION_OAUTH_KEY,
      payload: JSON.stringify({
        ok: true,
        isNewUser: false,
        deviceApproved: true,
        hasRemoteVault: true,
        couchdbUsername: user.couchdbUsername,
        email: user.email,
        name: null,
        picture: null,
        provider: 'google',
        deviceId: `device-${user.sub}-b`,
        devices: [],
        subscription: { tier: 'free', deviceLimit: 2, storageLimitMB: 100, paidUntil: null },
        tokens: {
          jwt: user.jwt,
          jwtExp: Math.floor(Date.now() / 1000) + 3600,
          refreshToken: user.refreshToken,
          refreshTokenExp: Math.floor(Date.now() / 1000) + 86400,
        },
      }),
    },
  );

  await page.goto('/');

  // JoinVaultScreen renders a textarea labelled "Recovery Secret" and an
  // "Unlock" button. The probe should have routed us here automatically.
  const rsInput = page.getByLabel(/Recovery Secret/i);
  await expect(rsInput).toBeVisible({ timeout: 20_000 });
  await rsInput.fill(opts.recoverySecret);
  await page.getByRole('button', { name: /^Unlock$/ }).click();

  await expect(page.locator('.phone-inner')).toBeVisible({ timeout: 20_000 });
  return user;
}
