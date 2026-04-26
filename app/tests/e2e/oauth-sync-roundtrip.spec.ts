import { test, expect } from './fixtures/vault';
import { createVaultWithRs } from './fixtures/unlock';
import { adminGet, userDbHexFor, closeAdmin } from './fixtures/admin';
import { enableTestBridge, waitForBridge } from './fixtures/cross-device';

// Drives the full Google OAuth path via the shared openVaultAsTestUser
// fixture. Previously ~60 lines of inline setup; now each test gets a
// signed-in user from one line of destructuring.

test.afterAll(async () => {
  await closeAdmin();
});

test('Google OAuth round-trip lands back on the PWA with tokens', async ({ vaultUser }) => {
  expect(vaultUser.couchdbUsername).toMatch(/^g_/);
  expect(vaultUser.jwt).toMatch(/^ey/);
  expect(vaultUser.email).toMatch(/^g-e2e-\d+-[a-z0-9]+@tricho\.test$/);
  expect(vaultUser.refreshToken).toBeTruthy();
});

test('JWT is accepted by tricho-auth on an authenticated endpoint', async ({ page, vaultUser }) => {
  await page.goto('/');
  const res = await page.evaluate(async (jwt) => {
    const r = await fetch('/auth/devices', {
      headers: { authorization: `Bearer ${jwt}` },
    });
    return { status: r.status, body: await r.json() };
  }, vaultUser.jwt);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.devices)).toBe(true);
  expect(res.body.devices.length).toBeGreaterThanOrEqual(1);
});

test('authenticated write appears as ciphertext on CouchDB', async ({ browser }) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await enableTestBridge(context);
  const page = await context.newPage();
  try {
    const { user } = await createVaultWithRs(page);
    const vaultId = await waitForBridge(page);

    // Write a customer through the same path the production UI uses.
    const writeResult = await page.evaluate(async () => {
      const w = window as unknown as {
        __trichoE2E: {
          putCustomer: (data: Record<string, unknown>) => Promise<{ id: string; rev: string }>;
        };
      };
      return w.__trichoE2E.putCustomer({
        firstName: 'Eliška',
        lastName: 'Tampered-Plaintext',
        phone: '+420 600 000 042',
      });
    });

    // Wait for sync to push the doc to CouchDB.
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
            reject(new Error(`push of ${id} did not settle in ${timeoutMs}ms`));
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
      { id: writeResult.id, timeoutMs: 20_000 },
    );

    const dbHex = userDbHexFor(user.couchdbUsername);
    const row = await adminGet<Record<string, unknown>>(`userdb-${dbHex}/${writeResult.id}`);

    // Server-visible top-level keys: only the wire shape, nothing else.
    const allowedKeys = new Set(['_id', '_rev', 'type', 'updatedAt', 'deleted', 'payload']);
    for (const k of Object.keys(row)) {
      expect(allowedKeys.has(k), `unexpected top-level key on server row: ${k}`).toBe(true);
    }

    const payload = row.payload as { v: number; alg: string; kid: string; iv: string; ct: string };
    expect(payload.v).toBe(1);
    expect(payload.alg).toBe('AES-256-GCM');
    expect(payload.kid).toBe(vaultId);
    expect(payload.iv).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(payload.ct).toMatch(/^[A-Za-z0-9_-]+$/);

    const stringified = JSON.stringify(row);
    expect(stringified).not.toContain('Eliška');
    expect(stringified).not.toContain('Tampered-Plaintext');
    expect(stringified).not.toContain('600 000 042');
  } finally {
    await context.close();
  }
});
