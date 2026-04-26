import { expect, type Page } from '@playwright/test';
import { openVaultAsTestUser, type VaultUser } from './vault';
import { attachVirtualAuthenticator } from './webauthn';

const SESSION_OAUTH_KEY = 'tricho-oauth-result';
const E2E_BRIDGE_KEY = 'tricho-e2e-bridge';

export interface CreatedVault {
  user: VaultUser;
  /** The Base32 RS body (52 chars) — ready to paste into a recovery
   *  textarea on a sibling device. */
  recoverySecret: string;
}

/**
 * Drive Device A through OAuth → wizard new flow → unlock end-to-end.
 *
 * Side effects:
 *   - `sessionStorage['tricho-oauth-result']` so AppShell consumes it.
 *   - `localStorage['tricho-e2e-bridge'] = '1'` so the wizard exposes
 *     the generated RS via `window.__trichoWizardE2E`.
 *   - Virtual WebAuthn authenticator attached.
 *   - Navigates to `/`, walks the new-flow Step 3 substeps, lands
 *     unlocked.
 */
export async function createVaultWithRs(
  page: Page,
  opts: { sub?: string; email?: string } = {},
): Promise<CreatedVault> {
  const user = await openVaultAsTestUser(page, opts);
  await attachVirtualAuthenticator(page);

  await stashOAuthAndBridge(page, {
    couchdbUsername: user.couchdbUsername,
    email: user.email,
    deviceId: `device-${user.sub}`,
    jwt: user.jwt,
    refreshToken: user.refreshToken,
    hasRemoteVault: false,
  });

  await page.goto('/');

  // Step 3 new-flow QR substep auto-mounts under `data-flow="new"`.
  await expect(page.locator('.step-card[data-step="3"][data-state="active"][data-flow="new"]')).toBeVisible({
    timeout: 20_000,
  });

  // Read the freshly generated RS from the wizard test bridge.
  const generated = await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __trichoWizardE2E?: { generatedRs: { encoded: string; checksum: string } };
      };
      return w.__trichoWizardE2E?.generatedRs ?? null;
    },
    null,
    { timeout: 10_000 },
  );
  const { encoded, checksum } = (await generated.jsonValue()) as { encoded: string; checksum: string };

  // qr → verify
  await page.getByTestId('wizard-qr-continue').click();
  await expect(page.locator('.step-card[data-step="3"][data-substep="verify"]')).toBeVisible();

  // verify → webauthn (typed last-4 path)
  await page.getByTestId('wizard-last4-input').fill(checksum);
  await page.getByTestId('wizard-last4-submit').click();
  await expect(page.locator('.step-card[data-step="3"][data-substep="webauthn"]')).toBeVisible();

  // webauthn → final
  await page.getByTestId('wizard-webauthn-activate').click();
  await expect(page.getByTestId('wizard-final')).toBeVisible({ timeout: 20_000 });

  // final CTA → unlocked app shell
  await page.getByTestId('wizard-final-cta').click();
  await expect(page.locator('.phone-inner')).toBeVisible({ timeout: 20_000 });

  return { user, recoverySecret: encoded };
}

/**
 * Drive Device B through OAuth → wizard existing flow → unlock end-to-end.
 *
 * Assumes Device A has already created a vault for the same `sub`. The
 * server probe will surface a `vault-state` doc, so the wizard auto-selects
 * the existing flow at Step 3.
 */
export async function joinVaultWithRs(
  page: Page,
  opts: { sub: string; recoverySecret: string; email?: string },
): Promise<VaultUser> {
  const user = await openVaultAsTestUser(page, { sub: opts.sub, email: opts.email });
  await attachVirtualAuthenticator(page);

  await stashOAuthAndBridge(page, {
    couchdbUsername: user.couchdbUsername,
    email: user.email,
    deviceId: `device-${user.sub}-b`,
    jwt: user.jwt,
    refreshToken: user.refreshToken,
    hasRemoteVault: true,
  });

  await page.goto('/');

  // Step 3 existing-flow QR substep auto-mounts under `data-flow="existing"`.
  await expect(page.locator('.step-card[data-step="3"][data-state="active"][data-flow="existing"]')).toBeVisible({
    timeout: 20_000,
  });

  // Type RS into the manual textarea and submit.
  const manualInput = page.getByTestId('wizard-existing-manual-input');
  await expect(manualInput).toBeVisible();
  await manualInput.fill(opts.recoverySecret);
  await page.getByTestId('wizard-existing-manual-submit').click();

  // → webauthn substep
  await expect(page.locator('.step-card[data-step="3"][data-substep="webauthn"]')).toBeVisible();

  await page.getByTestId('wizard-webauthn-activate').click();
  await expect(page.getByTestId('wizard-final')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('wizard-final-cta').click();
  await expect(page.locator('.phone-inner')).toBeVisible({ timeout: 20_000 });

  return user;
}

interface StashArgs {
  couchdbUsername: string;
  email: string;
  deviceId: string;
  jwt: string;
  refreshToken: string;
  hasRemoteVault: boolean;
}

async function stashOAuthAndBridge(page: Page, args: StashArgs): Promise<void> {
  await page.addInitScript(
    ({ sessionKey, bridgeKey, payload }) => {
      try {
        sessionStorage.setItem(sessionKey, payload);
      } catch {
        /* noop */
      }
      try {
        localStorage.setItem(bridgeKey, '1');
      } catch {
        /* noop */
      }
    },
    {
      sessionKey: SESSION_OAUTH_KEY,
      bridgeKey: E2E_BRIDGE_KEY,
      payload: JSON.stringify({
        ok: true,
        isNewUser: !args.hasRemoteVault,
        deviceApproved: true,
        hasRemoteVault: args.hasRemoteVault,
        couchdbUsername: args.couchdbUsername,
        email: args.email,
        name: null,
        picture: null,
        provider: 'google',
        deviceId: args.deviceId,
        devices: [],
        subscription: { tier: 'free', deviceLimit: 2, storageLimitMB: 100, paidUntil: null },
        tokens: {
          jwt: args.jwt,
          jwtExp: Math.floor(Date.now() / 1000) + 3600,
          refreshToken: args.refreshToken,
          refreshTokenExp: Math.floor(Date.now() / 1000) + 86400,
        },
      }),
    },
  );
}
