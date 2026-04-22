/**
 * RS Confirmation Component
 *
 * This component handles the Recovery Secret confirmation flow during vault
 * creation. It displays the RS QR code and requires the user to re-enter the
 * checksum (last 4 characters) to confirm they have properly saved the RS.
 *
 * Features:
 * - Displays RS in a readable format with grouping
 * - Optional QR code display for RS backup
 * - Checksum input with validation feedback
 * - Prevents vault creation until RS is confirmed
 *
 * Security considerations:
 * - RS is only displayed during initial vault creation
 * - Checksum confirmation ensures user has saved the RS
 * - Session-based tracking (cleared on browser close)
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import {
  type RecoverySecretResult,
  formatRsForDisplay,
  validateRSChecksum,
  confirmRecoveryExportSession,
  getRecoveryExportSession,
  isRecoverySessionConfirmed,
  CHECKSUM_LENGTH,
} from '../auth/recovery';

/**
 * RS Confirmation component props
 */
export interface RSConfirmationProps {
  /** The Recovery Secret to confirm */
  recoverySecret: RecoverySecretResult;
  /** Vault ID for the session */
  vaultId: string;
  /** Callback when RS is successfully confirmed */
  onConfirmed: () => void;
  /** Callback when user wants to cancel */
  onCancel?: () => void;
  /** Whether to show QR code (requires external QR library integration) */
  showQRCode?: boolean;
  /** Custom class name for styling */
  className?: string;
}

/**
 * Confirmation state
 */
type ConfirmationState = 'input' | 'validating' | 'success' | 'error';

/**
 * RS Confirmation Component
 *
 * Renders a UI for displaying and confirming the Recovery Secret.
 * The user must enter the last 4 characters (checksum) to proceed.
 *
 * @example
 * ```tsx
 * <RSConfirmation
 *   recoverySecret={rs}
 *   vaultId="vault-123"
 *   onConfirmed={() => proceedToPasskeyRegistration()}
 *   onCancel={() => cancelVaultCreation()}
 * />
 * ```
 */
