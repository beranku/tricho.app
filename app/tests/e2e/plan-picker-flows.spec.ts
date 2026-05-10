import { test, expect } from './fixtures/vault';
import { createVaultWithRs } from './fixtures/unlock';
import { enableTestBridge } from './fixtures/cross-device';
import { freeSubscription, stubSubscription, openPlanViaBridge } from './fixtures/billing';

// Drive the PlanPicker UI without going through the menu / Settings drill.
// Uses stubbed `/auth/subscription` + `/auth/plans` so the picker is
// deterministic even if BILLING_UI_ENABLED varies between builds.

test.setTimeout(60_000);

async function openPicker(page: import('@playwright/test').Page) {
  await openPlanViaBridge(page);
  await expect(page.getByTestId('plan-screen')).toBeVisible({ timeout: 10_000 });
  // Force-click the upgrade CTA via the DOM API — Playwright's mouse click
  // can race with React hydration on the PWA shell here.
  await page
    .getByTestId('plan-upgrade-cta')
    .evaluate((el: HTMLElement) => el.click());
  await expect(page.getByTestId('plan-picker')).toBeVisible({ timeout: 10_000 });
}

test('PlanPicker exposes Pro + Max tier rows and both payment paths', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    await createVaultWithRs(page);
    await stubSubscription(page, freeSubscription());
    await openPicker(page);

    await expect(page.getByTestId('plan-picker-tier-pro')).toBeVisible();
    await expect(page.getByTestId('plan-picker-tier-max')).toBeVisible();
    await expect(page.getByTestId('plan-picker-period-month')).toBeVisible();
    await expect(page.getByTestId('plan-picker-period-year')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('Selecting a tier surfaces both pay-card and pay-bank buttons', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    await createVaultWithRs(page);
    await stubSubscription(page, freeSubscription());
    await openPicker(page);

    // No tier selected → pay buttons hidden.
    await expect(page.getByTestId('plan-picker-pay-card')).toHaveCount(0);
    await expect(page.getByTestId('plan-picker-pay-bank')).toHaveCount(0);

    await page.getByTestId('plan-picker-tier-pro').evaluate((el: HTMLElement) => el.click());
    await expect(page.getByTestId('plan-picker-pay-card')).toBeVisible();
    await expect(page.getByTestId('plan-picker-pay-bank')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('Switching period between month and year persists selected tier', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    await createVaultWithRs(page);
    await stubSubscription(page, freeSubscription());
    await openPicker(page);

    await page.getByTestId('plan-picker-tier-max').evaluate((el: HTMLElement) => el.click());
    await expect(page.getByTestId('plan-picker-pay-card')).toBeVisible();

    // Default period is month — flip to year and back; pay buttons remain.
    await page.getByTestId('plan-picker-period-year').evaluate((el: HTMLElement) => el.click());
    await expect(page.getByTestId('plan-picker-pay-card')).toBeVisible();
    await page.getByTestId('plan-picker-period-month').evaluate((el: HTMLElement) => el.click());
    await expect(page.getByTestId('plan-picker-pay-card')).toBeVisible();
  } finally {
    await context.close();
  }
});
