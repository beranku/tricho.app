import { test, expect, type Page } from '@playwright/test';

// All HTTP requests run through `page.evaluate(fetch)` so they go through
// Chromium's resolver — this honours the --host-resolver-rules mapping in
// playwright.config.ts. Playwright's APIRequestContext uses Node's DNS and
// would ignore the override.

async function fetchFromPage(page: Page, path: string) {
  return page.evaluate(async (p: string) => {
    const res = await fetch(p);
    return {
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      body: await res.text(),
    };
  }, path);
}

test('PWA shell renders at the Traefik edge', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/tricho|PWA Kamera/i);
});

test('auth health endpoint reachable through Traefik', async ({ page }) => {
  await page.goto('/');
  const res = await fetchFromPage(page, '/auth/health');
  expect(res.status).toBe(200);
  expect(JSON.parse(res.body)).toEqual({ ok: true });
});

test('admin paths not routed externally', async ({ page }) => {
  await page.goto('/');
  for (const path of ['/_all_dbs', '/_config', '/_session']) {
    const res = await fetchFromPage(page, path);
    expect(
      res.contentType.startsWith('application/json'),
      `${path} returned JSON (${res.contentType}) — admin path reached CouchDB`,
    ).toBe(false);
  }
});
