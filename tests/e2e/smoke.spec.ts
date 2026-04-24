import { test, expect } from '@playwright/test';

test('PWA shell renders at the Traefik edge', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/tricho|PWA Kamera/i);
});

test('auth health endpoint reachable through Traefik', async ({ request }) => {
  const res = await request.get('/auth/health');
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body).toEqual({ ok: true });
});

test('admin paths not routed externally', async ({ request }) => {
  // The three-public-path invariant — /_all_dbs must NOT reach CouchDB.
  for (const path of ['/_all_dbs', '/_config', '/_session']) {
    const res = await request.get(path, { failOnStatusCode: false });
    // Either 404 (no route) or routed to the PWA SPA catch-all (200 HTML).
    // What we must NOT see: a JSON CouchDB response.
    expect(res.status()).not.toBe(200);
  }
});
