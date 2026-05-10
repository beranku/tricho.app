import { test, expect } from './fixtures/vault';
import { createVaultWithRs } from './fixtures/unlock';
import { enableTestBridge } from './fixtures/cross-device';
import { activeStripeSubscription, canceledSubscription, openPlanViaBridge } from './fixtures/billing';

// Tap "Zrušit předplatné" on an active-Stripe PlanScreen → assert
// tricho-auth's cancel endpoint is hit; then re-stub the subscription as
// canceled and confirm PlanScreen reflects the canceled state.

test.setTimeout(60_000);

test('Cancel button hits cancel endpoint; PlanScreen flips to canceled state', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();

  let cancelCallCount = 0;
  let activeUntilCancel = activeStripeSubscription({ tier: 'pro', period: 'year' });
  let currentSub: ReturnType<typeof activeStripeSubscription> | ReturnType<typeof canceledSubscription> = activeUntilCancel;

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
    currentSub = canceledSubscription({ tier: 'pro', period: 'year' });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  try {
    await createVaultWithRs(page);
    await openPlanViaBridge(page);

    await expect(page.getByTestId('plan-current-state-active')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('plan-cancel-cta').evaluate((el: HTMLElement) => el.click());

    await expect.poll(() => cancelCallCount, { timeout: 10_000 }).toBeGreaterThan(0);
    // PlanScreen re-fetches subscription after cancel; assert it lands on
    // the canceled card and the cancel CTA is gone.
    await expect(page.getByTestId('plan-current-state-canceled')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('plan-cancel-cta')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
