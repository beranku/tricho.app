import { test, expect } from '@playwright/test';
import { createVaultWithRs, joinVaultWithRs } from './fixtures/unlock';
import { enableTestBridge, waitForBridge } from './fixtures/cross-device';

// Existing-account flow: Device A creates a vault, Device B signs in
// for the same `sub`, the wizard auto-selects Step 3 existing flow
// based on the server vault-state probe, and the user pastes the same
// RS to unwrap the shared DEK on the new device.

test('Device B joins via the wizard existing flow with Device A\'s RS', async ({ browser }) => {
  const sub = `e2e-existing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Device A: create the vault.
  const ctxA = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(ctxA);
  const pageA = await ctxA.newPage();
  let createdRs: string;
  let vaultIdA: string;
  try {
    const created = await createVaultWithRs(pageA, { sub });
    createdRs = created.recoverySecret;
    vaultIdA = await waitForBridge(pageA);
  } finally {
    /* keep ctxA open for shared-vault assertion */
  }

  // Device B: sign in for the same sub, wizard routes to existing flow.
  const ctxB = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(ctxB);
  const pageB = await ctxB.newPage();
  try {
    await joinVaultWithRs(pageB, { sub, recoverySecret: createdRs });
    const vaultIdB = await waitForBridge(pageB);
    expect(vaultIdB).toBe(vaultIdA);
  } finally {
    await ctxB.close();
    await ctxA.close();
  }
});
