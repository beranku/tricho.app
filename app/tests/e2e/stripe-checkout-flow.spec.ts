import { test, expect } from './fixtures/vault';
import { createVaultWithRs } from './fixtures/unlock';
import { enableTestBridge } from './fixtures/cross-device';
import { freeSubscription, stubSubscription, openPlanViaBridge } from './fixtures/billing';

// Tap "Platba kartou" in the picker → assert tricho-auth's checkout
// endpoint is hit and the URL it returns lives in our local Stripe stack
// (stripe-mock or localstripe). Do NOT navigate to Stripe — just confirm
// the wiring.

test.setTimeout(60_000);

test('PlanPicker → "Platba kartou" calls checkout and gets an in-stack checkoutUrl', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();

  let checkoutCallCount = 0;
  let checkoutUrlSeen: string | null = null;
  await page.route('**/auth/billing/stripe/checkout', async (route) => {
    checkoutCallCount++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ checkoutUrl: 'https://stripe-mock.tricho.test/checkout/test-session-1' }),
    });
  });

  // Block the actual Stripe redirect; we don't want the test browser
  // navigating off the PWA origin.
  await page.route('https://stripe-mock.tricho.test/**', async (route) => {
    checkoutUrlSeen = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>stub-stripe-checkout</body></html>',
    });
  });

  try {
    await createVaultWithRs(page);
    await stubSubscription(page, freeSubscription());
    await openPlanViaBridge(page);
    await expect(page.getByTestId('plan-screen')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('plan-upgrade-cta').evaluate((el: HTMLElement) => el.click());
    await expect(page.getByTestId('plan-picker')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('plan-picker-tier-pro').evaluate((el: HTMLElement) => el.click());
    await expect(page.getByTestId('plan-picker-pay-card')).toBeVisible();
    await page.getByTestId('plan-picker-pay-card').evaluate((el: HTMLElement) => el.click());

    await expect.poll(() => checkoutCallCount, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect.poll(() => checkoutUrlSeen, { timeout: 10_000 }).toContain('stripe-mock.tricho.test');
  } finally {
    await context.close();
  }
});
