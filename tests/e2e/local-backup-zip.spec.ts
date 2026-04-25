import { test, expect } from '@playwright/test';
import { createVaultWithRs } from './fixtures/unlock';

// End-to-end: a free user can pack a monthly local ZIP from inside the
// running app. The ZIP must contain no plaintext customer data — it is the
// disk-encrypted bytes-as-is.

test('client packs a monthly ZIP with no plaintext leak', async ({ page }) => {
  await createVaultWithRs(page);

  // Insert a customer with a unique plaintext name so we can verify it does
  // NOT appear in the ZIP bytes.
  const SECRET_NAME = 'PavlinaUniqueE2E';
  const SECRET_NOTE = 'AlergieMartinaPlusE2E';
  const wrote = await page.evaluate(
    async (vals) => {
      const w = window as unknown as {
        __trichoE2E?: {
          putCustomer: (data: Record<string, unknown>) => Promise<{ id: string; rev: string }>;
        };
      };
      if (!w.__trichoE2E?.putCustomer) return null;
      return w.__trichoE2E.putCustomer({ firstName: vals.name, lastName: 'X', notes: vals.note });
    },
    { name: SECRET_NAME, note: SECRET_NOTE },
  );
  test.skip(wrote == null, 'putCustomer bridge not exposed in this build');

  // Pack a ZIP for the current calendar month from inside the page; return the
  // bytes as a base64 string so Playwright can inspect them.
  const ziptest = await page.evaluate(async () => {
    const w = window as unknown as {
      __trichoE2E?: {
        vaultId: string;
      };
    };
    // @ts-expect-error — vite-served absolute paths only resolve at runtime in the browser
    const mod = await import('/src/backup/local-zip.ts').catch(() => null);
    // @ts-expect-error — same reason
    const dbMod = await import('/src/db/pouch.ts').catch(() => null);
    // @ts-expect-error — same reason
    const dateMod = await import('/src/lib/format/utc-month.ts').catch(() => null);
    if (!mod || !dbMod || !dateMod || !w.__trichoE2E?.vaultId) return null;
    const db = (dbMod as { getVaultDb: () => unknown }).getVaultDb();
    if (!db) return null;
    const monthKey = (dateMod as { formatUtcMonth: (n: number) => string }).formatUtcMonth(Date.now());
    const result = await (
      mod as {
        generateLocalBackupZip: (opts: {
          db: unknown;
          vaultId: string;
          monthKey: string;
        }) => Promise<{ bytes: Uint8Array; manifest: { docCount: number; photoCount: number } }>;
      }
    ).generateLocalBackupZip({ db, vaultId: w.__trichoE2E.vaultId, monthKey });
    let binary = '';
    const bytes = result.bytes;
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    return { b64: btoa(binary), manifest: result.manifest };
  });

  test.skip(ziptest == null, 'local-zip generator not loadable from page (likely production bundle)');

  if (ziptest) {
    const buf = Buffer.from(ziptest.b64, 'base64');
    const text = buf.toString('utf8');
    // assertNoPlaintextLeak — neither customer name nor notes appear in ZIP.
    expect(text).not.toContain(SECRET_NAME);
    expect(text).not.toContain(SECRET_NOTE);
    expect(ziptest.manifest.docCount).toBeGreaterThan(0);
  }
});
