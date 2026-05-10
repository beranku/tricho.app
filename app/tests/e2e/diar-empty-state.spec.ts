import { test, expect } from './fixtures/vault';
import { createVaultWithRs } from './fixtures/unlock';
import { enableTestBridge } from './fixtures/cross-device';

// Regression guard for the FabAddSheet placeholder. Commit ff9e306
// (paid plans + i18n migration) accidentally rewired the body to
// `m.menu_promo_body()` ("Otevřete plán a prohlížejte detaily klientů.") —
// a generic promo string that left first-time users with zero clients
// believing the app was broken. The `daily-schedule` SHALL pins the
// placeholder copy to "Plánování v příští verzi" + a deferred-feature
// body. This spec asserts that copy verbatim so the regression cannot
// re-enter unguarded.

const EXPECTED_TITLE = 'Plánování v příští verzi';
const EXPECTED_BODY_FRAGMENT = /Přidávání a úpravy zákroků dorazí v další verzi/;
const EXPECTED_BODY_TAIL = /Zatím můžeš prohlížet diár a otevírat karty klientek\.$/;
const REGRESSED_PROMO_BODY = 'Otevřete plán a prohlížejte detaily klientů.';

test('FAB tap on empty diár opens deferred-feature placeholder', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    await createVaultWithRs(page);

    // Empty vault → primary FAB still renders. Tap it.
    const fab = page.locator('button.fab').first();
    await expect(fab).toBeVisible();
    await fab.click();

    // The fab-add sheet renders with spec-aligned copy.
    const sheet = page.getByTestId('fab-add-sheet');
    await expect(sheet).toBeVisible();

    await expect(page.getByTestId('fab-add-title')).toHaveText(EXPECTED_TITLE);

    const body = page.getByTestId('fab-add-body');
    await expect(body).toBeVisible();
    await expect(body).toContainText(EXPECTED_BODY_FRAGMENT);
    await expect(body).toHaveText(EXPECTED_BODY_TAIL);

    // The regressed promo string MUST NOT appear anywhere in the sheet.
    await expect(sheet).not.toContainText(REGRESSED_PROMO_BODY);
  } finally {
    await context.close();
  }
});

test('Free-slot tap surfaces same placeholder with the slot time', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    await createVaultWithRs(page);

    // Free slots are synthesized for every future day in the 7-day window.
    // Today's first free-slot may be in the past; pick any rendered slot.
    const freeSlot = page.locator('button.slot.slot-free-row').first();
    await expect(freeSlot, 'at least one free slot must be rendered for the empty schedule').toBeVisible({
      timeout: 10_000,
    });

    // Read the slot's start time before clicking — we'll re-assert it inside
    // the sheet to prove the time prefix is wired through.
    const slotTime = await freeSlot.locator('.slot-time').first().innerText();
    expect(slotTime).toMatch(/^\d{2}:\d{2}$/);

    await freeSlot.click();

    const sheet = page.getByTestId('fab-add-sheet');
    await expect(sheet).toBeVisible();

    await expect(page.getByTestId('fab-add-title')).toHaveText(EXPECTED_TITLE);
    await expect(page.getByTestId('fab-add-time')).toHaveText(slotTime);
    await expect(page.getByTestId('fab-add-body')).toContainText(EXPECTED_BODY_FRAGMENT);
    await expect(sheet).not.toContainText(REGRESSED_PROMO_BODY);
  } finally {
    await context.close();
  }
});

test('FabAddSheet has no path forward (placeholder only — visit form is deferred)', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    await createVaultWithRs(page);

    await page.locator('button.fab').first().click();
    const sheet = page.getByTestId('fab-add-sheet');
    await expect(sheet).toBeVisible();

    // The only interactive element in the sheet is the close button.
    // (The form-to-create-a-visit is deferred per `daily-schedule` SHALL.)
    const interactive = sheet.locator('button, a, input, select, textarea');
    await expect(interactive).toHaveCount(1);
    await expect(interactive.first()).toHaveText(/Zavřít|Close/);
  } finally {
    await context.close();
  }
});
