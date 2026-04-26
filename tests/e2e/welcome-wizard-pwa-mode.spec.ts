import { test, expect } from '@playwright/test';

// PWA-mode emulation: override window.matchMedia('(display-mode:
// standalone)') and navigator.standalone before any wizard code runs.
// The wizard's `detectLaunchMode()` checks both, so either signal moves
// us into the PWA branch.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => {
        if (q === '(display-mode: standalone)') {
          return {
            matches: true,
            media: q,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
          } as MediaQueryList;
        }
        return original(q);
      },
    });
    Object.defineProperty(navigator, 'standalone', {
      configurable: true,
      value: true,
    });
  });
});

test('PWA mode mounts Step 1 done, Step 2 active, Step 3 locked', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.step-card[data-step="1"]')).toHaveAttribute('data-state', 'done');
  await expect(page.locator('.step-card[data-step="2"]')).toHaveAttribute('data-state', 'active');
  await expect(page.locator('.step-card[data-step="3"]')).toHaveAttribute('data-state', 'locked');
});

test('PWA mode renders Apple + Google OAuth buttons', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('wizard-step2-apple')).toBeVisible();
  await expect(page.getByTestId('wizard-step2-google')).toBeVisible();
});

test('PWA mode never shows the post-install message (Step 1 already done)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/Otevři Tricho.App z plochy/)).toHaveCount(0);
});
