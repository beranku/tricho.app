// Deterministic JWT signer for tests. Generates a fresh keypair per call
// (don't reuse across tests — clean state matters for failure-mode
// assertions like "wrong key rejects").

import { JwtSigner, generateKeypair } from '../../jwt.mjs';

export function testSigner({ kid = 'test-kid' } = {}) {
  const { privatePem, publicPem } = generateKeypair();
  return new JwtSigner({ privatePem, publicPem, kid });
}
