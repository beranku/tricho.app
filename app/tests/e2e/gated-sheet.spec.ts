import { test, expect } from './fixtures/vault';
import { createVaultWithRs } from './fixtures/unlock';
import { enableTestBridge } from './fixtures/cross-device';
import { expiredSubscription, stubSubscription } from './fixtures/billing';

// GatedSheet shows when sync flips to `gated` (subscription expired/past
// grace). The bridge `setGated(true)` forces the gate without depending on
// sync timing. The sheet is non-blocking — "Pokračovat offline" dismisses,
// "Obnovit nyní" routes to PlanScreen.

test('GatedSheet appears when gated, dismiss hides it', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    await stubSubscription(page, expiredSubscription());
    await createVaultWithRs(page);

    await page.evaluate(() => {
      const w = window as unknown as { __trichoE2E?: { setGated?: (g: boolean) => void } };
      w.__trichoE2E?.setGated?.(true);
    });

    const sheet = page.getByTestId('gated-sheet');
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('gated-sheet-renew')).toBeVisible();
    await expect(page.getByTestId('gated-sheet-dismiss')).toBeVisible();

    await page.getByTestId('gated-sheet-dismiss').click();
    await expect(sheet).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('GatedSheet renew button routes to PlanScreen', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    await stubSubscription(page, expiredSubscription());
    await createVaultWithRs(page);

    await page.evaluate(() => {
      const w = window as unknown as { __trichoE2E?: { setGated?: (g: boolean) => void } };
      w.__trichoE2E?.setGated?.(true);
    });

    await expect(page.getByTestId('gated-sheet')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('gated-sheet-renew').click();
    await expect(page.getByTestId('plan-screen')).toBeVisible({ timeout: 10_000 });
  } finally {
    await context.close();
  }
});
