import type { BrowserContext, Page } from '@playwright/test';

/**
 * Attach a CDP virtual authenticator to a Page so navigator.credentials.create()
 * resolves in headless Chromium. Without this, the production passkey
 * registration step in LoginScreen would block forever waiting on a real
 * platform authenticator that headless Chrome does not provide.
 *
 * Pinned to ctap2 + internal + automatic-presence so registration succeeds
 * deterministically. We do NOT depend on PRF behavior: the test path is
 * RS-only (see openspec change e2e-sync-encryption-tests, design D3 + D9).
 *
 * Returns the authenticator id so callers can remove it if needed.
 */
export async function attachVirtualAuthenticator(page: Page): Promise<string> {
  const session = await page.context().newCDPSession(page);
  await session.send('WebAuthn.enable');
  const { authenticatorId } = await session.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return authenticatorId;
}

/**
 * Attach a virtual authenticator to every page that opens in this context,
 * including the first one. Useful for tests that navigate before they get a
 * chance to call attachVirtualAuthenticator on the page directly.
 */
export async function attachVirtualAuthenticatorForContext(context: BrowserContext): Promise<void> {
  context.on('page', (page) => {
    void attachVirtualAuthenticator(page).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[e2e webauthn] attach failed for page', err);
    });
  });
  for (const page of context.pages()) {
    await attachVirtualAuthenticator(page);
  }
}
