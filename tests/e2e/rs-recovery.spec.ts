import { test } from '@playwright/test';

// TODO (tracked follow-up): Export RS during vault creation → clear
// IndexedDB (simulate new device) → paste RS → vault rewrap + unlock.
// Same prerequisite as vault-unlock-pin.spec.ts: a test-only
// "create-without-passkey" path so we can run the flow headlessly.

test.skip('RS export → restore on a fresh device succeeds', async () => {});
test.skip('wrong RS is rejected at the confirmation step', async () => {});
