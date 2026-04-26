import { test, expect } from '@playwright/test';

// Verifies the Step 1 floor: in a regular (non-standalone) browser
// context, no action — including "Mám nainstalováno" — advances past
// Step 1. Steps 2 and 3 stay locked.

test('browser mode mounts at Step 1 active, never advances past it', async ({ page }) => {
  await page.goto('/');

  // Wait for the wizard to render. Browser mode is the default in
  // Playwright (no display-mode: standalone media query match).
  const step1 = page.locator('.step-card[data-step="1"]');
  await expect(step1).toHaveAttribute('data-state', 'active');
  await expect(page.locator('.step-card[data-step="2"]')).toHaveAttribute('data-state', 'locked');
  await expect(page.locator('.step-card[data-step="3"]')).toHaveAttribute('data-state', 'locked');

  // Click "I have it installed" → body flips to post-install message,
  // but the cards stay locked.
  await page.getByTestId('wizard-step1-confirm').click();

  await expect(step1).toHaveAttribute('data-state', 'active');
  await expect(page.locator('.step-card[data-step="2"]')).toHaveAttribute('data-state', 'locked');
  await expect(page.locator('.step-card[data-step="3"]')).toHaveAttribute('data-state', 'locked');

  // Step 2 component never mounted → no Apple/Google buttons in DOM.
  await expect(page.getByTestId('wizard-step2-apple')).toHaveCount(0);
  await expect(page.getByTestId('wizard-step2-google')).toHaveCount(0);
});

test('browser mode "Ještě jsem ji neinstaloval/a" returns to install timeline', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('wizard-step1-confirm').click();
  await page.getByTestId('wizard-step1-cancel').click();

  // The confirm button is back, the post-install warning is gone.
  await expect(page.getByTestId('wizard-step1-confirm')).toBeVisible();
  await expect(page.getByText(/v prohlížeči by tvoje data nebyla v bezpečí/)).toHaveCount(0);
});
