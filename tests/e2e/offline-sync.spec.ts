import { test, expect } from '@playwright/test';
import { createVaultWithRs } from './fixtures/unlock';
import { adminGet, userDbHexFor, closeAdmin } from './fixtures/admin';
import { enableTestBridge, waitForBridge } from './fixtures/cross-device';

test.afterAll(async () => {
  await closeAdmin();
});

test('offline customer write → syncs up as ciphertext on reconnect', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    const { user } = await createVaultWithRs(page);
    await waitForBridge(page);

    await context.setOffline(true);

    const writeResult = await page.evaluate(async () => {
      const w = window as unknown as {
        __trichoE2E: {
          putCustomer: (data: Record<string, unknown>) => Promise<{ id: string; rev: string }>;
        };
      };
      return w.__trichoE2E.putCustomer({
        firstName: 'Offline',
        lastName: 'Klient',
        phone: '+420 600 999 999',
      });
    });

    // Confirm IndexedDB persisted the doc locally even with no network.
    const localRead = await page.evaluate(async (id) => {
      const w = window as unknown as {
        __trichoE2E: { getCustomer: (id: string) => Promise<Record<string, unknown> | null> };
      };
      return w.__trichoE2E.getCustomer(id);
    }, writeResult.id);
    expect(localRead).toMatchObject({ firstName: 'Offline', lastName: 'Klient' });

    await context.setOffline(false);

    // Wait for the push to land on CouchDB after reconnect.
    await page.evaluate(
      ({ id, timeoutMs }) =>
        new Promise<void>((resolve, reject) => {
          const w = window as unknown as {
            __trichoE2E: {
              subscribeSyncEvents: (cb: (s: { status: string; pushed: number }) => void) => () => void;
            };
          };
          let pushed = false;
          const timer = setTimeout(() => {
            unsub();
            reject(new Error(`offline → online push of ${id} did not settle in ${timeoutMs}ms`));
          }, timeoutMs);
          const unsub = w.__trichoE2E.subscribeSyncEvents((s) => {
            if (s.status === 'syncing' && s.pushed > 0) pushed = true;
            if (pushed && s.status === 'paused') {
              clearTimeout(timer);
              unsub();
              resolve();
            }
          });
        }),
      { id: writeResult.id, timeoutMs: 30_000 },
    );

    const dbHex = userDbHexFor(user.couchdbUsername);
    const row = await adminGet<Record<string, unknown>>(`userdb-${dbHex}/${writeResult.id}`);

    const allowedKeys = new Set(['_id', '_rev', 'type', 'updatedAt', 'deleted', 'payload']);
    for (const k of Object.keys(row)) {
      expect(allowedKeys.has(k), `unexpected top-level key on server row: ${k}`).toBe(true);
    }
    const payload = row.payload as { v: number; alg: string; kid: string; iv: string; ct: string };
    expect(payload.v).toBe(1);
    expect(payload.alg).toBe('AES-256-GCM');
    expect(payload.iv).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(payload.ct).toMatch(/^[A-Za-z0-9_-]+$/);

    const stringified = JSON.stringify(row);
    expect(stringified).not.toContain('Offline');
    expect(stringified).not.toContain('Klient');
    expect(stringified).not.toContain('600 999 999');
  } finally {
    await context.close();
  }
});
