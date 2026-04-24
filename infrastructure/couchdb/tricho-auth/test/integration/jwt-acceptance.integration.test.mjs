import { describe, it } from 'vitest';

// TODO (tracked follow-up): spin our custom couchdb image (baked local.ini
// + entrypoint shim), inject a JWT public key via the shared volume, mint
// a token with the matching signer, and assert:
//   - GET /userdb-<hex(sub)> with that token → 200
//   - same request with a token whose sub differs → 401
//
// Needs the custom image, plus testcontainers' `withBindMount` for the
// shared /shared/jwt volume. The pattern for container lifecycle is
// established in meta.integration.test.mjs.

describe('JWT acceptance against real CouchDB', () => {
  it.todo('matching sub → 200 on /userdb-<hex>');
  it.todo('wrong sub → 401');
  it.todo('expired JWT → 401');
});
