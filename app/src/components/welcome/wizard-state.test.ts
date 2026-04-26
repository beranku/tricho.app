import { describe, expect, it } from 'vitest';
import { initialState, wizardReducer, type WizardState } from './wizard-state';

const browser = (overrides: Partial<WizardState> = {}): WizardState => ({
  ...initialState('browser'),
  ...overrides,
});

const pwa = (overrides: Partial<WizardState> = {}): WizardState => ({
  ...initialState('pwa'),
  ...overrides,
});

describe('initialState', () => {
  it('browser mode starts at Step 1, locked, not installed', () => {
    const s = initialState('browser');
    expect(s.currentStep).toBe(1);
    expect(s.step1.installed).toBe(false);
    expect(s.step2.authenticated).toBe(false);
    expect(s.step3.completed).toBe(false);
  });

  it('pwa mode starts at Step 2 with Step 1 already done', () => {
    const s = initialState('pwa');
    expect(s.currentStep).toBe(2);
    expect(s.step1.installed).toBe(true);
  });
});

describe('CONFIRM_INSTALLATION', () => {
  it('flips installed to true in browser mode but does NOT advance', () => {
    const next = wizardReducer(browser(), { type: 'CONFIRM_INSTALLATION' });
    expect(next.step1.installed).toBe(true);
    expect(next.currentStep).toBe(1);
    expect(next.step2.authenticated).toBe(false);
  });

  it('is a no-op in pwa mode (Step 1 already done)', () => {
    const before = pwa();
    const next = wizardReducer(before, { type: 'CONFIRM_INSTALLATION' });
    expect(next).toEqual(before);
  });
});

describe('CANCEL_INSTALLATION', () => {
  it('returns to Step 1 install instructions', () => {
    const before = browser({ step1: { installed: true } });
    const next = wizardReducer(before, { type: 'CANCEL_INSTALLATION' });
    expect(next.step1.installed).toBe(false);
    expect(next.currentStep).toBe(1);
  });
});

describe('AUTHENTICATE', () => {
  it('marks Step 2 done and advances to Step 3 in pwa mode', () => {
    const next = wizardReducer(pwa(), { type: 'AUTHENTICATE', provider: 'apple' });
    expect(next.step2.authenticated).toBe(true);
    expect(next.step2.provider).toBe('apple');
    expect(next.currentStep).toBe(3);
  });

  it('NEVER advances past Step 1 in browser mode (the floor)', () => {
    const before = browser({ step1: { installed: true } });
    const next = wizardReducer(before, { type: 'AUTHENTICATE', provider: 'google' });
    expect(next.currentStep).toBe(1);
    expect(next.step2.authenticated).toBe(false);
  });

  it('is idempotent on the same provider', () => {
    const after = wizardReducer(pwa(), { type: 'AUTHENTICATE', provider: 'google' });
    const after2 = wizardReducer(after, { type: 'AUTHENTICATE', provider: 'google' });
    expect(after).toEqual(after2);
  });
});

describe('SET_FLOW', () => {
  it('switches to existing flow when on Step 3', () => {
    const after = wizardReducer(pwa(), { type: 'AUTHENTICATE', provider: 'apple' });
    const next = wizardReducer(after, { type: 'SET_FLOW', flow: 'existing' });
    expect(next.step3.flow).toBe('existing');
    expect(next.step3.substep).toBe('qr');
  });

  it('is ignored when not on Step 3', () => {
    const before = pwa();
    const next = wizardReducer(before, { type: 'SET_FLOW', flow: 'existing' });
    expect(next.step3.flow).toBe('new');
  });

  it('resets substep on flow change', () => {
    const onStep3 = wizardReducer(pwa(), { type: 'AUTHENTICATE', provider: 'apple' });
    const advanced = wizardReducer(onStep3, { type: 'ADVANCE_SUBSTEP', substep: 'verify' });
    const switched = wizardReducer(advanced, { type: 'SET_FLOW', flow: 'existing' });
    expect(switched.step3.substep).toBe('qr');
  });
});

describe('ADVANCE_SUBSTEP — new flow', () => {
  const start = (): WizardState =>
    wizardReducer(pwa(), { type: 'AUTHENTICATE', provider: 'apple' });

  it('qr → verify', () => {
    const next = wizardReducer(start(), { type: 'ADVANCE_SUBSTEP', substep: 'verify' });
    expect(next.step3.substep).toBe('verify');
  });

  it('verify → webauthn', () => {
    let s = start();
    s = wizardReducer(s, { type: 'ADVANCE_SUBSTEP', substep: 'verify' });
    s = wizardReducer(s, { type: 'ADVANCE_SUBSTEP', substep: 'webauthn' });
    expect(s.step3.substep).toBe('webauthn');
  });

  it('rejects invalid jump qr → webauthn', () => {
    const next = wizardReducer(start(), { type: 'ADVANCE_SUBSTEP', substep: 'webauthn' });
    expect(next.step3.substep).toBe('qr');
  });

  it('rejects backward advance webauthn → verify (use BACK_SUBSTEP)', () => {
    let s = start();
    s = wizardReducer(s, { type: 'ADVANCE_SUBSTEP', substep: 'verify' });
    s = wizardReducer(s, { type: 'ADVANCE_SUBSTEP', substep: 'webauthn' });
    const next = wizardReducer(s, { type: 'ADVANCE_SUBSTEP', substep: 'verify' });
    expect(next.step3.substep).toBe('webauthn');
  });
});

