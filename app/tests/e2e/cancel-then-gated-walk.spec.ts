import { test, expect } from './fixtures/vault';
import { createVaultWithRs } from './fixtures/unlock';
import { enableTestBridge } from './fixtures/cross-device';
import {
  activeStripeSubscription,
  expiredSubscription,
  openPlanViaBridge,
} from './fixtures/billing';

// Walk a paid user from active → cancel → expired-past-grace → GatedSheet.
// Uses route stubs for `/auth/subscription` (so we don't need a working
// Stripe round-trip) and the `setGated` bridge to mirror the 402-driven
// flip the production sync layer would normally do.

test.setTimeout(60_000);

test('Cancel CTA → expiry → unlocked shell shows GatedSheet', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();

  let cancelCallCount = 0;
  let currentSub: ReturnType<typeof activeStripeSubscription> | ReturnType<typeof expiredSubscription> =
    activeStripeSubscription({ tier: 'pro', period: 'year' });

  await page.route('**/auth/subscription', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subscription: currentSub }),
    });
  });
  await page.route('**/auth/subscription/cancel', async (route) => {
    cancelCallCount++;
    // Mirror the production server: cancel returns ok and the next /auth
    // /subscription read reflects status=canceled with paidUntil intact.
    // Then the test will manually flip it to expired-past-grace below.
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  try {
    await createVaultWithRs(page);

    // Step 1 — open Plan, verify active state, tap Cancel.
    await openPlanViaBridge(page);
    await expect(page.getByTestId('plan-current-state-active')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('plan-cancel-cta').evaluate((el: HTMLElement) => el.click());
    await expect.poll(() => cancelCallCount, { timeout: 10_000 }).toBeGreaterThan(0);

    // Step 2 — flip the stubbed subscription to expired-past-grace and
    // mirror the 402-driven sync gate via the e2e bridge.
    currentSub = expiredSubscription();
    await page.evaluate(() => {
      const w = window as unknown as {
        __trichoE2E?: { setView?: (v: string) => void; setGated?: (g: boolean) => void };
      };
      w.__trichoE2E?.setView?.('unlocked');
      w.__trichoE2E?.setGated?.(true);
    });

    // Step 3 — assert GatedSheet renders with both CTAs.
    await expect(page.getByTestId('gated-sheet')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('gated-sheet-renew')).toBeVisible();
    await expect(page.getByTestId('gated-sheet-dismiss')).toBeVisible();
  } finally {
    await context.close();
  }
});
