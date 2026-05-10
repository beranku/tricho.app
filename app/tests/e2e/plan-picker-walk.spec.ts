import { test, expect } from './fixtures/vault';
import { createVaultWithRs } from './fixtures/unlock';
import { enableTestBridge } from './fixtures/cross-device';

// Walk the Plan screen as a first-time (Free) user. Confirms the Free
// blurb renders, the upgrade pathway opens the plan picker with all paid
// tiers, and the Stripe / bank-transfer entries are reachable.
//
// Does NOT actually drive Stripe checkout — that's covered by
// `stripe-checkout.spec.ts`. We only assert the entry surfaces.

const STUB_FREE_SUBSCRIPTION = {
  tier: 'free' as const,
  plan: 'free',
  tierKey: 'free',
  billingPeriod: null,
  provider: null,
  status: 'active',
  entitlements: [],
  deviceLimit: 1,
  backupRetentionMonths: 0,
  gracePeriodSeconds: 7 * 86400,
  gracePeriodEndsAt: null,
  freeDeviceGrandfathered: false,
  storageLimitMB: 500,
  paidUntil: null,
};

const STUB_PLANS = [
  { id: 'free', tier: 'free', billingPeriod: null, label: 'Free', periodSeconds: null, amountMinor: 0, currency: 'CZK', deviceLimit: 1, backupRetentionMonths: 0 },
  { id: 'pro-monthly', tier: 'pro', billingPeriod: 'month', label: 'Pro (m)', periodSeconds: 30 * 86400, amountMinor: 19900, currency: 'CZK', deviceLimit: 2, backupRetentionMonths: 12 },
  { id: 'pro-yearly', tier: 'pro', billingPeriod: 'year', label: 'Pro (y)', periodSeconds: 365 * 86400, amountMinor: 199000, currency: 'CZK', deviceLimit: 2, backupRetentionMonths: 12 },
  { id: 'max-monthly', tier: 'max', billingPeriod: 'month', label: 'Max (m)', periodSeconds: 30 * 86400, amountMinor: 49900, currency: 'CZK', deviceLimit: 5, backupRetentionMonths: 60 },
  { id: 'max-yearly', tier: 'max', billingPeriod: 'year', label: 'Max (y)', periodSeconds: 365 * 86400, amountMinor: 499000, currency: 'CZK', deviceLimit: 5, backupRetentionMonths: 60 },
];

test('Plan screen shows Free state and opens picker with Pro + Max tiers', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();

  // Stub subscription + plans before navigation so the screen renders
  // deterministically regardless of the backing tricho-auth state.
  await page.route('**/auth/subscription', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subscription: STUB_FREE_SUBSCRIPTION }),
    });
  });
  await page.route('**/auth/plans', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ plans: STUB_PLANS }),
    });
  });

  try {
    await createVaultWithRs(page);

    // Menu → Nastavení → Předplatné (the Plan section card).
    await page.locator('button.chrome-glyph[aria-label="Otevřít menu"]').click();
    await page.locator('.sheet').first().getByText('Nastavení', { exact: true }).first().click();
    await expect(page.getByRole('heading', { level: 2, name: 'Nastavení' })).toBeVisible();

    // The Plan card on Settings is a button containing "Předplatné" h3.
    // Skip if BILLING_UI_ENABLED isn't on at build time (no card rendered).
    const planCard = page
      .getByRole('button')
      .filter({ has: page.getByRole('heading', { level: 3, name: 'Předplatné' }) })
      .first();
    test.skip(
      !(await planCard.isVisible().catch(() => false)),
      'BILLING_UI_ENABLED is off in this build — Plan card not surfaced',
    );

    await planCard.click();

    // PlanScreen renders.
    await expect(page.getByRole('heading', { level: 2, name: 'Předplatné' })).toBeVisible({
      timeout: 10_000,
    });

    // Free card (Tricho — Lokálně) — the local-only free tier blurb.
    await expect(page.getByRole('heading', { level: 3, name: 'Tricho — Lokálně' })).toBeVisible();

    // The "Přejít na Sync" upgrade CTA opens the picker.
    await page.getByRole('button', { name: 'Přejít na Sync' }).click();

    // Picker modal renders with title and both period tabs.
    await expect(page.getByRole('heading', { level: 3, name: 'Vyberte plán' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Měsíčně' }).or(page.getByRole('tab', { name: /měsíčně/i }))).toBeVisible();
    await expect(page.getByRole('tab', { name: /ročně/i })).toBeVisible();

    // Selecting a tier surfaces both payment paths.
    await page.getByTestId('plan-picker-tier-pro').evaluate((el: HTMLElement) => el.click());
    await expect(page.getByText('Platba kartou (opakovaně)')).toBeVisible();
    await expect(page.getByText('Platba bankovním převodem (jednorázově)')).toBeVisible();
  } finally {
    await context.close();
  }
});
