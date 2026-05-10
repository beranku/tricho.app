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
    // Uses the same emulation hooks as createVaultWithRs (PWA launch mode +
    // cs locale) so the wizard advances past Step 1 and renders Czech copy;
    // OAuth is driven through the real fragment-based callback (commit
    // e702e03) and AppShell consumes the URL hash on first paint.
    const { encoded, checksum } = await (async () => {
      const { openVaultAsTestUser } = await import('./fixtures/vault');
      const { attachVirtualAuthenticator } = await import('./fixtures/webauthn');
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
        Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
        Object.defineProperty(navigator, 'language', { configurable: true, get: () => 'cs-CZ' });
        Object.defineProperty(navigator, 'languages', {
          configurable: true,
          get: () => ['cs-CZ', 'cs'],
        });
      });
      await attachVirtualAuthenticator(page);
      await openVaultAsTestUser(page);
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
