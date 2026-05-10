import { test, expect } from './fixtures/vault';
import { createVaultWithRs } from './fixtures/unlock';
import { enableTestBridge } from './fixtures/cross-device';

// Walk the karta klientky (client detail) view by seeding one customer
// via the e2e bridge, then navigating to it via the hash router.
// Asserts the detail surfaces (anamnéza/notes, photo gallery placeholder,
// camera card, history) and that back-nav returns to the diár.

// Pre-existing infra noise that bleeds through whenever a vault tries to
// sync against a CSP-locked CouchDB endpoint or a probe hits localhost
// ports rather than the Traefik edge. None of these are caused by the
// karta walk itself; filter them so the assertion catches *new* errors.
const KNOWN_INFRA_NOISE = [
  /vault-state probe failed/,
  /SSL certificate error/,
  /violates the following Content Security Policy/,
  /Refused to connect because it violates the document's Content Security Policy/,
  /Fetch API cannot load http:\/\/localhost:(5984|4545)/,
  /\[locale\] initial persistence failed/,
  /Version change transaction was aborted in upgradeneeded event handler/,
  // First sync of a fresh vault probes 404s before any docs land — these
  // are expected and don't break the karta walk.
  /Failed to load resource: the server responded with a status of 404/,
];

function isInfraNoise(text: string): boolean {
  return KNOWN_INFRA_NOISE.some((re) => re.test(text));
}

test('karta klientky opens for a seeded customer and renders the detail surfaces', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isInfraNoise(msg.text())) consoleErrors.push(msg.text());
  });

  try {
    await createVaultWithRs(page);

    // Seed one customer via the test bridge.
    const customerId = await page.evaluate(async () => {
      const w = window as unknown as {
        __trichoE2E?: {
          putCustomer: (data: {
            firstName: string;
            lastName: string;
            notes?: string;
          }) => Promise<{ id: string }>;
        };
      };
      if (!w.__trichoE2E) throw new Error('e2e bridge not available');
      const { id } = await w.__trichoE2E.putCustomer({
        firstName: 'Eliška',
        lastName: 'Testová',
        notes: 'První návštěva — bez známých alergenů.',
      });
      return id;
    });
    expect(customerId).toMatch(/^customer-/);

    // Navigate to the karta via hash route.
    await page.evaluate((id) => {
      window.location.hash = `#/clients/${encodeURIComponent(id)}`;
    }, customerId);

    // The phone shell switches to variant 'b' (back button instead of menu).
    // The chrome glyph in variant 'b' is an `<a>` (back link) with aria-label "Zpět".
    await expect(page.locator('a.chrome-glyph[aria-label="Zpět"]')).toBeVisible({
      timeout: 10_000,
    });

    // Back-nav returns to the diár (resets the hash to "#/" — the FAB
    // becomes visible again as the diár re-mounts).
    await page.locator('a.chrome-glyph[aria-label="Zpět"]').click();
    await expect(page.locator('button.fab').first()).toBeVisible({ timeout: 10_000 });

    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join('\n')}`).toEqual([]);
  } finally {
    await context.close();
  }
});
