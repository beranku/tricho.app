import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useStore } from '@nanostores/react';
import { localeStore, m } from '../../i18n';
import {
  detectBrowser,
  detectLaunchMode,
  type BrowserFamily,
  type LaunchMode,
} from '../../lib/launch-mode';
import {
  initialState,
  wizardReducer,
  type Substep,
  type WizardState,
} from './wizard-state';
import { StepCard } from './StepCard';
import { Step1Install } from './Step1Install';
import { Step2SignIn } from './Step2SignIn';
import { Step3Encryption } from './Step3Encryption';
import { FinalCard } from './FinalCard';
import type { RecoverySecretResult } from '../../auth/recovery';

export interface OnboardingWizardProps {
  /** Whether the OAuth callback already produced an authenticated session.
   *  When true, the wizard mounts already past Step 2. */
  authenticated: boolean;
  /** When non-null, the server probe found a vault-state for this user
   *  ⇒ Step 3 auto-selects the existing flow. */
  hasServerVaultState: boolean;

  /** Step 3 callbacks. */
  onCreateVault: (rs: Uint8Array) => Promise<{ vaultId: string }>;
  onJoinWithRs: (
    rs: RecoverySecretResult,
  ) => Promise<{ ok: true; vaultId: string } | { ok: false; reason: 'wrong-key' | 'invalid' }>;
  onRegisterPasskey: (vaultId: string) => Promise<void>;
  /** Final-state CTA: AppShell transitions to the unlocked app. */
  onUnlocked: () => void;

  /** Override for tests — defaults to live `detectLaunchMode`. */
  detectLaunchModeOverride?: () => LaunchMode;
  detectBrowserOverride?: () => BrowserFamily;
}

/**
 * Top-level wizard. Owns the reducer, mounts the three step cards, the
 * aria-live region, and the final card. Components for Step 2 / Step 3
 * are not even constructed when `launchMode === 'browser'` — that's the
 * PWA-storage-origin invariant from the design doc.
 */
