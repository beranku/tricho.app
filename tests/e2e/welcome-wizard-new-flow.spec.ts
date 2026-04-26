import { test, expect } from './fixtures/vault';
import { createVaultWithRs } from './fixtures/unlock';
import { enableTestBridge, waitForBridge } from './fixtures/cross-device';

// End-to-end the new-account flow: OAuth → wizard Step 3 new flow →
// generate RS → verify by typed last-4 → activate biometrics → final
// → unlocked app shell. The fixture does most of the work; this spec
// just pins that the wizard's testids work and the bridge surfaces a
// vaultId at the end.

test('new-flow wizard creates a vault and reaches the unlocked shell', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    const created = await createVaultWithRs(page);
    expect(created.recoverySecret.length).toBeGreaterThan(0);
    expect(created.recoverySecret).toMatch(/^[A-Z2-7]{52}$/);

    // The unlocked phone shell mounts the e2e bridge with a vaultId.
    const vaultId = await waitForBridge(page);
    expect(vaultId).toMatch(/.+/);
  } finally {
    await context.close();
  }
});

test('new-flow QR substep exposes the wizard test bridge with the generated RS', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    // Mid-flow assertion: stop after Step 3 mounts and read the bridge.
    const { encoded, checksum } = await (async () => {
      // We can't easily mid-flow stop createVaultWithRs without
      // restructuring it; instead, re-run the start of its work inline.
      const { openVaultAsTestUser } = await import('./fixtures/vault');
      const { attachVirtualAuthenticator } = await import('./fixtures/webauthn');
      const user = await openVaultAsTestUser(page);
      await attachVirtualAuthenticator(page);
      await page.addInitScript(
        ({ key, payload }) => {
          try {
            sessionStorage.setItem(key, payload);
          } catch {
            /* noop */
          }
        },
        {
          key: 'tricho-oauth-result',
          payload: JSON.stringify({
            ok: true,
            isNewUser: true,
            deviceApproved: true,
            hasRemoteVault: false,
            couchdbUsername: user.couchdbUsername,
            email: user.email,
            name: null,
            picture: null,
            provider: 'google',
            deviceId: `device-${user.sub}`,
            devices: [],
            subscription: { tier: 'free', deviceLimit: 2, storageLimitMB: 100, paidUntil: null },
            tokens: {
              jwt: user.jwt,
              jwtExp: Math.floor(Date.now() / 1000) + 3600,
              refreshToken: user.refreshToken,
              refreshTokenExp: Math.floor(Date.now() / 1000) + 86400,
            },
          }),
        },
      );
      await page.goto('/');
      await page
        .locator('.step-card[data-step="3"][data-state="active"][data-flow="new"]')
        .waitFor({ timeout: 20_000 });
      const handle = await page.waitForFunction(
        () => {
          const w = window as unknown as {
            __trichoWizardE2E?: { generatedRs: { encoded: string; checksum: string } };
          };
          return w.__trichoWizardE2E?.generatedRs ?? null;
        },
        null,
        { timeout: 10_000 },
      );
      return (await handle.jsonValue()) as { encoded: string; checksum: string };
    })();

    expect(encoded).toMatch(/^[A-Z2-7]{52}$/);
    expect(checksum).toMatch(/^[A-Z2-7]{4}$/);
    expect(encoded.endsWith(checksum)).toBe(true);
  } finally {
    await context.close();
  }
});
