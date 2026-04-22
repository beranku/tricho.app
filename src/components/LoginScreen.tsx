/**
 * Login Screen Component
 *
 * This component handles the vault unlock and creation flow, integrating:
 * - WebAuthn passkey authentication (PRF-based unlock)
 * - Recovery Secret generation and confirmation for new vaults
 * - RS-based fallback unlock for recovery scenarios
 *
 * The flow follows the two-layer architecture:
 * - Layer A (Offline): Local vault unlock via WebAuthn PRF or RS
 * - Layer B (Online): Optional sync via Supabase Auth (separate from this component)
 *
 * States:
 * 1. Initial - Check for existing vault
 * 2. Create Vault - Generate RS, confirm RS, register passkey
 * 3. Unlock - Use passkey or RS to unlock existing vault
 * 4. Recovery - Enter RS to recover access when passkey unavailable
 *
 * Security considerations:
 * - RS confirmation required before vault creation can proceed
 * - DEK is only in memory when vault is unlocked
 * - Multiple failed unlock attempts should trigger rate limiting (UI level)
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import {
  generateRecoverySecret,
  createRecoveryExportSession,
  clearRecoveryExportSession,
  isRecoverySessionConfirmed,
  getRecoveryExportSession,
  decodeRsFromInput,
  isValidRsFormat,
  parseRsInput,
  type RecoverySecretResult,
} from '../auth/recovery';
import { RSConfirmation } from './RSConfirmation';

/**
 * Login screen state
 */
export type LoginScreenState =
  | 'checking'           // Checking for existing vault
  | 'create_rs'          // New vault: showing RS to save
  | 'confirm_rs'         // New vault: confirming RS checksum
  | 'register_passkey'   // New vault: registering WebAuthn credential
  | 'unlock'             // Existing vault: unlock prompt
  | 'unlocking'          // Unlock in progress
  | 'recovery'           // RS recovery flow
  | 'recovering'         // RS recovery in progress
  | 'error'              // Error state
  | 'unlocked';          // Successfully unlocked

/**
 * Login screen props
 */
export interface LoginScreenProps {
  /** Callback when vault is successfully unlocked */
  onUnlocked: () => void;
  /** Whether an existing vault was found */
  hasExistingVault?: boolean;
  /** Vault ID (for existing vaults) */
  vaultId?: string;
  /** Handler to check if vault exists */
  onCheckVault?: () => Promise<{ exists: boolean; vaultId: string | null }>;
  /** Handler to create new vault with DEK */
  onCreateVault?: (rs: Uint8Array) => Promise<{ vaultId: string }>;
  /** Handler to register WebAuthn credential */
  onRegisterPasskey?: (vaultId: string) => Promise<void>;
  /** Handler to unlock with passkey (PRF) */
  onUnlockWithPasskey?: () => Promise<void>;
  /** Handler to unlock with RS */
  onUnlockWithRS?: (rs: Uint8Array) => Promise<void>;
  /** Custom class name */
  className?: string;
  /** Children to render in unlocked state */
  children?: ReactNode;
}

/**
 * Login Screen Component
 *
 * Manages the complete vault access flow including creation and unlock.
 *
 * @example
 * ```tsx
 * <LoginScreen
 *   onUnlocked={() => setAppState('main')}
 *   onCheckVault={checkVaultExists}
 *   onCreateVault={createVaultWithDek}
 *   onRegisterPasskey={registerWebAuthnCredential}
 *   onUnlockWithPasskey={unlockWithPrf}
 *   onUnlockWithRS={unlockWithRecoverySecret}
 * >
 *   <MainApp />
 * </LoginScreen>
 * ```
 */
