import { test, expect } from '@playwright/test';
import { openTwoDevices, teardownDevices } from './fixtures/cross-device';
import { waitForSyncPaused } from './fixtures/sync-flows';

// First-run device pairing walk. Confirms two contexts reach the
// unlocked shell, share a vaultId, and observe at least one paused
// sync event each — i.e. both are caught up against CouchDB.

test('Device A + Device B pair on the same RS, share vaultId, and reach paused sync', async ({ browser }) => {
  const devices = await openTwoDevices(browser);
  try {
    expect(devices.vaultId).toBeTruthy();
    expect(devices.deviceA.recoverySecret).toBeTruthy();

    await Promise.all([
      waitForSyncPaused(devices.deviceA.page),
      waitForSyncPaused(devices.deviceB.page),
    ]);
  } finally {
    await teardownDevices(devices);
  }
});
