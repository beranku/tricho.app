import { test, expect } from './fixtures/vault';
import { createVaultWithRs } from './fixtures/unlock';
import { enableTestBridge } from './fixtures/cross-device';
import { inGraceSubscription, stubSubscription } from './fixtures/billing';

// RenewBanner is mounted in the unlocked shell when the subscription is in
// grace (paidUntil expired, gracePeriodEndsAt in the future). It must be
// tappable and route to PlanScreen.

test.setTimeout(90_000);

test('RenewBanner mounts in unlocked shell during grace period and routes to PlanScreen', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    await stubSubscription(page, inGraceSubscription());
    await createVaultWithRs(page);

    // Seed subscriptionStore via the e2e bridge — the wizard-completed
    // unlock path doesn't trigger a fetch the way the OAuth-resume path
    // does, so RenewBanner needs explicit data to render.
    await page.evaluate((sub) => {
      const w = window as unknown as {
        __trichoE2E?: { setSubscription?: (s: unknown) => void };
      };
      w.__trichoE2E?.setSubscription?.(sub);
    }, inGraceSubscription() as unknown);

    const banner = page.getByTestId('renew-banner');
    await expect(banner).toBeVisible({ timeout: 15_000 });

    // Use a DOM click to bypass an actionability hiccup where Playwright's
    // mouse click is reported as fired but the React handler doesn't run.
    await banner.evaluate((el: HTMLElement) => el.click());
    await expect(page.getByTestId('plan-screen')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('plan-current-state-in-grace')).toBeVisible();
  } finally {
    await context.close();
  }
});
