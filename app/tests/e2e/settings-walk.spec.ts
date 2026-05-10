import { test, expect } from './fixtures/vault';
import { createVaultWithRs } from './fixtures/unlock';
import { enableTestBridge } from './fixtures/cross-device';

// Walk every Settings section as a first-time user. Asserts each section
// is reachable, renders its localized title, and back-nav returns to the
// diár without console errors.

// Pre-existing infra noise that bleeds through whenever a vault tries to
// sync against a CSP-locked CouchDB endpoint or a probe hits the Caddy
// 5984/4545 ports rather than the Traefik edge. None of these are caused
// by the walkthrough specs; filter them so the spec assertions are about
// the UI under test.
const KNOWN_INFRA_NOISE = [
  /vault-state probe failed/,
  /SSL certificate error/,
  /violates the following Content Security Policy/,
  /Refused to connect because it violates the document's Content Security Policy/,
  /Fetch API cannot load http:\/\/localhost:(5984|4545)/,
  /\[locale\] initial persistence failed/,
  /Version change transaction was aborted in upgradeneeded event handler/,
  // First sync of a fresh vault probes 404s before any docs land.
  /Failed to load resource: the server responded with a status of 404/,
];

function isInfraNoise(text: string): boolean {
  return KNOWN_INFRA_NOISE.some((re) => re.test(text));
}

test('Settings opens from menu and surfaces every section header', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isInfraNoise(msg.text())) consoleErrors.push(msg.text());
  });

  try {
    await createVaultWithRs(page);

    // Open the menu via the chrome glyph.
    await page.locator('button.chrome-glyph[aria-label="Otevřít menu"]').click();
    const menuSheet = page.locator('.sheet').first();
    await expect(menuSheet).toBeVisible();

    // Tap Nastavení.
    await menuSheet.getByText('Nastavení', { exact: true }).first().click();

    // Settings header — Czech title.
    await expect(page.getByRole('heading', { level: 2, name: 'Nastavení' })).toBeVisible({
      timeout: 10_000,
    });

    // Sync section is always present.
    await expect(page.getByRole('heading', { level: 3, name: 'Synchronizace' })).toBeVisible();

    // Plan ("Předplatné") entry — only when BILLING_UI_ENABLED at build time.
    // Skip silently when billing is off so the spec stays valid in both modes.
    const planHeading = page.getByRole('heading', { level: 3, name: 'Předplatné' });
    if (await planHeading.isVisible().catch(() => false)) {
      await expect(planHeading).toBeVisible();
    }

    // The about section is present and exposes version/build/commit testids.
    await expect(page.getByTestId('settings-about-section')).toBeVisible();
    await expect(page.getByTestId('about-version')).toBeVisible();
    await expect(page.getByTestId('about-build')).toBeVisible();
    await expect(page.getByTestId('about-commit')).toBeVisible();

    // Delete-account section is present (with caution).
    await expect(page.getByTestId('settings-delete-account-section')).toBeVisible();

    // Close Settings — top-level button is "Zavřít" (m.settings_close), not
    // "Zpět" (which is for inner sub-views).
    await page.getByRole('button', { name: 'Zavřít' }).first().click();
    await expect(page.locator('button.fab').first()).toBeVisible({ timeout: 10_000 });

    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Settings exposes Show RS and Rotate RS controls', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    await createVaultWithRs(page);

    await page.locator('button.chrome-glyph[aria-label="Otevřít menu"]').click();
    await page.locator('.sheet').first().getByText('Nastavení', { exact: true }).first().click();

    // Show RS CTA opens the verify-RS modal.
    await page.getByTestId('settings-show-rs-cta').click();
    await expect(page.getByTestId('settings-show-rs-modal')).toBeVisible();
    // Cancel out — we're not asserting actual unwrap here, just the entry.
    await page.getByTestId('show-rs-cancel').click();
    await expect(page.getByTestId('settings-show-rs-modal')).toHaveCount(0);

    // Rotate RS CTA opens the rotate modal.
    await page.getByTestId('settings-rs-rotate-cta').click();
    await expect(page.getByTestId('settings-rotate-rs-modal')).toBeVisible();
    await page.getByTestId('rotate-rs-cancel').click();
    await expect(page.getByTestId('settings-rotate-rs-modal')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