export function OnboardingWizard({
  authenticated,
  hasServerVaultState,
  onCreateVault,
  onJoinWithRs,
  onRegisterPasskey,
  onUnlocked,
  detectLaunchModeOverride,
  detectBrowserOverride,
}: OnboardingWizardProps): JSX.Element {
  useStore(localeStore);

  // Lazy initial state: detect launch mode once on mount.
  const [state, dispatch] = useReducer(
    wizardReducer,
    null,
    () => {
      const launchMode = (detectLaunchModeOverride ?? detectLaunchMode)();
      const seed = initialState(launchMode);
      // If the AppShell already has an OAuth session, skip Step 2.
      if (authenticated && launchMode === 'pwa') {
        return {
          ...seed,
          step2: { authenticated: true },
          currentStep: 3,
        } as WizardState;
      }
      return seed;
    },
  );

  const browser = (detectBrowserOverride ?? detectBrowser)();

  // Auto-select the Step 3 flow as soon as we land there. The probe is
  // already cached in `hasServerVaultState` by the AppShell, so this
  // reduces to a single dispatch.
  useEffect(() => {
    if (state.currentStep !== 3) return;
    if (hasServerVaultState && state.step3.flow !== 'existing') {
      dispatch({ type: 'SET_FLOW', flow: 'existing' });
    } else if (!hasServerVaultState && state.step3.flow !== 'new') {
      dispatch({ type: 'SET_FLOW', flow: 'new' });
    }
  }, [state.currentStep, state.step3.flow, hasServerVaultState]);

  // aria-live announcer for substep transitions (Step 3 only — step
  // transitions are conveyed by visual change + focus).
  const liveMessage = useMemo(() => {
    if (state.currentStep !== 3) return '';
    if (state.step3.substep === 'qr') return m.wizard_aria_substep_qr();
    if (state.step3.substep === 'verify') return m.wizard_aria_substep_verify();
    return m.wizard_aria_substep_webauthn();
  }, [state.currentStep, state.step3.substep]);

  const [generatedRs, setGeneratedRs] = useState<RecoverySecretResult | null>(null);

  // E2E test bridge — exposes the generated RS so Playwright can drive
  // the verify substep without needing to OCR the QR canvas. Gated on the
  // existing `tricho-e2e-bridge` localStorage sentinel so production users
  // never get the bridge object.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem('tricho-e2e-bridge') !== '1') return;
    if (!generatedRs) return;
    (window as unknown as { __trichoWizardE2E?: { generatedRs: { encoded: string; checksum: string } } }).__trichoWizardE2E = {
      generatedRs: { encoded: generatedRs.encoded, checksum: generatedRs.checksum },
    };
    return () => {
      delete (window as unknown as { __trichoWizardE2E?: unknown }).__trichoWizardE2E;
    };
  }, [generatedRs]);

  const onAdvanceSubstep = useCallback(
    (substep: Substep) => dispatch({ type: 'ADVANCE_SUBSTEP', substep }),
    [],
  );
  const onBackSubstep = useCallback(
    (target: Substep) => dispatch({ type: 'BACK_SUBSTEP', target }),
    [],
  );

  // Final state replaces the wizard surface.
  if (state.currentStep === 'final') {
    return (
      <div className="welcome-stage">
        <Brand />
        <FinalCard onOpenApp={onUnlocked} />
      </div>
    );
  }

  const step1State =
    state.currentStep === 1 ? 'active' : 'done';
  const step2State =
    state.launchMode === 'browser'
      ? 'locked'
      : state.currentStep < 2
        ? 'locked'
        : state.currentStep === 2
          ? 'active'
          : 'done';
  const step3State =
    state.launchMode === 'browser'
      ? 'locked'
      : state.currentStep < 3
        ? 'locked'
        : state.currentStep === 3
          ? 'active'
          : 'done';

  const isBrowser = state.launchMode === 'browser';

  return (
    <div className="welcome-stage" data-launch-mode={state.launchMode}>
      <Brand />
      <div
        className="aria-live-region"
        role="status"
        aria-live="polite"
        data-testid="wizard-aria-live"
      >
        {liveMessage}
      </div>
      <div className="welcome-steps">
        <StepCard
          step={1}
          state={step1State}
          kicker={m.wizard_step1_kicker()}
          title={m.wizard_step1_title()}
        >
          <Step1Install
            launchMode={state.launchMode}
            browser={browser}
            installed={state.step1.installed}
            onConfirm={() => dispatch({ type: 'CONFIRM_INSTALLATION' })}
            onCancel={() => dispatch({ type: 'CANCEL_INSTALLATION' })}
          />
        </StepCard>

        <StepCard
          step={2}
          state={step2State}
          kicker={m.wizard_step2_kicker()}
          title={m.wizard_step2_title()}
        >
          {!isBrowser && state.currentStep === 2 && <Step2SignIn />}
        </StepCard>

        <StepCard
          step={3}
          state={step3State}
          kicker={m.wizard_step3_kicker()}
          title={m.wizard_step3_title()}
          flow={state.step3.flow}
          substep={state.step3.substep}
          headerRight={renderStep3Back(state, onBackSubstep)}
        >
          {!isBrowser && state.currentStep === 3 && (
            <Step3Encryption
              flow={state.step3.flow}
              substep={state.step3.substep}
              generatedRs={generatedRs}
              setGeneratedRs={setGeneratedRs}
              onAdvanceSubstep={onAdvanceSubstep}
              onJoinWithRs={onJoinWithRs}
              onCreateVault={onCreateVault}
              onRegisterPasskey={onRegisterPasskey}
              onCompleted={() => dispatch({ type: 'COMPLETE_STEP_3' })}
            />
          )}
        </StepCard>
      </div>
    </div>
  );
}

function Brand(): JSX.Element {
  return (
    <header className="welcome-brand">
      <div className="welcome-brand-wordmark">
        <span className="welcome-brand-name">{m.wizard_brandName()}</span>
        <span className="welcome-brand-suffix">{m.wizard_brandSuffix()}</span>
      </div>
      <p className="welcome-subtitle">{m.wizard_subtitle()}</p>
    </header>
  );
}

function renderStep3Back(
  state: WizardState,
  onBackSubstep: (target: Substep) => void,
): React.ReactNode {
  if (state.currentStep !== 3) return null;
  if (state.step3.flow !== 'new') return null;
  if (state.step3.substep === 'qr') return null;
  const target: Substep = state.step3.substep === 'webauthn' ? 'verify' : 'qr';
  const label =
    state.step3.substep === 'webauthn'
      ? m.wizard_step3_new_webauthn_back()
      : m.wizard_step3_new_verify_back();
  return (
    <button
      type="button"
      className="step-card__back"
      onClick={() => onBackSubstep(target)}
      data-testid="wizard-step3-back"
      data-target={target}
    >
      {label}
    </button>
  );
}
