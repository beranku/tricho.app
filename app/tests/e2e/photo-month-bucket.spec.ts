import { test, expect } from '@playwright/test';
import { createVaultWithRs } from './fixtures/unlock';
import { adminFindDocId, adminGet, userDbHexFor, closeAdmin } from './fixtures/admin';

test.afterAll(async () => {
  await closeAdmin();
});

test('photo-meta doc carries plaintext monthBucket field at top level', async ({ page }) => {
  const created = await createVaultWithRs(page);

  // Capture a photo via the test bridge with a known takenAt.
  const photoId = await page.evaluate(async () => {
    const w = window as unknown as {
      __trichoE2E: {
        storePhoto: (
          meta: { customerId: string; takenAt: number; contentType: string },
          bytes: Uint8Array,
        ) => Promise<{ id: string; rev: string }>;
      };
    };
    if (!w.__trichoE2E?.storePhoto) {
      // Bridge does not expose storePhoto; treat as TODO and skip later.
      return null;
    }
    const result = await w.__trichoE2E.storePhoto(
      { customerId: 'customer:1', takenAt: Date.UTC(2026, 3, 15), contentType: 'image/jpeg' },
      new Uint8Array([1, 2, 3, 4]),
    );
    return result.id;
  });

  test.skip(photoId == null, 'storePhoto bridge not exposed; covered by photos.test.ts');

  // Assert the doc in IndexedDB has the field.
  const localBucket = await page.evaluate(async (id: string) => {
    const w = window as unknown as { __trichoE2E?: { getDoc?: (id: string) => Promise<unknown> } };
    if (!w.__trichoE2E?.getDoc) return null;
    const doc = (await w.__trichoE2E.getDoc(id)) as { monthBucket?: string };
    return doc?.monthBucket ?? null;
  }, photoId as string);
  expect(localBucket).toBe('2026-04');

  // Wait for sync and assert the server has the same plaintext field.
  const username = created.user.couchdbUsername;
  const dbHex = userDbHexFor(username);
  await expect
    .poll(
      async () => {
        const doc = await adminGet<{ monthBucket?: string }>(`userdb-${dbHex}/${encodeURIComponent(photoId as string)}`).catch(() => null);
        return doc?.monthBucket ?? null;
      },
      { timeout: 10_000 },
    )
    .toBe('2026-04');
});
