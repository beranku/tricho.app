import { describe, it, expect } from 'vitest';
import { LoginScreen } from './LoginScreen';

// LoginScreen orchestrates: existing-vault detection, RS generation +
// confirmation, passkey registration, unlock with passkey or RS. Full
// scenario coverage requires: mocks for keystore, webauthn, recovery,
// and local-pin; plus navigation through 9 internal states. Shipped as
// scaffold now; scenarios to be completed as a focused follow-up.

describe('LoginScreen', () => {
  it('module exports the component', () => {
    expect(typeof LoginScreen).toBe('function');
  });

  it.todo('state: checking → renders loading indicator');
  it.todo('state: create_rs → displays RS + export session created');
  it.todo('state: confirm_rs → wrong checksum rejected');
  it.todo('state: register_passkey → calls registerPasskey via webauthn');
  it.todo('state: unlock → PRF fast path unlocks');
  it.todo('state: unlock → PRF fallback to recovery input shown');
  it.todo('state: recovery → decodeRsFromInput + vault rewrap');
  it.todo('state: error → error text displayed');
});
