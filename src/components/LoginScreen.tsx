/**
 * Login/Setup Screen Component
 *
 * Handles both first-time account setup with passkey registration
 * and subsequent login with passkey authentication.
 *
 * Features:
 * - First-time setup flow with passkey registration
 * - Login flow with passkey authentication
 * - Recovery flow with QR scanner integration
 * - WebAuthn capability detection and helpful messaging
 * - Error handling and retry logic
 *
 * @module components/LoginScreen
 *
 * @example
 * ```tsx
 * import { LoginScreen } from '@/components/LoginScreen';
 *
 * // In App.tsx:
 * <App
 *   setupComponent={<LoginScreen mode="setup" />}
 *   loginComponent={<LoginScreen mode="login" />}
 * >
 *   <MainContent />
 * </App>
 *
 * // Or with automatic mode detection:
 * <LoginScreen />
 * ```
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  type FormEvent,
} from 'react';
import { useAuth, AuthState, type SetupResult, type PrfLoginOptions } from '../context/AuthContext';
import { RecoveryQRDisplay } from './RecoveryQRDisplay';
import { RecoveryQRScanner } from './RecoveryQRScanner';
import type { RecoveryImportResult } from '../auth/recovery';
import type { RecoverySecret, DataEncryptionKey, DerivedKek } from '../crypto/keys';
import type { PrfCapabilities } from '../auth/prf';

// ============================================================================
// Types
// ============================================================================

/**
 * Screen mode
 */
export type LoginScreenMode = 'setup' | 'login' | 'auto';

/**
 * Props for LoginScreen component
 */
export interface LoginScreenProps {
  /** Screen mode (default: 'auto' - determined by auth state) */
  mode?: LoginScreenMode;
  /** Callback when setup completes successfully */
  onSetupComplete?: () => void;
  /** Callback when login completes successfully */
  onLoginComplete?: () => void;
  /** Callback to navigate to recovery flow */
  onRecoveryClick?: () => void;
  /** Custom class name for styling */
  className?: string;
  /** App name to display (default: 'TrichoApp') */
  appName?: string;
  /** Whether to show recovery option (default: true) */
  showRecoveryOption?: boolean;
}

/**
 * Internal screen state
 */
type ScreenState =
  | 'idle'
  | 'checking_capabilities'
  | 'entering_username'
  | 'registering'
  | 'authenticating'
  | 'showing_recovery'
  | 'completing_setup'
  | 'setup_complete'
  | 'recovery_scanning'
  | 'recovery_registering'
  | 'recovery_completing'
  | 'error';

/**
 * Pending setup result (before completing setup)
 * Stores all the data needed to complete setup after user saves recovery QR
 */
interface PendingSetupResult {
  user: {
    userId: string;
    username: string;
    credentialId?: string;
  };
  kek: DerivedKek;
  dek: DataEncryptionKey;
  recoverySecret: RecoverySecret;
  deviceSalt: Uint8Array;
  prfSalt: Uint8Array;
  prfSucceeded: boolean;
}

/**
 * Pending recovery result (after QR scan, before passkey registration)
 * Stores the derived keys from QR scan for completing recovery
 */
interface PendingRecoveryResult {
  /** Recovery secret from QR scan */
  recoverySecret: RecoverySecret;
  /** Derived KEK from recovery secret */
  kek: CryptoKey;
  /** Device salt used for KEK derivation */
  deviceSalt: Uint8Array;
  /** When the QR was scanned */
  scannedAt: number;
}

// ============================================================================
// Helper Components
// ============================================================================

/**
 * Loading spinner component
 */