export function LoginScreen({
  onUnlocked,
  hasExistingVault,
  vaultId: initialVaultId,
  onCheckVault,
  onCreateVault,
  onRegisterPasskey,
  onUnlockWithPasskey,
  onUnlockWithRS,
  className,
  children,
}: LoginScreenProps): JSX.Element {
  // Screen state
  const [state, setState] = useState<LoginScreenState>('checking');
  const [vaultId, setVaultId] = useState<string | null>(initialVaultId ?? null);

  // Recovery Secret for new vault creation
  const [recoverySecret, setRecoverySecret] = useState<RecoverySecretResult | null>(null);

  // RS input for recovery flow
  const [rsInput, setRsInput] = useState('');
  const [rsInputError, setRsInputError] = useState<string | null>(null);

  // Error handling
  const [error, setError] = useState<string | null>(null);
  const [unlockAttempts, setUnlockAttempts] = useState(0);

  // Check for existing vault on mount
  useEffect(() => {
    const checkVault = async () => {
      if (hasExistingVault !== undefined) {
        // Use provided value
        setState(hasExistingVault ? 'unlock' : 'create_rs');
        return;
      }

      if (onCheckVault) {
        try {
          const result = await onCheckVault();
          if (result.exists && result.vaultId) {
            setVaultId(result.vaultId);
            setState('unlock');
          } else {
            setState('create_rs');
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to check vault status');
          setState('error');
        }
      } else {
        // Default to create flow if no check handler
        setState('create_rs');
      }
    };

    checkVault();
  }, [hasExistingVault, onCheckVault]);

  // Generate RS when entering create flow
  useEffect(() => {
    if (state === 'create_rs' && !recoverySecret) {
      const rs = generateRecoverySecret();
      setRecoverySecret(rs);

      // Create a temporary vault ID for the session
      const tempVaultId = `vault-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      setVaultId(tempVaultId);

      // Create recovery export session
      createRecoveryExportSession(tempVaultId, 'new-user', rs.encoded);
    }
  }, [state, recoverySecret]);

  // Handle proceeding from RS display to confirmation
  const handleProceedToConfirm = useCallback(() => {
    setState('confirm_rs');
  }, []);

  // Handle RS confirmation success
  const handleRSConfirmed = useCallback(() => {
    setState('register_passkey');
  }, []);

  // Handle passkey registration
  const handleRegisterPasskey = useCallback(async () => {
    if (!vaultId || !recoverySecret || !onCreateVault || !onRegisterPasskey) {
      setError('Missing required handlers for vault creation');
      setState('error');
      return;
    }

    try {
      // First create the vault with the RS
      const result = await onCreateVault(recoverySecret.raw);
      setVaultId(result.vaultId);

      // Then register the passkey
      await onRegisterPasskey(result.vaultId);

      // Clear the recovery session (RS should be saved by user now)
      clearRecoveryExportSession();

      // Success!
      setState('unlocked');
      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create vault');
      setState('error');
    }
  }, [vaultId, recoverySecret, onCreateVault, onRegisterPasskey, onUnlocked]);

  // Handle unlock with passkey
  const handleUnlockWithPasskey = useCallback(async () => {
    if (!onUnlockWithPasskey) {
      setError('Passkey unlock not available');
      setState('error');
      return;
    }

    setState('unlocking');
    setError(null);

    try {
      await onUnlockWithPasskey();
      setState('unlocked');
      onUnlocked();
    } catch (err) {
      setUnlockAttempts((prev) => prev + 1);
      setError(err instanceof Error ? err.message : 'Failed to unlock with passkey');
      setState('unlock');
    }
  }, [onUnlockWithPasskey, onUnlocked]);

  // Handle switching to recovery flow
  const handleSwitchToRecovery = useCallback(() => {
    setState('recovery');
    setError(null);
    setRsInput('');
    setRsInputError(null);
  }, []);

  // Handle RS input change
  const handleRsInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setRsInput(e.target.value);
    setRsInputError(null);
  }, []);

  // Handle unlock with RS
  const handleUnlockWithRS = useCallback(async () => {
    if (!onUnlockWithRS) {
      setError('RS unlock not available');
      return;
    }

    // Validate RS format
    const normalizedRs = parseRsInput(rsInput);
    if (!isValidRsFormat(normalizedRs)) {
      setRsInputError('Invalid Recovery Secret format. Please check and try again.');
      return;
    }

    setState('recovering');
    setRsInputError(null);

    try {
      const rsBytes = decodeRsFromInput(rsInput);
      await onUnlockWithRS(rsBytes);
      setState('unlocked');
      onUnlocked();
    } catch (err) {
      setUnlockAttempts((prev) => prev + 1);
      setRsInputError(err instanceof Error ? err.message : 'Failed to unlock with Recovery Secret');
      setState('recovery');
    }
  }, [rsInput, onUnlockWithRS, onUnlocked]);

  // Handle cancel from various states
  const handleCancel = useCallback(() => {
    if (state === 'confirm_rs') {
      setState('create_rs');
    } else if (state === 'recovery') {
      setState('unlock');
    } else if (state === 'error') {
      // Go back to appropriate state
      if (recoverySecret && !isRecoverySessionConfirmed()) {
        setState('confirm_rs');
      } else if (vaultId) {
        setState('unlock');
      } else {
        setState('create_rs');
      }
    }
  }, [state, recoverySecret, vaultId]);

  // Render unlocked state (show children)
  if (state === 'unlocked' && children) {
    return <>{children}</>;
  }

  // Render based on current state
  return (
    <div className={`login-screen login-screen--${state} ${className ?? ''}`}>
      <div className="login-screen__container">
        {/* Header */}
        <div className="login-screen__header">
          <div className="login-screen__logo">🔐</div>
          <h1 className="login-screen__title">TrichoApp</h1>
          <p className="login-screen__subtitle">Secure Photo Management</p>
        </div>

        {/* Content based on state */}
        <div className="login-screen__content">
          {/* Checking state */}
          {state === 'checking' && (
            <div className="login-screen__checking">
              <div className="login-screen__spinner" />
              <p>Checking vault status...</p>
            </div>
          )}

          {/* Create RS state */}
          {state === 'create_rs' && recoverySecret && (
            <div className="login-screen__create-rs">
              <h2>Create Your Vault</h2>
              <p className="login-screen__description">
                First, save your Recovery Secret. This is the only way to recover your data if you
                lose access to your passkey.
              </p>

              <RSConfirmation
                recoverySecret={recoverySecret}
                vaultId={vaultId ?? ''}
                onConfirmed={handleRSConfirmed}
                showQRCode={true}
              />
            </div>
          )}

          {/* Confirm RS state */}
          {state === 'confirm_rs' && recoverySecret && vaultId && (
            <RSConfirmation
              recoverySecret={recoverySecret}
              vaultId={vaultId}
              onConfirmed={handleRSConfirmed}
              onCancel={handleCancel}
            />
          )}

          {/* Register passkey state */}
          {state === 'register_passkey' && (
            <div className="login-screen__register-passkey">
              <h2>Register Your Passkey</h2>
              <p className="login-screen__description">
                Now let's set up your passkey. This will be your primary way to unlock your vault.
              </p>

              <div className="login-screen__passkey-info">
                <span className="login-screen__passkey-icon">🔑</span>
                <p>Your passkey uses biometrics or device PIN for secure, passwordless access.</p>
              </div>

              <button
                type="button"
                className="login-screen__btn login-screen__btn--primary"
                onClick={handleRegisterPasskey}
              >
                Register Passkey
              </button>
            </div>
          )}

          {/* Unlock state */}
          {state === 'unlock' && (
            <div className="login-screen__unlock">
              <h2>Welcome Back</h2>
              <p className="login-screen__description">
                Use your passkey to unlock your vault.
              </p>

              <button
                type="button"
                className="login-screen__btn login-screen__btn--primary"
                onClick={handleUnlockWithPasskey}
              >
                <span className="login-screen__btn-icon">🔑</span>
                Unlock with Passkey
              </button>

              {error && (
                <div className="login-screen__error" role="alert">
                  <span className="login-screen__error-icon">!</span>
                  <span>{error}</span>
                </div>
              )}

              {unlockAttempts >= 2 && (
                <div className="login-screen__recovery-hint">
                  <p>Having trouble with your passkey?</p>
                  <button
                    type="button"
                    className="login-screen__btn login-screen__btn--secondary"
                    onClick={handleSwitchToRecovery}
                  >
                    Use Recovery Secret
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Unlocking state */}
          {state === 'unlocking' && (
            <div className="login-screen__unlocking">
              <div className="login-screen__spinner" />
              <p>Unlocking your vault...</p>
            </div>
          )}

          {/* Recovery state */}
          {state === 'recovery' && (
            <div className="login-screen__recovery">
              <h2>Recovery Mode</h2>
              <p className="login-screen__description">
                Enter your Recovery Secret to unlock your vault.
              </p>

              <div className="login-screen__rs-input-container">
                <label htmlFor="rs-recovery-input" className="login-screen__label">
                  Recovery Secret
                </label>
                <textarea
                  id="rs-recovery-input"
                  className={`login-screen__rs-input ${
                    rsInputError ? 'login-screen__rs-input--error' : ''
                  }`}
                  value={rsInput}
                  onChange={handleRsInputChange}
                  placeholder="Enter your Recovery Secret (e.g., ABCD-EFGH-IJKL-...)"
                  rows={4}
                  spellCheck={false}
                  autoComplete="off"
                />
                {rsInputError && (
                  <div className="login-screen__input-error" role="alert">
                    {rsInputError}
                  </div>
                )}
              </div>

              <div className="login-screen__actions">
                <button
                  type="button"
                  className="login-screen__btn login-screen__btn--secondary"
                  onClick={handleCancel}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="login-screen__btn login-screen__btn--primary"
                  onClick={handleUnlockWithRS}
                  disabled={!rsInput.trim()}
                >
                  Unlock
                </button>
              </div>
            </div>
          )}

          {/* Recovering state */}
          {state === 'recovering' && (
            <div className="login-screen__recovering">
              <div className="login-screen__spinner" />
              <p>Recovering your vault...</p>
            </div>
          )}

          {/* Error state */}
          {state === 'error' && (
            <div className="login-screen__error-state">
              <div className="login-screen__error-icon-large">⚠️</div>
              <h2>Something went wrong</h2>
              <p className="login-screen__error-message">{error}</p>
              <button
                type="button"
                className="login-screen__btn login-screen__btn--secondary"
                onClick={handleCancel}
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="login-screen__footer">
          <p className="login-screen__footer-text">
            Your data is encrypted and stored locally.
            {state === 'unlock' && ' Only you can access it.'}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook to manage login screen state
 *
 * Provides a simpler interface for managing vault unlock state.
 *
 * @returns Object with current state and actions
 */
export function useLoginScreen(): {
  isUnlocked: boolean;
  state: LoginScreenState;
  error: string | null;
  setUnlocked: () => void;
  setLocked: () => void;
  setError: (error: string) => void;
} {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [state, setState] = useState<LoginScreenState>('checking');
  const [error, setError] = useState<string | null>(null);

  const setUnlocked = useCallback(() => {
    setIsUnlocked(true);
    setState('unlocked');
    setError(null);
  }, []);

  const setLocked = useCallback(() => {
    setIsUnlocked(false);
    setState('unlock');
  }, []);

  const setErrorState = useCallback((err: string) => {
    setError(err);
    setState('error');
  }, []);

  return {
    isUnlocked,
    state,
    error,
    setUnlocked,
    setLocked,
    setError: setErrorState,
  };
}

// Export types
export type { RecoverySecretResult };
