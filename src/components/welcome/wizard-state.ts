/**
 * Pure reducer that backs the welcome onboarding wizard. The reducer is
 * the only place that knows the rules:
 *
 *   - browser-mode launches NEVER advance past Step 1 (PWA-storage-origin
 *     invariant).
 *   - step transitions are one-way; only Step 3 substep transitions allow
 *     the back link, and only on the `flow="new"` branch.
 *   - flow ('new' vs 'existing') is auto-selected from the server
 *     vault-state probe by the dispatcher; the wizard reducer only
 *     accepts SET_FLOW once.
 *
 * Keeping this in a separate, dependency-free module makes both unit
 * testing and the OnboardingWizard component trivial.
 */

import type { LaunchMode } from '../../lib/launch-mode';

export type WizardCurrentStep = 1 | 2 | 3 | 'final';
export type Flow = 'new' | 'existing' | 'restore-zip';
export type Substep = 'qr' | 'verify' | 'webauthn' | 'pin-setup' | 'pick-zip' | 'verify-rs';
export type Provider = 'apple' | 'google';

export interface WizardState {
  launchMode: LaunchMode;
  step1: { installed: boolean };
  step2: { authenticated: boolean; provider?: Provider };
  step3: {
    flow: Flow;
    substep: Substep;
    completed: boolean;
  };
  currentStep: WizardCurrentStep;
}

export type WizardAction =
  | { type: 'CONFIRM_INSTALLATION' }
  | { type: 'CANCEL_INSTALLATION' }
  | { type: 'AUTHENTICATE'; provider: Provider }
  | { type: 'SET_FLOW'; flow: Flow }
  | { type: 'ADVANCE_SUBSTEP'; substep: Substep }
  | { type: 'BACK_SUBSTEP'; target: Substep }
  | { type: 'ADVANCE_TO_PIN_SETUP' }
  | { type: 'COMPLETE_STEP_3' }
  | { type: 'RESET' };

export function initialState(launchMode: LaunchMode): WizardState {
  // PWA mode means Step 1 is implicitly done — the user is already
  // running the app from the home screen.
  if (launchMode === 'pwa') {
    return {
      launchMode,
      step1: { installed: true },
      step2: { authenticated: false },
      step3: { flow: 'new', substep: 'qr', completed: false },
      currentStep: 2,
    };
  }
  return {
    launchMode,
    step1: { installed: false },
    step2: { authenticated: false },
    step3: { flow: 'new', substep: 'qr', completed: false },
    currentStep: 1,
  };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'CONFIRM_INSTALLATION': {
      // In browser mode this is the *only* permitted Step 1 action — flip
      // the body to the post-install message but DO NOT advance.
      if (state.launchMode === 'browser') {
        return { ...state, step1: { installed: true }, currentStep: 1 };
      }
      // In PWA mode this action is a no-op because Step 1 is already done.
      return state;
    }

    case 'CANCEL_INSTALLATION': {
      if (state.launchMode === 'browser') {
        return { ...state, step1: { installed: false }, currentStep: 1 };
      }
      return state;
    }

    case 'AUTHENTICATE': {
      // The browser-mode floor: never let auth advance the wizard. The
      // Step 2 component must not even mount in browser mode, so this
      // action firing here is a programmer error — return state unchanged
      // rather than silently violating the invariant.
      if (state.launchMode === 'browser') return state;
      // Already authenticated — idempotent.
      if (state.step2.authenticated && state.step2.provider === action.provider) {
        return state;
      }
      return {
        ...state,
        step2: { authenticated: true, provider: action.provider },
        currentStep: 3,
      };
    }

    case 'SET_FLOW': {
      // Flow is auto-selected when entering Step 3 (`new` vs `existing` from
      // the server probe). The user MAY also switch from `existing` to
      // `restore-zip` via a quiet linked-text affordance. Other switches
      // (e.g. trying to reset back to `new` after auto-selecting `existing`)
      // are ignored — the dispatcher trusts the server probe.
      if (state.currentStep !== 3) return state;
      if (state.step3.flow === action.flow) return state;
      const isInitialFromNewToExisting =
        state.step3.flow === 'new' && action.flow === 'existing';
      const isExistingToRestore =
        state.step3.flow === 'existing' && action.flow === 'restore-zip';
      if (!isInitialFromNewToExisting && !isExistingToRestore) return state;
      // Reset substep to the entry point of the new flow.
      const entrySubstep: Substep = action.flow === 'restore-zip' ? 'pick-zip' : 'qr';
      return {
        ...state,
        step3: {
          ...state.step3,
          flow: action.flow,
          substep: entrySubstep,
          completed: false,
        },
      };
    }

    case 'ADVANCE_SUBSTEP': {
      if (state.launchMode === 'browser') return state;
      if (state.currentStep !== 3) return state;
      if (!isValidForwardTransition(state.step3.flow, state.step3.substep, action.substep)) {
        return state;
      }
      return {
        ...state,
        step3: { ...state.step3, substep: action.substep },
      };
    }

    case 'BACK_SUBSTEP': {
      // Back is only allowed on the new-flow branch and only along the
      // documented back path: webauthn → verify, verify → qr.
      if (state.launchMode === 'browser') return state;
      if (state.currentStep !== 3) return state;
      if (state.step3.flow !== 'new') return state;
      if (!isValidBackTransition(state.step3.substep, action.target)) return state;
      return {
        ...state,
        step3: { ...state.step3, substep: action.target },
      };
    }

    case 'ADVANCE_TO_PIN_SETUP': {
      // Reachable only from webauthn substep, after registerPasskey reports
      // `prfSupported: false`. Adds a terminal PIN-setup substep before the
      // wizard moves on to the final card.
      if (state.launchMode === 'browser') return state;
      if (state.currentStep !== 3) return state;
      if (state.step3.substep !== 'webauthn') return state;
      return {
        ...state,
        step3: { ...state.step3, substep: 'pin-setup' },
      };
    }

    case 'COMPLETE_STEP_3': {
      if (state.launchMode === 'browser') return state;
      if (state.currentStep !== 3) return state;
      // Allowed terminal substeps: `webauthn` (PRF-capable authenticator) or
      // `pin-setup` (non-PRF authenticator that fell through to PIN).
      if (state.step3.substep !== 'webauthn' && state.step3.substep !== 'pin-setup') {
        return state;
      }
      return {
        ...state,
        step3: { ...state.step3, completed: true },
        currentStep: 'final',
      };
    }

    case 'RESET': {
      return initialState(state.launchMode);
    }

    default:
      return state;
  }
}

function isValidForwardTransition(flow: Flow, from: Substep, to: Substep): boolean {
  if (flow === 'new') {
    return (from === 'qr' && to === 'verify') || (from === 'verify' && to === 'webauthn');
  }
  if (flow === 'restore-zip') {
    return (
      (from === 'pick-zip' && to === 'verify-rs') ||
      (from === 'verify-rs' && to === 'webauthn')
    );
  }
  // existing-flow: qr → webauthn directly (no verify substep).
  return from === 'qr' && to === 'webauthn';
}

function isValidBackTransition(from: Substep, to: Substep): boolean {
  return (from === 'webauthn' && to === 'verify') || (from === 'verify' && to === 'qr');
}