function LoadingSpinner({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="login-spinner"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

/**
 * Passkey icon SVG
 */
function PasskeyIcon({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="login-passkey-icon"
      aria-hidden="true"
    >
      <path d="M2 12c0 2.21 1.79 4 4 4h2" />
      <path d="M6 8c0-2.21 1.79-4 4-4h8c2.21 0 4 1.79 4 4v8c0 2.21-1.79 4-4 4h-8" />
      <path d="M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
      <path d="M12 14v4" />
    </svg>
  );
}

/**
 * Error icon SVG
 */
function ErrorIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="login-error-icon"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

/**
 * Warning message for PRF limitations
 */
function PrfWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <div className="login-prf-warnings" role="note">
      <details>
        <summary>Platform notes</summary>
        <ul>
          {warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Login/Setup Screen Component
 *
 * Provides the UI for:
 * - First-time account setup with passkey registration
 * - Login with passkey authentication
 * - Entry to recovery flow
 */
export function LoginScreen({
  mode = 'auto',
  onSetupComplete,
  onLoginComplete,
  onRecoveryClick,
  className = '',
  appName = 'TrichoApp',
  showRecoveryOption = true,
}: LoginScreenProps) {
  // ========================================================================
  // State
  // ========================================================================

  const auth = useAuth();
  const { authState, error: authError, completeSetup, recoverWithSecret, clearError } = auth;

  // Determine actual mode based on auth state
  const actualMode = useMemo(() => {
    if (mode !== 'auto') {
      return mode;
    }
    return authState === AuthState.NeedsSetup ? 'setup' : 'login';
  }, [mode, authState]);

  // Local state
  const [screenState, setScreenState] = useState<ScreenState>('idle');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [prfCapabilities, setPrfCapabilities] = useState<PrfCapabilities | null>(null);
  const [webAuthnSupported, setWebAuthnSupported] = useState(true);
  const [pendingSetup, setPendingSetup] = useState<PendingSetupResult | null>(null);
  const [pendingRecovery, setPendingRecovery] = useState<PendingRecoveryResult | null>(null);
  const [showRecoveryScanner, setShowRecoveryScanner] = useState(false);

  // ========================================================================
  // Capability Detection
  // ========================================================================

  useEffect(() => {
    async function checkCapabilities() {
      setScreenState('checking_capabilities');

      try {
        // Dynamically import to avoid SSR issues
        const { getWebAuthnCapabilities } = await import('../auth/passkey');
        const { getPrfCapabilities } = await import('../auth/prf');

        const webAuthnCaps = await getWebAuthnCapabilities();
        setWebAuthnSupported(webAuthnCaps.webAuthnSupported);

        if (webAuthnCaps.webAuthnSupported) {
          const prfCaps = await getPrfCapabilities();
          setPrfCapabilities(prfCaps);
        }
      } catch (err) {
        setError('Failed to check browser capabilities');
      } finally {
        setScreenState('idle');
      }
    }

    checkCapabilities();
  }, []);

  // ========================================================================
  // Setup Flow (First-time registration)
  // ========================================================================

  const handleSetupSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      clearError();

      const trimmedUsername = username.trim();
      if (!trimmedUsername) {
        setError('Please enter your email address');
        return;
      }

      // Basic email validation
      if (!trimmedUsername.includes('@') || trimmedUsername.length < 5) {
        setError('Please enter a valid email address');
        return;
      }

      setScreenState('registering');

      try {
        // Dynamically import auth modules
        const { registerPasskey, getDeviceInfo } = await import('../auth/passkey');
        const { generateRecoverySecret, generateDataEncryptionKey, generateDeviceSalt, deriveKek } =
          await import('../crypto/keys');
        const { generatePrfSalt } = await import('../auth/prf');

        // Step 1: Register passkey with server
        const registrationResult = await registerPasskey(trimmedUsername, {
          deviceInfo: getDeviceInfo(),
        });

        // Step 2: Generate cryptographic keys
        const recoverySecret = generateRecoverySecret();
        const dek = generateDataEncryptionKey();
        const deviceSalt = generateDeviceSalt();
        const prfSalt = generatePrfSalt();

        // Step 3: Derive KEK from recovery secret
        // For setup, we always use RS to derive KEK initially
        // PRF-based KEK derivation happens during authentication
        const kek = await deriveKek(null, recoverySecret, deviceSalt);

        // Step 4: Store pending setup result and show recovery QR
        // The user MUST save their recovery QR before we complete setup
        const pendingResult: PendingSetupResult = {
          user: {
            userId: registrationResult.userId,
            username: trimmedUsername,
            credentialId: registrationResult.credentialId,
          },
          kek,
          dek,
          recoverySecret,
          deviceSalt,
          prfSalt,
          prfSucceeded: false, // PRF is tested during auth, not registration
        };

        setPendingSetup(pendingResult);
        setScreenState('showing_recovery');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Setup failed';

        // Handle specific error types
        if (message.includes('cancelled') || message.includes('canceled')) {
          setError('Registration was cancelled. Please try again.');
        } else if (message.includes('NotAllowedError')) {
          setError('Passkey registration was denied. Please try again.');
        } else if (message.includes('not supported')) {
          setError('Passkeys are not supported in this browser.');
          setWebAuthnSupported(false);
        } else {
          setError(message);
        }

        setScreenState('error');
      }
    },
    [username, completeSetup, clearError, onSetupComplete]
  );

  // ========================================================================
  // Login Flow (Authentication with PRF)
  // ========================================================================

  const handleLoginSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      clearError();

      const trimmedUsername = username.trim();
      if (!trimmedUsername) {
        setError('Please enter your email address');
        return;
      }

      setScreenState('authenticating');

      try {
        // Get device info for session tracking
        const { getDeviceInfo } = await import('../auth/passkey');

        // Use the PRF-based login (daily unlock flow)
        // This doesn't require recovery secret - PRF provides key material
        const loginOptions: PrfLoginOptions = {
          username: trimmedUsername,
          deviceInfo: getDeviceInfo(),
        };

        const success = await auth.loginWithPrf(loginOptions);

        if (success) {
          // Login succeeded - PRF worked
          setScreenState('idle');
          onLoginComplete?.();
        } else {
          // PRF failed - need recovery flow
          // The auth context already set an appropriate error message
          setScreenState('error');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Login failed';

        if (message.includes('cancelled') || message.includes('canceled')) {
          setError('Authentication was cancelled. Please try again.');
        } else if (message.includes('not registered')) {
          setError('No passkey found for this account. Please set up a new account or use recovery.');
        } else if (message.includes('NotAllowedError')) {
          setError('Authentication was denied. Please try again.');
        } else {
          setError(message);
        }

        setScreenState('error');
      }
    },
    [username, clearError, auth, onLoginComplete]
  );

  // ========================================================================
  // Complete Setup After Recovery QR Saved
  // ========================================================================

  const handleRecoveryConfirmed = useCallback(async () => {
    if (!pendingSetup) {
      setError('Setup data was lost. Please try again.');
      setScreenState('error');
      return;
    }

    setScreenState('completing_setup');

    try {
      // Build the setup result from pending data
      const setupResult: SetupResult = {
        user: pendingSetup.user,
        kek: pendingSetup.kek,
        dek: pendingSetup.dek,
        recoverySecret: pendingSetup.recoverySecret,
        deviceSalt: pendingSetup.deviceSalt,
        prfSalt: pendingSetup.prfSalt,
        prfSucceeded: pendingSetup.prfSucceeded,
      };

      // Now complete the setup (wraps DEK, inits DB)
      await completeSetup(setupResult);

      // Clear the pending setup data (RS will be cleared by RecoveryQRDisplay)
      setPendingSetup(null);

      // Mark as complete
      setScreenState('setup_complete');
      onSetupComplete?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Setup failed';
      setError(message);
      setScreenState('error');
    }
  }, [pendingSetup, completeSetup, onSetupComplete]);

  const handleRecoverySkipped = useCallback(async () => {
    // User chose to skip saving recovery - still complete setup but they'll be reminded later
    if (!pendingSetup) {
      setError('Setup data was lost. Please try again.');
      setScreenState('error');
      return;
    }

    setScreenState('completing_setup');

    try {
      const setupResult: SetupResult = {
        user: pendingSetup.user,
        kek: pendingSetup.kek,
        dek: pendingSetup.dek,
        recoverySecret: pendingSetup.recoverySecret,
        deviceSalt: pendingSetup.deviceSalt,
        prfSalt: pendingSetup.prfSalt,
        prfSucceeded: pendingSetup.prfSucceeded,
      };

      await completeSetup(setupResult);

      // Clear the pending setup but user hasn't saved recovery
      // hasUnsavedRecovery will remain true in AuthContext
      setPendingSetup(null);
      setScreenState('setup_complete');
      onSetupComplete?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Setup failed';
      setError(message);
      setScreenState('error');
    }
  }, [pendingSetup, completeSetup, onSetupComplete]);

  // ========================================================================
  // Recovery Flow
  // ========================================================================

  /**
   * Handle click on "Recover Account" button
   * Shows the QR scanner to scan recovery code
   */
  const handleRecoveryClick = useCallback(() => {
    if (onRecoveryClick) {
      onRecoveryClick();
    } else {
      // Default behavior: show recovery scanner
      setError(null);
      clearError();
      setShowRecoveryScanner(true);
      setScreenState('recovery_scanning');
    }
  }, [onRecoveryClick, clearError]);

  /**
   * Handle successful QR scan
   * Stores the recovery data and prompts for username/passkey registration
   */
  const handleRecoveryScanSuccess = useCallback((result: RecoveryImportResult) => {
    // Store the recovery result
    setPendingRecovery({
      recoverySecret: result.recoverySecret,
      kek: result.kek,
      deviceSalt: result.deviceSalt,
      scannedAt: result.importedAt,
    });

    // Close scanner and show registration form
    setShowRecoveryScanner(false);
    setScreenState('recovery_registering');
    setError(null);
  }, []);

  /**
   * Handle cancel from recovery scanner
   */
  const handleRecoveryScanCancel = useCallback(() => {
    setShowRecoveryScanner(false);
    setScreenState('idle');
    setPendingRecovery(null);
  }, []);

  /**
   * Handle error from recovery scanner
   */
  const handleRecoveryScanError = useCallback((err: Error) => {
    setError(err.message);
  }, []);

  /**
   * Submit the recovery registration form
   * Registers a new passkey and completes the recovery
   */
  const handleRecoveryRegistrationSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      clearError();

      if (!pendingRecovery) {
        setError('Recovery data was lost. Please scan the QR code again.');
        setScreenState('error');
        return;
      }

      const trimmedUsername = username.trim();
      if (!trimmedUsername) {
        setError('Please enter your email address');
        return;
      }

      // Basic email validation
      if (!trimmedUsername.includes('@') || trimmedUsername.length < 5) {
        setError('Please enter a valid email address');
        return;
      }

      setScreenState('recovery_completing');

      try {
        // Dynamically import auth modules
        const { registerPasskey, getDeviceInfo } = await import('../auth/passkey');
        const { markDeviceAsRecovered } = await import('../auth/recovery');
        const { generateDataEncryptionKey, wrapDek, serializeWrappedDek } = await import('../crypto/keys');
        const { base64urlEncode } = await import('../crypto/utils');

        // Step 1: Register a new passkey for this device
        // This establishes the user's identity with the server
        const registrationResult = await registerPasskey(trimmedUsername, {
          deviceInfo: getDeviceInfo(),
        });

        // Step 2: Check if we have a wrapped DEK stored locally
        // For fresh device recovery, we may need to get this from sync
        let wrappedDekStr = localStorage.getItem('tricho:wrapped_dek');

        if (!wrappedDekStr) {
          // No local wrapped DEK - this is a fresh device recovery
          // We need to either:
          // 1. Generate a new DEK (if this is the first device ever)
          // 2. Or sync the DEK from CouchDB (if recovering existing data)
          //
          // For recovery scenarios where user has synced data,
          // the DEK should be wrapped with RS-derived KEK and stored somewhere accessible.
          //
          // For now, we'll generate a new DEK wrapped with the RS-derived KEK.
          // In a full multi-device implementation, this would sync from CouchDB.
          const newDek = generateDataEncryptionKey();
          const wrappedDek = await wrapDek(newDek, pendingRecovery.kek);
          const wrappedDekBytes = serializeWrappedDek(wrappedDek);
          wrappedDekStr = base64urlEncode(wrappedDekBytes);
          localStorage.setItem('tricho:wrapped_dek', wrappedDekStr);
        }

        // Step 3: Save user info and mark account as existing
        const user = {
          userId: registrationResult.userId,
          username: trimmedUsername,
          credentialId: registrationResult.credentialId,
        };
        localStorage.setItem('tricho:user', JSON.stringify(user));
        localStorage.setItem('tricho:account_exists', 'true');

        // Step 4: Save device credentials for future logins
        const { createStoredCredentials, saveStoredCredentials } = await import('../auth/prf');
        const storedCreds = createStoredCredentials(
          {
            unlockMethod: 'rs',
            kek: { key: pendingRecovery.kek, source: 'rs', deviceSalt: pendingRecovery.deviceSalt },
            deviceSalt: pendingRecovery.deviceSalt,
            prfSucceeded: false,
            authResult: {
              verified: true,
              userId: registrationResult.userId,
              credentialId: registrationResult.credentialId,
              prfSupported: false,
            },
          },
          user.userId
        );
        saveStoredCredentials(storedCreds);

        // Step 5: Mark device as recovered
        markDeviceAsRecovered();

        // Step 6: Complete recovery through AuthContext
        // This will unwrap DEK and initialize the database
        await recoverWithSecret(pendingRecovery.recoverySecret);

        // Clean up
        setPendingRecovery(null);
        setScreenState('idle');

        // Notify completion
        onLoginComplete?.();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Recovery failed';

        if (message.includes('cancelled') || message.includes('canceled')) {
          setError('Registration was cancelled. Please try again.');
        } else if (message.includes('NotAllowedError')) {
          setError('Passkey registration was denied. Please try again.');
        } else if (message.includes('already exists') || message.includes('already registered')) {
          // User already has a passkey, try to proceed with recovery
          setError('A passkey already exists for this account. Please use the login button instead.');
        } else {
          setError(message);
        }

        setScreenState('error');
      }
    },
    [pendingRecovery, username, clearError, recoverWithSecret, onLoginComplete]
  );

  /**
   * Cancel the recovery registration and go back to scanner
   */
  const handleRecoveryRegistrationCancel = useCallback(() => {
    setPendingRecovery(null);
    setScreenState('idle');
    setUsername('');
    setError(null);
  }, []);

  // ========================================================================
  // Retry Logic
  // ========================================================================

  const handleRetry = useCallback(() => {
    setError(null);
    clearError();
    setScreenState('idle');
  }, [clearError]);

  // ========================================================================
  // Render
  // ========================================================================

  const isSetup = actualMode === 'setup';
  const isLoading = screenState === 'checking_capabilities';
  const isProcessing = screenState === 'registering' || screenState === 'authenticating' || screenState === 'completing_setup' || screenState === 'recovery_completing';
  const isShowingSetupRecovery = screenState === 'showing_recovery' || screenState === 'completing_setup';
  const isInRecoveryFlow = screenState === 'recovery_scanning' || screenState === 'recovery_registering' || screenState === 'recovery_completing' || showRecoveryScanner;
  const hasError = screenState === 'error' || !!error || !!authError;
  const displayError = error || authError;

  const containerClasses = [
    'login-screen',
    `login-screen--${actualMode}`,
    isProcessing ? 'login-screen--processing' : '',
    hasError ? 'login-screen--error' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  // Show loading state while checking capabilities
  if (isLoading) {
    return (
      <div className={containerClasses}>
        <div className="login-content">
          <div className="login-loading">
            <LoadingSpinner size={48} />
            <p>Checking browser capabilities...</p>
          </div>
        </div>
      </div>
    );
  }

  // Show unsupported browser message
  if (!webAuthnSupported) {
    return (
      <div className={containerClasses}>
        <div className="login-content">
          <div className="login-unsupported" role="alert">
            <ErrorIcon size={48} />
            <h2>Browser Not Supported</h2>
            <p>
              {appName} requires passkey support which is not available in this browser.
            </p>
            <p>
              Please use a modern browser like Chrome, Safari, Edge, or Firefox on a
              recent version.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show recovery QR scanner for account recovery
  if (showRecoveryScanner) {
    return (
      <div className={`${containerClasses} login-screen--recovery-scanner`}>
        <div className="login-content login-content--recovery-scanner">
          <RecoveryQRScanner
            onScanSuccess={handleRecoveryScanSuccess}
            onCancel={handleRecoveryScanCancel}
            onError={handleRecoveryScanError}
            allowManualEntry={true}
            appName={appName}
          />
        </div>
      </div>
    );
  }

  // Show recovery registration form (after QR scan)
  if ((screenState === 'recovery_registering' || screenState === 'recovery_completing') && pendingRecovery) {
    return (
      <div className={`${containerClasses} login-screen--recovery-register`}>
        <div className="login-content">
          {/* Header */}
          <header className="login-header">
            <PasskeyIcon size={64} />
            <h1 className="login-title">Recover {appName}</h1>
            <p className="login-subtitle">
              Recovery code verified! Now enter your email and register a new passkey for this device.
            </p>
          </header>

          {/* Registration Form */}
          <form className="login-form" onSubmit={handleRecoveryRegistrationSubmit}>
            {/* Username Input */}
            <div className="login-field">
              <label htmlFor="recovery-username" className="login-label">
                Email Address
              </label>
              <input
                id="recovery-username"
                type="email"
                className="login-input"
                placeholder="you@example.com"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username webauthn"
                autoFocus
                disabled={screenState === 'recovery_completing'}
                required
                aria-describedby={displayError ? 'recovery-error' : undefined}
              />
              <p className="login-field-hint">
                Enter the same email you used when setting up the account.
              </p>
            </div>

            {/* Error Display */}
            {displayError && (
              <div id="recovery-error" className="login-error" role="alert">
                <ErrorIcon size={16} />
                <span>{displayError}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              className="login-button login-button--primary"
              disabled={screenState === 'recovery_completing' || !username.trim()}
            >
              {screenState === 'recovery_completing' ? (
                <>
                  <LoadingSpinner size={20} />
                  <span>Recovering account...</span>
                </>
              ) : (
                <span>Register Passkey & Recover</span>
              )}
            </button>

            {/* Cancel Button */}
            <button
              type="button"
              className="login-button login-button--secondary"
              onClick={handleRecoveryRegistrationCancel}
              disabled={screenState === 'recovery_completing'}
            >
              Cancel
            </button>
          </form>

          {/* Footer */}
          <footer className="login-footer">
            <p className="login-security-note">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>
                Your recovery code is being used to restore access to your encrypted data.
              </span>
            </p>
          </footer>
        </div>
      </div>
    );
  }

  // Show recovery QR display after registration (setup flow)
  // User MUST save their recovery QR before we complete setup and init the database
  if (isShowingSetupRecovery && pendingSetup) {
    return (
      <div className={`${containerClasses} login-screen--recovery`}>
        <div className="login-content login-content--recovery">
          {screenState === 'completing_setup' ? (
            <div className="login-loading">
              <LoadingSpinner size={48} />
              <p>Setting up your account...</p>
            </div>
          ) : (
            <RecoveryQRDisplay
              recoverySecret={pendingSetup.recoverySecret}
              userId={pendingSetup.user.userId}
              mode="setup"
              onConfirm={handleRecoveryConfirmed}
              onSkip={handleRecoverySkipped}
              showTextBackup={true}
              showPrintOption={false}
              appName={appName}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      <div className="login-content">
        {/* Header */}
        <header className="login-header">
          <PasskeyIcon size={64} />
          <h1 className="login-title">{appName}</h1>
          <p className="login-subtitle">
            {isSetup
              ? 'Create your secure account with a passkey'
              : 'Sign in with your passkey'}
          </p>
        </header>

        {/* PRF Warnings (if any) */}
        {prfCapabilities && <PrfWarnings warnings={prfCapabilities.warnings} />}

        {/* Main Form */}
        <form
          className="login-form"
          onSubmit={isSetup ? handleSetupSubmit : handleLoginSubmit}
        >
          {/* Username Input */}
          <div className="login-field">
            <label htmlFor="login-username" className="login-label">
              Email Address
            </label>
            <input
              id="login-username"
              type="email"
              className="login-input"
              placeholder="you@example.com"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username webauthn"
              autoFocus
              disabled={isProcessing}
              required
              aria-describedby={displayError ? 'login-error' : undefined}
            />
          </div>

          {/* Error Display */}
          {displayError && (
            <div id="login-error" className="login-error" role="alert">
              <ErrorIcon size={16} />
              <span>{displayError}</span>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            className="login-button login-button--primary"
            disabled={isProcessing || !username.trim()}
          >
            {isProcessing ? (
              <>
                <LoadingSpinner size={20} />
                <span>{isSetup ? 'Creating account...' : 'Signing in...'}</span>
              </>
            ) : (
              <span>{isSetup ? 'Create Account with Passkey' : 'Sign in with Passkey'}</span>
            )}
          </button>

          {/* Retry Button (on error) */}
          {hasError && !isProcessing && (
            <button
              type="button"
              className="login-button login-button--secondary"
              onClick={handleRetry}
            >
              Try Again
            </button>
          )}
        </form>

        {/* Recovery Option */}
        {showRecoveryOption && (
          <div className="login-recovery">
            <div className="login-divider">
              <span>or</span>
            </div>
            <button
              type="button"
              className="login-button login-button--text"
              onClick={handleRecoveryClick}
            >
              Recover account with QR code
            </button>
          </div>
        )}

        {/* Footer */}
        <footer className="login-footer">
          <p className="login-security-note">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span>
              Your data is encrypted end-to-end. Only you can access it.
            </span>
          </p>
        </footer>
      </div>
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export default LoginScreen;
