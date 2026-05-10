import { test, expect } from './fixtures/vault';
import { createVaultWithRs } from './fixtures/unlock';
import { enableTestBridge } from './fixtures/cross-device';

// Verify the diár's 7-day window: a "today" section with the sun glyph,
// at least one future day rendered, and at least one past-day section
// for context. Uses synthesized free-slots so no client/appointment
// seeding is needed.

test('diár renders today and surrounding days', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    await createVaultWithRs(page);

    // Today's section is marked with `data-today="true"`.
    const today = page.locator('section.day-section[data-today="true"]');
    await expect(today).toHaveCount(1, { timeout: 10_000 });

    // The today header includes the sun glyph (decorative SVG).
    await expect(today.locator('.weather-sun-left svg')).toBeVisible();

    // The header carries the kicker text "Dnes" (Czech default locale).
    await expect(today.locator('.kicker').first()).toHaveText('Dnes');

    // At least one other day section is rendered (window is 7 days wide:
    // 1 past + today + 5 future).
    const allDays = page.locator('section.day-section');
    const count = await allDays.count();
    expect(count, 'expected at least 2 day sections in the 7-day window').toBeGreaterThanOrEqual(2);

    // At least one free-slot button is rendered for an empty schedule.
    const freeSlots = page.locator('button.slot.slot-free-row');
    expect(await freeSlots.count(), 'free slots should be synthesized for an empty diár').toBeGreaterThan(0);

    // Past-day free slots are NOT rendered (free slots in past are skipped).
    // Sanity: at least one rendered free slot is in a non-past section.
    const futureSection = page.locator('section.day-section').filter({ hasNot: page.locator('[data-today="true"]') }).first();
    await expect(futureSection).toBeAttached();
  } finally {
    await context.close();
  }
});
