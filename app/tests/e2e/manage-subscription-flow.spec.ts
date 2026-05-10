import { test, expect } from './fixtures/vault';
import { createVaultWithRs } from './fixtures/unlock';
import { enableTestBridge } from './fixtures/cross-device';
import { activeStripeSubscription, stubSubscription, openPlanViaBridge } from './fixtures/billing';

// Tap "Spravovat předplatné" on the active-Stripe PlanScreen → assert
// tricho-auth's portal endpoint is hit and the portalUrl points at our
// local Stripe stack. Do not navigate off-origin.

test.setTimeout(60_000);

test('Active-Stripe PlanScreen → manage opens an in-stack Stripe portal URL', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();

  let portalCallCount = 0;
  let portalUrlSeen: string | null = null;
  await page.route('**/auth/billing/stripe/portal**', async (route) => {
    portalCallCount++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ portalUrl: 'https://stripe-mock.tricho.test/billing-portal/test' }),
    });
  });
  await page.route('https://stripe-mock.tricho.test/**', async (route) => {
    portalUrlSeen = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>stub-stripe-portal</body></html>',
    });
  });

  try {
    await createVaultWithRs(page);
    await stubSubscription(page, activeStripeSubscription({ tier: 'pro', period: 'year' }));
    await openPlanViaBridge(page);

    await expect(page.getByTestId('plan-current-state-active')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('plan-manage-cta').evaluate((el: HTMLElement) => el.click());

    await expect.poll(() => portalCallCount, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect.poll(() => portalUrlSeen, { timeout: 10_000 }).toContain('stripe-mock.tricho.test');
  } finally {
    await context.close();
  }
});