describe('ADVANCE_SUBSTEP — existing flow', () => {
  const onStep3Existing = (): WizardState => {
    let s = wizardReducer(pwa(), { type: 'AUTHENTICATE', provider: 'apple' });
    s = wizardReducer(s, { type: 'SET_FLOW', flow: 'existing' });
    return s;
  };

  it('qr → webauthn directly (no verify substep)', () => {
    const next = wizardReducer(onStep3Existing(), {
      type: 'ADVANCE_SUBSTEP',
      substep: 'webauthn',
    });
    expect(next.step3.substep).toBe('webauthn');
  });

  it('rejects qr → verify (existing flow has no verify)', () => {
    const next = wizardReducer(onStep3Existing(), {
      type: 'ADVANCE_SUBSTEP',
      substep: 'verify',
    });
    expect(next.step3.substep).toBe('qr');
  });
});

describe('BACK_SUBSTEP', () => {
  const reachWebauthnNew = (): WizardState => {
    let s = wizardReducer(pwa(), { type: 'AUTHENTICATE', provider: 'apple' });
    s = wizardReducer(s, { type: 'ADVANCE_SUBSTEP', substep: 'verify' });
    s = wizardReducer(s, { type: 'ADVANCE_SUBSTEP', substep: 'webauthn' });
    return s;
  };

  it('webauthn → verify on new flow', () => {
    const next = wizardReducer(reachWebauthnNew(), { type: 'BACK_SUBSTEP', target: 'verify' });
    expect(next.step3.substep).toBe('verify');
  });

  it('verify → qr on new flow', () => {
    let s = wizardReducer(pwa(), { type: 'AUTHENTICATE', provider: 'apple' });
    s = wizardReducer(s, { type: 'ADVANCE_SUBSTEP', substep: 'verify' });
    const next = wizardReducer(s, { type: 'BACK_SUBSTEP', target: 'qr' });
    expect(next.step3.substep).toBe('qr');
  });

  it('is a no-op on existing flow (no back link)', () => {
    let s = wizardReducer(pwa(), { type: 'AUTHENTICATE', provider: 'apple' });
    s = wizardReducer(s, { type: 'SET_FLOW', flow: 'existing' });
    s = wizardReducer(s, { type: 'ADVANCE_SUBSTEP', substep: 'webauthn' });
    const next = wizardReducer(s, { type: 'BACK_SUBSTEP', target: 'qr' });
    expect(next.step3.substep).toBe('webauthn');
  });

  it('rejects invalid back transition webauthn → qr (must go through verify)', () => {
    const next = wizardReducer(reachWebauthnNew(), { type: 'BACK_SUBSTEP', target: 'qr' });
    expect(next.step3.substep).toBe('webauthn');
  });
});

describe('COMPLETE_STEP_3', () => {
  it('advances to final state from webauthn substep', () => {
    let s = wizardReducer(pwa(), { type: 'AUTHENTICATE', provider: 'apple' });
    s = wizardReducer(s, { type: 'ADVANCE_SUBSTEP', substep: 'verify' });
    s = wizardReducer(s, { type: 'ADVANCE_SUBSTEP', substep: 'webauthn' });
    const next = wizardReducer(s, { type: 'COMPLETE_STEP_3' });
    expect(next.currentStep).toBe('final');
    expect(next.step3.completed).toBe(true);
  });

  it('rejects completion when not on webauthn substep', () => {
    const onStep3 = wizardReducer(pwa(), { type: 'AUTHENTICATE', provider: 'apple' });
    const next = wizardReducer(onStep3, { type: 'COMPLETE_STEP_3' });
    expect(next.currentStep).toBe(3);
    expect(next.step3.completed).toBe(false);
  });

  it('rejects completion in browser mode', () => {
    const before = browser({
      step3: { flow: 'new', substep: 'webauthn', completed: false },
      currentStep: 3,
    });
    // Forced contrived state (programmer error simulation) — reducer
    // must still refuse to complete.
    const next = wizardReducer(before, { type: 'COMPLETE_STEP_3' });
    expect(next.currentStep).toBe(3);
  });
});

describe('RESET', () => {
  it('returns to the launch-mode-appropriate initial state', () => {
    const after = wizardReducer(pwa(), { type: 'AUTHENTICATE', provider: 'apple' });
    const reset = wizardReducer(after, { type: 'RESET' });
    expect(reset).toEqual(initialState('pwa'));
  });
});

