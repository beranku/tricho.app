import { test, expect } from './fixtures/vault';
import { createVaultWithRs } from './fixtures/unlock';
import { enableTestBridge } from './fixtures/cross-device';

// Thin first-run journey end-to-end: onboarding → diár → FAB placeholder
// → menu → settings entry → back. Smoke-level assertions only — the
// per-feature specs do the heavy lifting. This spec exists primarily as
// the GIF-capture target for the claude-in-chrome MCP debugging loop and
// to prove the journey hangs together without dead-ends.

test('first-run journey: onboarding → diár → FAB → menu → settings → back', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    // Onboarding (uses the existing fixture which walks the full wizard).
    await createVaultWithRs(page);

    // Diár: today's section is rendered with the FAB visible.
    await expect(page.locator('section.day-section[data-today="true"]')).toBeVisible({
      timeout: 10_000,
    });
    const fab = page.locator('button.fab').first();
    await expect(fab).toBeVisible();

    // FAB → deferred-feature placeholder (smoke check on title only).
    await fab.click();
    await expect(page.getByTestId('fab-add-title')).toHaveText('Plánování v příští verzi');

    // Close the sheet (Escape works because BottomSheet binds it).
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('fab-add-sheet')).toHaveCount(0);

    // Menu → Nastavení.
    await page.locator('button.chrome-glyph[aria-label="Otevřít menu"]').click();
    await page.locator('.sheet').first().getByText('Nastavení', { exact: true }).first().click();
    await expect(page.getByRole('heading', { level: 2, name: 'Nastavení' })).toBeVisible();

    // Close Settings ("Zavřít" — the top-level close, not "Zpět" subview-back).
    await page.getByRole('button', { name: 'Zavřít' }).first().click();
    await expect(page.locator('button.fab').first()).toBeVisible({ timeout: 10_000 });
  } finally {
    await context.close();
  }
});
