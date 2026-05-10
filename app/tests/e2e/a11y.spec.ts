import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

// Accessibility smoke: inject the axe-core runtime into the page and
// assert no serious/critical violations on each top-level screen. We
// load axe from `node_modules` (path-injected by Playwright) instead of
// a CDN URL — the PWA's `script-src 'self' 'unsafe-inline'` CSP blocks
// remote loads.

const AXE_LOCAL = resolve(process.cwd(), 'node_modules/axe-core/axe.min.js');

async function runAxe(page: import('@playwright/test').Page): Promise<{ id: string; impact: string; nodes: number }[]> {
  await page.addScriptTag({ path: AXE_LOCAL });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axe = (window as any).axe;
    const results = await axe.run(document, { resultTypes: ['violations'] });
    return results.violations.map((v: { id: string; impact: string; nodes: unknown[] }) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
    }));
  });
}

test('/ has no serious or critical a11y violations', async ({ page }) => {
  await page.goto('/');
  const violations = await runAxe(page);
  const severe = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(severe, JSON.stringify(severe, null, 2)).toEqual([]);
});

test('welcome wizard light mode: no severe a11y violations', async ({ page }) => {
  await page.addInitScript(() => {
    document.documentElement.removeAttribute('data-theme');
  });
  await page.goto('/');
  // The wizard mounts on a regular browser tab as Step 1 active.
  await page.locator('.step-card[data-step="1"][data-state="active"]').waitFor({ timeout: 10_000 });
  const violations = await runAxe(page);
  const severe = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(severe, JSON.stringify(severe, null, 2)).toEqual([]);
});

test('welcome wizard dark mode: no severe a11y violations', async ({ page }) => {
  await page.addInitScript(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await page.goto('/');
  await page.locator('.step-card[data-step="1"][data-state="active"]').waitFor({ timeout: 10_000 });
  const violations = await runAxe(page);
  const severe = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(severe, JSON.stringify(severe, null, 2)).toEqual([]);
});