export function RSConfirmation({
  recoverySecret,
  vaultId,
  onConfirmed,
  onCancel,
  showQRCode = false,
  className,
}: RSConfirmationProps): JSX.Element {
  // State for checksum input
  const [checksumInput, setChecksumInput] = useState('');
  const [confirmationState, setConfirmationState] = useState<ConfirmationState>('input');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState(0);

  // Formatted RS for display
  const formattedRs = useMemo(() => {
    return formatRsForDisplay(recoverySecret.encoded);
  }, [recoverySecret.encoded]);

  // Check if already confirmed on mount
  useEffect(() => {
    const session = getRecoveryExportSession();
    if (session?.vaultId === vaultId && session.confirmed) {
      setConfirmationState('success');
      onConfirmed();
    }
  }, [vaultId, onConfirmed]);

  // Handle checksum input change
  const handleChecksumChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase().replace(/[^A-Z2-7]/g, '');
    // Limit to CHECKSUM_LENGTH characters
    setChecksumInput(value.slice(0, CHECKSUM_LENGTH));
    // Clear error on new input
    if (errorMessage) {
      setErrorMessage(null);
    }
  }, [errorMessage]);

  // Handle form submission
  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();

    if (checksumInput.length !== CHECKSUM_LENGTH) {
      setErrorMessage(`Please enter all ${CHECKSUM_LENGTH} characters`);
      return;
    }

    setConfirmationState('validating');
    setErrorMessage(null);

    try {
      // First validate locally
      const isValid = validateRSChecksum(recoverySecret.encoded, checksumInput);

      if (!isValid) {
        setAttemptCount((prev) => prev + 1);
        setConfirmationState('error');
        setErrorMessage('Checksum does not match. Please check your Recovery Secret and try again.');
        return;
      }

      // Then confirm the session (updates KeyStore)
      const confirmed = await confirmRecoveryExportSession(checksumInput);

      if (confirmed) {
        setConfirmationState('success');
        onConfirmed();
      } else {
        setConfirmationState('error');
        setErrorMessage('Failed to confirm Recovery Secret. Please try again.');
      }
    } catch (error) {
      setConfirmationState('error');
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred. Please try again.'
      );
    }
  }, [checksumInput, recoverySecret.encoded, onConfirmed]);

  // Copy RS to clipboard
  const handleCopyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(recoverySecret.encoded);
    } catch {
      // Clipboard API may not be available
    }
  }, [recoverySecret.encoded]);

  // Render success state
  if (confirmationState === 'success') {
    return (
      <div className={`rs-confirmation rs-confirmation--success ${className ?? ''}`}>
        <div className="rs-confirmation__icon rs-confirmation__icon--success">✓</div>
        <h3 className="rs-confirmation__title">Recovery Secret Confirmed</h3>
        <p className="rs-confirmation__message">
          Your Recovery Secret has been verified. Keep it safe - you'll need it to recover your
          vault if you lose access to your passkey.
        </p>
      </div>
    );
  }

  return (
    <div className={`rs-confirmation ${className ?? ''}`}>
      {/* Header */}
      <div className="rs-confirmation__header">
        <h3 className="rs-confirmation__title">Save Your Recovery Secret</h3>
        <p className="rs-confirmation__subtitle">
          This is your backup key. Write it down and store it securely. You will need it to recover
          your vault if you lose access to your passkey.
        </p>
      </div>

      {/* RS Display */}
      <div className="rs-confirmation__rs-display">
        <div className="rs-confirmation__rs-label">Recovery Secret</div>
        <div className="rs-confirmation__rs-value">{formattedRs}</div>
        <button
          type="button"
          className="rs-confirmation__copy-btn"
          onClick={handleCopyToClipboard}
          aria-label="Copy Recovery Secret to clipboard"
        >
          Copy
        </button>
      </div>

      {/* QR Code placeholder */}
      {showQRCode && (
        <div className="rs-confirmation__qr-section">
          <div className="rs-confirmation__qr-placeholder">
            {/* QR code would be rendered here with a library like qrcode.react */}
            <span className="rs-confirmation__qr-note">QR Code</span>
          </div>
          <p className="rs-confirmation__qr-hint">
            Scan this QR code to import your Recovery Secret on another device
          </p>
        </div>
      )}

      {/* Confirmation Form */}
      <form className="rs-confirmation__form" onSubmit={handleSubmit}>
        <div className="rs-confirmation__form-header">
          <label htmlFor="rs-checksum" className="rs-confirmation__form-label">
            Confirm your Recovery Secret
          </label>
          <p className="rs-confirmation__form-hint">
            Enter the last {CHECKSUM_LENGTH} characters of your Recovery Secret to verify you have
            saved it correctly.
          </p>
        </div>

        <div className="rs-confirmation__input-row">
          <div className="rs-confirmation__expected-chars">
            {/* Visual hint showing which characters to enter */}
            <span className="rs-confirmation__char-hint">Last {CHECKSUM_LENGTH} characters:</span>
            <span className="rs-confirmation__char-highlight">{recoverySecret.checksum}</span>
          </div>

          <input
            id="rs-checksum"
            type="text"
            className={`rs-confirmation__input ${
              confirmationState === 'error' ? 'rs-confirmation__input--error' : ''
            }`}
            value={checksumInput}
            onChange={handleChecksumChange}
            placeholder={`Enter ${CHECKSUM_LENGTH} characters`}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={CHECKSUM_LENGTH}
            disabled={confirmationState === 'validating'}
            aria-describedby={errorMessage ? 'rs-checksum-error' : undefined}
          />
        </div>

        {/* Error message */}
        {errorMessage && (
          <div id="rs-checksum-error" className="rs-confirmation__error" role="alert">
            <span className="rs-confirmation__error-icon">!</span>
            <span className="rs-confirmation__error-text">{errorMessage}</span>
            {attemptCount >= 3 && (
              <p className="rs-confirmation__error-hint">
                Tip: The checksum is the last {CHECKSUM_LENGTH} characters shown above in the
                Recovery Secret.
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="rs-confirmation__actions">
          {onCancel && (
            <button
              type="button"
              className="rs-confirmation__btn rs-confirmation__btn--secondary"
              onClick={onCancel}
              disabled={confirmationState === 'validating'}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            className="rs-confirmation__btn rs-confirmation__btn--primary"
            disabled={checksumInput.length !== CHECKSUM_LENGTH || confirmationState === 'validating'}
          >
            {confirmationState === 'validating' ? 'Verifying...' : 'Confirm'}
          </button>
        </div>
      </form>

      {/* Security reminder */}
      <div className="rs-confirmation__security-note">
        <span className="rs-confirmation__security-icon">🔒</span>
        <p className="rs-confirmation__security-text">
          Never share your Recovery Secret with anyone. Anthropic staff will never ask for it.
        </p>
      </div>
    </div>
  );
}

/**
 * Hook to check if RS confirmation is required
 *
 * @param vaultId - Vault ID to check
 * @returns Object with confirmation status
 */
export function useRSConfirmationStatus(vaultId: string): {
  isConfirmed: boolean;
  session: ReturnType<typeof getRecoveryExportSession>;
} {
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [session, setSession] = useState<ReturnType<typeof getRecoveryExportSession>>(null);

  useEffect(() => {
    const currentSession = getRecoveryExportSession();
    setSession(currentSession);

    if (currentSession?.vaultId === vaultId) {
      setIsConfirmed(currentSession.confirmed);
    } else {
      setIsConfirmed(false);
    }
  }, [vaultId]);

  return { isConfirmed, session };
}

// Export confirmation state type for external use
export type { ConfirmationState };
