import { test, expect } from '@playwright/test';

// Smoke tests against the deployed dev environment. Run with:
//   E2E_BASE_URL=https://dev.tricho.app \
//   E2E_SYNC_BASE_URL=https://sync.dev.tricho.app \
//     npx playwright test tests/e2e/dev-smoke.spec.ts
//
// Most of the regular e2e suite needs `mock-oidc` and admin access via
// `docker exec tricho_couchdb`, neither of which is available against
// dev. This spec sticks to what's externally observable: did the
// frontend Cloudflare Pages deploy ship the right bundle, and is the
// backend stack healthy?

const FRONTEND_BASE = process.env.E2E_BASE_URL ?? 'https://dev.tricho.app';
const SYNC_BASE = process.env.E2E_SYNC_BASE_URL ?? 'https://sync.dev.tricho.app';

test.describe('dev environment smoke', () => {
  test('marketing site / loads and has the brand title', async ({ page }) => {
    await page.goto(FRONTEND_BASE, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/Tricho\.app/, { timeout: 10_000 });
  });

  test('PWA shell /app/ loads and renders the layout', async ({ page }) => {
    await page.goto(`${FRONTEND_BASE}/app/`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/TrichoApp/, { timeout: 10_000 });
    await expect(page.locator('.paper-grain')).toBeAttached();
  });

  test('frontend manifest has Czech metadata', async ({ page }) => {
    await page.goto(FRONTEND_BASE);
    const manifest = await page.evaluate(async (origin) => {
      const r = await fetch(`${origin}/manifest.webmanifest`);
      return r.json() as Promise<Record<string, string>>;
    }, FRONTEND_BASE);
    expect(manifest.lang).toBe('cs');
    expect(manifest.name).toBe('Tricho');
  });

  test('frontend service worker serves and references precacheAndRoute', async ({ page }) => {
    await page.goto(`${FRONTEND_BASE}/app/`);
    const body = await page.evaluate(async (origin) => {
      const r = await fetch(`${origin}/app/sw.js`);
      return r.text();
    }, FRONTEND_BASE);
    expect(body).toContain('precacheAndRoute');
  });

  test('backend /auth/health responds 200', async ({ page }) => {
    await page.goto(FRONTEND_BASE);
    const status = await page.evaluate(async (sync) => {
      const r = await fetch(`${sync}/auth/health`);
      return { status: r.status, body: await r.text() };
    }, SYNC_BASE);
    expect(status.status).toBe(200);
  });

  test('backend /auth/google/start redirects to Google OAuth', async ({ page }) => {
    await page.goto(FRONTEND_BASE);
    const redirect = await page.evaluate(async (sync) => {
      const r = await fetch(`${sync}/auth/google/start`, { redirect: 'manual' });
      return { status: r.status, location: r.headers.get('location') ?? '' };
    }, SYNC_BASE);
    // Browsers turn the 302 into 0 for opaqueredirect; both are acceptable.
    expect([0, 302]).toContain(redirect.status);
  });

  test('backend /userdb-<hex>/ proxy rejects anonymous reads with 401', async ({ page }) => {
    await page.goto(FRONTEND_BASE);
    const status = await page.evaluate(async (sync) => {
      const r = await fetch(`${sync}/userdb-deadbeef/`);
      return r.status;
    }, SYNC_BASE);
    // tricho-auth's couch proxy returns 401 on missing/invalid Bearer.
    // Critically NOT 404 (CouchDB direct) — proves the proxy is on the path.
    expect(status).toBe(401);
  });

  test('backend /userdb-<hex>/ proxy rejects malformed Bearer with 401', async ({ page }) => {
    await page.goto(FRONTEND_BASE);
    const status = await page.evaluate(async (sync) => {
      const r = await fetch(`${sync}/userdb-deadbeef/`, {
        headers: { authorization: 'Bearer not-a-real-jwt' },
      });
      return r.status;
    }, SYNC_BASE);
    expect(status).toBe(401);
  });
});
