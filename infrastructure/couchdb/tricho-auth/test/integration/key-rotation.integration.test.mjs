import { describe, it } from 'vitest';

// TODO (tracked follow-up): boot the custom couchdb image, mint a JWT,
// rotate tricho-auth's signer keypair, restart CouchDB (entrypoint shim
// picks up the new public key), assert:
//   - JWT from the previous key is rejected
//   - JWT from the new key is accepted
// Use testcontainers' container.restart() API (containers stay on the
// same host:port mapping across restart).

describe('JWT key rotation', () => {
  it.todo('old JWT rejected after rotation');
  it.todo('new JWT accepted after rotation');
  it.todo('overlap window (both keys in jwt.ini) accepts both');
});
