import { test, expect } from './fixtures/vault';
import { createVaultWithRs } from './fixtures/unlock';
import { enableTestBridge } from './fixtures/cross-device';
import {
  freeSubscription,
  activeStripeSubscription,
  activeBankTransferSubscription,
  canceledSubscription,
  inGraceSubscription,
  stubSubscription,
  openPlanViaBridge,
} from './fixtures/billing';

// Render PlanScreen for each subscription state and assert the right
// copy + buttons are surfaced. Subscription is stubbed via page.route so
// the spec does not depend on backend mutation order. This is the
// regression guard for billing UI.

test('PlanScreen renders the Free state with upgrade CTA', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    await createVaultWithRs(page);
    await stubSubscription(page, freeSubscription());
    await openPlanViaBridge(page);

    await expect(page.getByTestId('plan-screen')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('plan-current-state-free')).toBeVisible();
    await expect(page.getByTestId('plan-upgrade-cta')).toBeVisible();
    await expect(page.getByTestId('plan-cancel-cta')).toHaveCount(0);
    await expect(page.getByTestId('plan-manage-cta')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('PlanScreen renders active Stripe state with manage + cancel buttons', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    await createVaultWithRs(page);
    await stubSubscription(page, activeStripeSubscription({ tier: 'pro', period: 'year' }));
    await openPlanViaBridge(page);

    await expect(page.getByTestId('plan-current-state-active')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('plan-manage-cta')).toBeVisible();
    await expect(page.getByTestId('plan-cancel-cta')).toBeVisible();
    await expect(page.getByTestId('plan-upgrade-cta')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('PlanScreen renders active bank-transfer state with pay-next + cancel', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    await createVaultWithRs(page);
    await stubSubscription(page, activeBankTransferSubscription({ tier: 'max', period: 'year' }));
    await openPlanViaBridge(page);

    await expect(page.getByTestId('plan-current-state-active')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('plan-pay-next-cta')).toBeVisible();
    await expect(page.getByTestId('plan-cancel-cta')).toBeVisible();
    await expect(page.getByTestId('plan-manage-cta')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('PlanScreen renders canceled state without manage/cancel buttons', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    await createVaultWithRs(page);
    await stubSubscription(page, canceledSubscription({ provider: 'stripe' }));
    await openPlanViaBridge(page);

    await expect(page.getByTestId('plan-current-state-canceled')).toBeVisible({ timeout: 10_000 });
    // Already canceled — no further cancel button.
    await expect(page.getByTestId('plan-cancel-cta')).toHaveCount(0);
    // Manage Stripe portal is still meaningful while paidUntil is in the
    // future (final invoice, payment method) but PlanScreen suppresses it
    // for canceled subscriptions; track that.
    await expect(page.getByTestId('plan-manage-cta')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('PlanScreen renders in-grace state with renewal cue', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    await createVaultWithRs(page);
    await stubSubscription(page, inGraceSubscription());
    await openPlanViaBridge(page);

    await expect(page.getByTestId('plan-current-state-in-grace')).toBeVisible({ timeout: 10_000 });
    // The grace card is shown; the cancel button is still surfaced
    // (subscription is not canceled, just expired-with-grace).
    await expect(page.getByTestId('plan-cancel-cta')).toBeVisible();
  } finally {
    await context.close();
  }
});
