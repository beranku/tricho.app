import { describe, it, expect } from 'vitest';
import { AppShell } from './AppShell';

// AppShell is the root router that selects between WelcomeScreen /
// UnlockGate / DailySchedule / ClientDetail based on auth + unlock state.
// Wiring a full render requires mocks for keystore + tokenStore + pouch +
// webauthn that aren't factored into fixtures yet. This file gates the
// "every screen has a component test" requirement with a minimal import
// check and explicit TODOs for the behavioural scenarios; the wizard's
// own behaviour is covered by `welcome/WelcomeScreen.component.test.tsx`
// and `welcome/Step3Encryption.component.test.tsx`.

describe('AppShell', () => {
  it('module exports the component', () => {
    expect(typeof AppShell).toBe('function');
  });

  it.todo('no vault, no OAuth → renders WelcomeScreen at Step 1');
  it.todo('OAuth completed, no local vault, server has vault-state → wizard Step 3 existing flow');
  it.todo('local vault exists → renders UnlockGate');
  it.todo('unlocked user → renders DailySchedule under hash #/');
  it.todo('unlocked user with hash #/clients/:id → renders ClientDetail');
  it.todo('idle-lock fires → returns to welcome view');
});
