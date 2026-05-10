import { test, expect } from '@playwright/test';
import { createVaultWithRs, emulatePwaLaunchMode } from './fixtures/unlock';
import { enableTestBridge, waitForBridge } from './fixtures/cross-device';
import { writeCustomerOn, readCustomerOn, waitForSyncPaused } from './fixtures/sync-flows';
import { openVaultAsTestUser } from './fixtures/vault';
import { grandfatherFreeDevices, waitForServerVaultState } from './fixtures/admin';

// Local-ZIP → fresh-device round-trip:
//   1. Device A creates a vault, writes a unique-named customer.
//   2. Device A generates a `.tricho-backup.zip` via the in-page exporter.
//   3. Device A's vault-state lands on the server (so wizard probe sees it).
//   4. Device B opens fresh, wizard probes server → existing flow.
//   5. B switches to "Mám zálohu" (restore-zip) flow, picks the ZIP bytes,
//      types the RS, registers passkey + PIN, lands unlocked.
//   6. B's `__trichoE2E.getCustomer(<id>)` returns A's customer.

test.setTimeout(120_000);

test('Device A exports ZIP → Device B restores via wizard restore-zip flow', async ({ browser }) => {
  const sub = `e2e-zip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // --- Device A ---------------------------------------------------------
  const ctxA = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(ctxA);
  const pageA = await ctxA.newPage();

  const { user, recoverySecret } = await createVaultWithRs(pageA, { sub });
  await waitForBridge(pageA);

  const SECRET_NAME = `LocalZipRestoreE2E-${Date.now()}`;
  const wrote = await writeCustomerOn(pageA, {
    firstName: SECRET_NAME,
    lastName: 'Backup',
    notes: 'restore-target',
  });

  await waitForSyncPaused(pageA);
  // Make sure vault-state has actually landed on the server — the
  // first `paused` can fire before the initial push completes.
  await waitForServerVaultState(user.couchdbUsername);

  // Generate ZIP in-page via the e2e bridge (works against the prod
  // dist; the vite-served `/src/...` import only works in dev mode).
  const b64 = await pageA.evaluate(async () => {
    const w = window as unknown as {
      __trichoE2E?: {
        generateBackupZip?: (monthKey?: string) => Promise<{ b64: string; filename: string }>;
      };
    };
    if (!w.__trichoE2E?.generateBackupZip) throw new Error('bridge has no generateBackupZip');
    return w.__trichoE2E.generateBackupZip();
  });

  expect(b64.b64.length).toBeGreaterThan(100);

  await grandfatherFreeDevices(user.couchdbUsername);

  // --- Device B ---------------------------------------------------------
  // We bypass the synthetic wizard fixture (which assumes the new-flow path)
  // and drive the existing-flow → restore-zip branch ourselves.
  const ctxB = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(ctxB);
  const pageB = await ctxB.newPage();

  // Force PWA standalone mode so the wizard skips the install prompt step.
  await emulatePwaLaunchMode(pageB);
  // Real OAuth so the wizard's server probe finds A's vault-state.
  await openVaultAsTestUser(pageB, { sub });
  await pageB.goto('/');

  // Wizard's existing flow card must mount because the server now has
  // A's vault-state (uploaded by A's onUnlocked + replicated through the
  // tricho-auth proxy).
  await expect(
    pageB.locator('.step-card[data-step="3"][data-state="active"][data-flow="existing"]'),
  ).toBeVisible({ timeout: 30_000 });

  // Switch to the restore-zip branch (button is only rendered while the
  // existing flow's manual RS textarea is empty).
  await pageB.getByTestId('wizard-existing-switch-to-zip').click();
  await expect(pageB.getByTestId('wizard-restore-pick-zip')).toBeVisible();

  // Drop the ZIP bytes into the file input.
  const filePayload = await pageB.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return Array.from(bytes);
  }, b64.b64);
  await pageB.getByTestId('wizard-restore-pick-input').setInputFiles({
    name: b64.filename,
    mimeType: 'application/zip',
    buffer: Buffer.from(filePayload),
  });
  await pageB.getByTestId('wizard-restore-pick-continue').click();

  // Verify-RS substep — type Device A's recovery secret.
  await expect(pageB.getByTestId('wizard-restore-verify-rs')).toBeVisible();
  await pageB.getByTestId('wizard-restore-verify-input').fill(recoverySecret);
  await pageB.getByTestId('wizard-restore-verify-submit').click();

  // After a successful unwrap, AppShell sets dek/vaultId which triggers
  // onUnlocked → setView('unlocked'). Poll the bridge until it's mounted
  // on B's vault (proves the unlock completed).

  await waitForBridge(pageB, 60_000);

  // Read A's customer on B — proves the ZIP-derived docs are decryptable
  // with the same DEK (vault-state from the ZIP keyed B's local vault).
  let onB: { firstName?: string } | null = null;
  for (let i = 0; i < 60 && onB?.firstName !== SECRET_NAME; i++) {
    await new Promise((r) => setTimeout(r, 500));
    onB = await readCustomerOn<{ firstName: string }>(pageB, wrote.id);
  }
  expect(onB?.firstName).toBe(SECRET_NAME);

  await ctxA.close();
  await ctxB.close();
});