describe('Step 3 — restore-zip flow', () => {
  it('does not auto-select; requires explicit SET_FLOW from existing', () => {
    let s = pwa();
    s = wizardReducer(s, { type: 'AUTHENTICATE', provider: 'apple' });
    expect(s.step3.flow).toBe('new');
    s = wizardReducer(s, { type: 'SET_FLOW', flow: 'existing' });
    expect(s.step3.flow).toBe('existing');
    s = wizardReducer(s, { type: 'SET_FLOW', flow: 'restore-zip' });
    expect(s.step3.flow).toBe('restore-zip');
    expect(s.step3.substep).toBe('pick-zip');
  });

  it('does not allow new → restore-zip directly', () => {
    let s = pwa();
    s = wizardReducer(s, { type: 'AUTHENTICATE', provider: 'apple' });
    s = wizardReducer(s, { type: 'SET_FLOW', flow: 'restore-zip' });
    expect(s.step3.flow).toBe('new');
  });

  it('advances pick-zip → verify-rs → webauthn', () => {
    let s = pwa();
    s = wizardReducer(s, { type: 'AUTHENTICATE', provider: 'apple' });
    s = wizardReducer(s, { type: 'SET_FLOW', flow: 'existing' });
    s = wizardReducer(s, { type: 'SET_FLOW', flow: 'restore-zip' });
    s = wizardReducer(s, { type: 'ADVANCE_SUBSTEP', substep: 'verify-rs' });
    expect(s.step3.substep).toBe('verify-rs');
    s = wizardReducer(s, { type: 'ADVANCE_SUBSTEP', substep: 'webauthn' });
    expect(s.step3.substep).toBe('webauthn');
  });

  it('rejects pick-zip → webauthn (must go through verify-rs)', () => {
    let s = pwa();
    s = wizardReducer(s, { type: 'AUTHENTICATE', provider: 'apple' });
    s = wizardReducer(s, { type: 'SET_FLOW', flow: 'existing' });
    s = wizardReducer(s, { type: 'SET_FLOW', flow: 'restore-zip' });
    const next = wizardReducer(s, { type: 'ADVANCE_SUBSTEP', substep: 'webauthn' });
    expect(next.step3.substep).toBe('pick-zip');
  });
});

describe('ADVANCE_TO_PIN_SETUP — non-PRF terminal substep', () => {
  it('advances from webauthn to pin-setup', () => {
    let s = pwa();
    s = wizardReducer(s, { type: 'AUTHENTICATE', provider: 'apple' });
    s = wizardReducer(s, { type: 'ADVANCE_SUBSTEP', substep: 'verify' });
    s = wizardReducer(s, { type: 'ADVANCE_SUBSTEP', substep: 'webauthn' });
    s = wizardReducer(s, { type: 'ADVANCE_TO_PIN_SETUP' });
    expect(s.step3.substep).toBe('pin-setup');
    expect(s.currentStep).toBe(3);
    expect(s.step3.completed).toBe(false);
  });

  it('rejects ADVANCE_TO_PIN_SETUP from non-webauthn substeps', () => {
    let s = pwa();
    s = wizardReducer(s, { type: 'AUTHENTICATE', provider: 'apple' });
    // qr substep
    const next = wizardReducer(s, { type: 'ADVANCE_TO_PIN_SETUP' });
    expect(next.step3.substep).toBe('qr');
  });

  it('COMPLETE_STEP_3 fires from pin-setup terminal substep', () => {
    let s = pwa();
    s = wizardReducer(s, { type: 'AUTHENTICATE', provider: 'apple' });
    s = wizardReducer(s, { type: 'ADVANCE_SUBSTEP', substep: 'verify' });
    s = wizardReducer(s, { type: 'ADVANCE_SUBSTEP', substep: 'webauthn' });
    s = wizardReducer(s, { type: 'ADVANCE_TO_PIN_SETUP' });
    s = wizardReducer(s, { type: 'COMPLETE_STEP_3' });
    expect(s.currentStep).toBe('final');
    expect(s.step3.completed).toBe(true);
  });
});

describe('Browser-mode floor (the PWA-storage-origin invariant)', () => {
  it('no action chain advances currentStep past 1 in browser mode', () => {
    let s = browser();
    const actions = [
      { type: 'CONFIRM_INSTALLATION' as const },
      { type: 'AUTHENTICATE' as const, provider: 'google' as const },
      { type: 'SET_FLOW' as const, flow: 'existing' as const },
      { type: 'ADVANCE_SUBSTEP' as const, substep: 'verify' as const },
      { type: 'ADVANCE_SUBSTEP' as const, substep: 'webauthn' as const },
      { type: 'COMPLETE_STEP_3' as const },
    ];
    for (const a of actions) {
      s = wizardReducer(s, a);
      expect(s.currentStep).toBe(1);
      expect(s.step2.authenticated).toBe(false);
      expect(s.step3.completed).toBe(false);
    }
  });
});
