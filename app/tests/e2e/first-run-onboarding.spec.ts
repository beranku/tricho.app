import { test, expect, openVaultAsTestUser } from './fixtures/vault';
import { attachVirtualAuthenticator } from './fixtures/webauthn';
import { enableTestBridge } from './fixtures/cross-device';
import type { Page } from '@playwright/test';

const SESSION_OAUTH_KEY = 'tricho-pending-oauth';

// Emulate PWA launch mode + Czech host locale before any page script
// runs. Step 2 / Step 3 of the wizard are gated behind `launchMode ===
// 'pwa'` (`src/lib/launch-mode.ts`); without this hook a headless tab
// stays on Step 1 forever. Identical to the override in
// `welcome-wizard-pwa-mode.spec.ts`.
async function emulatePwaMode(page: Page): Promise<void> {
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
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
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

// Walk the welcome wizard from a brand-new user's perspective and
// assert that EVERY step surfaces a visible primary CTA — i.e. the user
// is never stuck. Complements `welcome-wizard-new-flow.spec.ts` (which
// asserts the end-to-end happy path) by guarding the "primary CTA at
// each step is visible and reachable" property explicitly.

test('Step 1 install card has a visible primary CTA', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    // Step 1 is the install card — only rendered for non-PWA launches.
    // Don't emulate PWA mode here so the install card actually appears.
    await page.goto('/');
    const step1 = page.locator('.step-card[data-step="1"]');
    await expect(step1).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('wizard-step1-confirm')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('Step 2 sign-in card has visible Google + Apple CTAs', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    // Emulate PWA mode so the wizard advances past Step 1.
    await emulatePwaMode(page);
    await page.goto('/');

    await expect(page.getByTestId('wizard-step2-google')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('wizard-step2-apple')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('Step 3 new-flow surfaces the QR substep with a Continue CTA', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    // Emulate PWA mode so OnboardingWizard advances past Step 1+2.
    await emulatePwaMode(page);
    await attachVirtualAuthenticator(page);

    // Drive the OAuth round-trip; AppShell consumes the URL fragment and
    // routes the wizard to Step 3 new-flow because the vault is empty.
    await openVaultAsTestUser(page);

    await expect(
      page.locator('.step-card[data-step="3"][data-state="active"][data-flow="new"]'),
    ).toBeVisible({ timeout: 20_000 });

    // QR canvas + continue CTA both present.
    await expect(page.getByTestId('wizard-qr-canvas')).toBeVisible();
    await expect(page.getByTestId('wizard-qr-continue')).toBeVisible();
  } finally {
    await context.close();
  }
});
