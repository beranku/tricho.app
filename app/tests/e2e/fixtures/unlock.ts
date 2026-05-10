import { expect, type Page } from '@playwright/test';
import { openVaultAsTestUser, type VaultUser } from './vault';
import { attachVirtualAuthenticator } from './webauthn';

const SESSION_OAUTH_KEY = 'tricho-oauth-result';
const E2E_BRIDGE_KEY = 'tricho-e2e-bridge';

/**
 * Emulate PWA launch mode (matchMedia + navigator.standalone) before any
 * page script runs. The wizard's `detectLaunchMode()` (`src/lib/launch-mode.ts`)
 * reads both signals and only advances past Step 1 when `launchMode === 'pwa'`.
 * Headless Chromium reports a regular tab, so without this hook the wizard
 * sits on Step 1 forever and `createVaultWithRs` can't reach Step 3.
 *
 * Mirrors the override in `welcome-wizard-pwa-mode.spec.ts`.
 */
export async function emulatePwaLaunchMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => {
        if (q === '(display-mode: standalone)') {
          return {
            matches: true,
            media: q,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
          } as MediaQueryList;
        }
        return original(q);
      },
    });
    Object.defineProperty(navigator, 'standalone', {
      configurable: true,
      value: true,
    });
    // Force the locale-bootstrap host fallback to Czech. Without this,
    // tests run with `en` (DEFAULT_LOCALE) and assertions on Czech copy
    // — the canonical product voice — would all fail. PouchDB-stored
    // `_local/locale` takes precedence, but headless Chromium starts
    // with an empty prefs DB so the host language wins.
    Object.defineProperty(navigator, 'language', {
      configurable: true,
      get: () => 'cs-CZ',
    });
    Object.defineProperty(navigator, 'languages', {
      configurable: true,
      get: () => ['cs-CZ', 'cs'],
    });
  });
}

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
  await emulatePwaLaunchMode(page);
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

  // webauthn → final (or pin-setup → final on non-PRF authenticators)
  await page.getByTestId('wizard-webauthn-activate').click();

  // Headless Chromium's virtual authenticator does not advertise the PRF
  // extension, so the wizard routes through `pin-setup` before completing.
  // Cover both branches so the fixture works on PRF and non-PRF setups.
  const pinSetup = page.locator('.step-card[data-step="3"][data-substep="pin-setup"]');
  const finalCard = page.getByTestId('wizard-final');
  await Promise.race([
    pinSetup.waitFor({ state: 'visible', timeout: 20_000 }),
    finalCard.waitFor({ state: 'visible', timeout: 20_000 }),
  ]);

  if (await pinSetup.isVisible()) {
    const TEST_PIN = '123456';
    const pinInputs = page.locator(
      '.step-card[data-step="3"][data-substep="pin-setup"] input[type="password"]',
    );
    await expect(pinInputs).toHaveCount(2);
    await pinInputs.nth(0).fill(TEST_PIN);
    await pinInputs.nth(1).fill(TEST_PIN);
    await page
      .locator('.step-card[data-step="3"][data-substep="pin-setup"] button[type="submit"]')
      .click();
  }

  await expect(finalCard).toBeVisible({ timeout: 20_000 });

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
  await emulatePwaLaunchMode(page);
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

  // Headless Chromium's virtual authenticator does not advertise PRF, so
  // the wizard routes through `pin-setup` before completing — same shape
  // as createVaultWithRs (covers both PRF and non-PRF setups).
  const pinSetup = page.locator('.step-card[data-step="3"][data-substep="pin-setup"]');
  const finalCard = page.getByTestId('wizard-final');
  await Promise.race([
    pinSetup.waitFor({ state: 'visible', timeout: 20_000 }),
    finalCard.waitFor({ state: 'visible', timeout: 20_000 }),
  ]);

  if (await pinSetup.isVisible()) {
    const TEST_PIN = '123456';
    const pinInputs = page.locator(
      '.step-card[data-step="3"][data-substep="pin-setup"] input[type="password"]',
    );
    await expect(pinInputs).toHaveCount(2);
    await pinInputs.nth(0).fill(TEST_PIN);
    await pinInputs.nth(1).fill(TEST_PIN);
    await page
      .locator('.step-card[data-step="3"][data-substep="pin-setup"] button[type="submit"]')
      .click();
  }

  await expect(finalCard).toBeVisible({ timeout: 20_000 });

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
