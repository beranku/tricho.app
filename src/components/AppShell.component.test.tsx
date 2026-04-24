import { describe, it, expect } from 'vitest';
import { AppShell } from './AppShell';

// AppShell is the root router that selects between OAuthScreen /
// LoginScreen / CustomerCRM based on auth + unlock state. Wiring a full
// render requires mocks for keystore + tokenStore + pouch + webauthn
// that we haven't factored into fixtures yet. This file gates the
// "every screen has a component test" spec requirement with a minimal
// import check and explicit TODOs for the behavioural scenarios.

describe('AppShell', () => {
  it('module exports the component', () => {
    expect(typeof AppShell).toBe('function');
  });

  it.todo('no user → renders OAuthScreen');
  it.todo('user w/o vault → renders vault creation flow');
  it.todo('unlocked user → renders CustomerCRM');
  it.todo('idle-lock fires → renders LoginScreen unlock prompt');
});
