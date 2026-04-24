import { test } from '@playwright/test';

// TODO (tracked follow-up): goOffline → write customer → goOnline →
// assert replication pushes the encrypted doc to CouchDB and
// /userdb-<hex>/<id> returns the envelope-crypto shape.
// Depends on the same vault-unlock prerequisite as vault-unlock-pin.

test.skip('offline customer write → syncs up as ciphertext on reconnect', async () => {});
