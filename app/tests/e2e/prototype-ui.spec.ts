/**
 * Prototype-UI golden path. Runs against the static `astro preview` bundle —
 * no backend, no auth (the AppShell's auth state machine is exercised in
 * component tests; this spec verifies that the static surface boots and
 * hash routing works).
 *
 * For the full unlock → schedule → capture flow, see
 * `oauth-sync-roundtrip.spec.ts` (requires the ci stack).
 */
import { test, expect } from '@playwright/test';

test.describe('prototype UI golden path (static)', () => {
  test('cold load lands on /, renders Czech UI shell', async ({ browser }) => {
    // The PWA picks locale from navigator.language at boot. Use a context
    // with `locale: 'cs-CZ'` (Playwright's preferred override) so Chromium
    // reports cs to JS at every layer.
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'cs-CZ' });
    const p = await ctx.newPage();
    try {
      await p.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(p).toHaveTitle(/TrichoApp/, { timeout: 10_000 });
      const html = await p.locator('html').getAttribute('lang');
      expect(html).toBe('cs');
    } finally {
      await ctx.close();
    }
  });

  test('Layout includes the global paper-grain element + manifest link', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.paper-grain')).toBeAttached();
    const manifest = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifest).toMatch(/manifest\.webmanifest/);
  });

  test('manifest is reachable and has Czech metadata', async ({ page }) => {
    // Use page.evaluate(fetch(...)) so the request goes through Chromium's
    // host-resolver override (Node's resolver doesn't see `tricho.test`).
    await page.goto('/');
    const json = await page.evaluate(async () => {
      const r = await fetch('/manifest.webmanifest');
      return r.json() as Promise<Record<string, string>>;
    });
    expect(json.lang).toBe('cs');
    expect(json.name).toBe('Tricho');
    expect(json.theme_color).toBe('#FDFAF3');
  });

  test('offline page is reachable and has the Czech fallback copy', async ({ browser }) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'cs-CZ' });
    const p = await ctx.newPage();
    try {
      // Caddy serves the prerendered offline page at `/offline/` (trailing
      // slash). Without it, `try_files` falls back to the PWA shell.
      await p.goto('/offline/');
      await expect(p.getByText('Bez připojení')).toBeVisible();
      await expect(p.getByText(/synchronizace/i)).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('design tokens resolve to expected light-mode colors before user toggle', async ({ page }) => {
    await page.goto('/');
    const inkColour = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
    );
    expect(inkColour).toBe('#1C1917');
    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    );
    expect(bg).toBe('#FDFAF3');
  });

  test('toggling data-theme="dark" via DOM swaps token values', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
    });
    const ink = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
    );
    // Dark mode --ink is #F5EDE0.
    expect(ink).toBe('#F5EDE0');
    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    );
    expect(bg).toBe('#211A15');
  });

  test('service worker registers and the precache manifest is served', async ({ page }) => {
    await page.goto('/');
    const body = await page.evaluate(async () => {
      const r = await fetch('/sw.js');
      return r.text();
    });
    // Workbox-generated sw.js references the precache manifest.
    expect(body).toContain('precacheAndRoute');
  });

  test('fonts are served from /fonts/, not from fonts.googleapis.com', async ({ page }) => {
    const fontRequests: string[] = [];
    page.on('request', (req) => {
      if (req.resourceType() === 'font') fontRequests.push(req.url());
    });
    await page.goto('/');
    // Wait for some font requests to flush (loaded via @font-face on first paint).
    await page.waitForTimeout(500);
    for (const url of fontRequests) {
      expect(url).not.toContain('fonts.googleapis.com');
      expect(url).not.toContain('fonts.gstatic.com');
    }
  });

  test('hash routing: visiting #/clients/abc does not reload the page', async ({ page }) => {
    await page.goto('/');
    const initialUrl = page.url();
    await page.evaluate(() => {
      window.location.hash = '#/clients/test-customer';
    });
    // Hash routing must not navigate away from the index document.
    expect(page.url().startsWith(initialUrl.split('#')[0])).toBe(true);
  });
});
