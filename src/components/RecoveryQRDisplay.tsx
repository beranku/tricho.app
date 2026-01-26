/**
 * Recovery QR Display Component
 *
 * Displays the Recovery Secret (RS) as a QR code for users to save.
 * This is the "break glass" mechanism for account recovery when
 * passkeys are unavailable or deleted.
 *
 * SECURITY CONSIDERATIONS:
 * - The RS is extremely powerful and must be treated as a secret
 * - RS should only be displayed during initial setup or from settings
 * - Users must be clearly instructed to save the QR securely
 * - The RS should never be transmitted to any server
 * - Clear the RS from memory as soon as possible after display
 *
 * @module components/RecoveryQRDisplay
 *
 * @example
 * ```tsx
 * import { RecoveryQRDisplay } from '@/components/RecoveryQRDisplay';
 *
 * // During first-time setup:
 * <RecoveryQRDisplay
 *   recoverySecret={recoverySecret}
 *   userId={userId}
 *   onConfirm={() => proceedToApp()}
 *   onSkip={() => showReminder()}
 * />
 *
 * // In settings (for re-viewing):
 * <RecoveryQRDisplay
 *   recoverySecret={recoverySecret}
 *   userId={userId}
 *   mode="settings"
 *   onClose={() => closeDialog()}
 * />
 * ```
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ChangeEvent,
} from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { RecoverySecret } from '../crypto/keys';
import {
  prepareRecoveryQRData,
  createRecoveryExportSession,
  confirmRecoveryExported,
  clearExportSession,
  getRecoveryExportStatus,
  recordRecoveryViewed,
  formatRecoveryForTextBackup,
  clearRecoverySecret,
  getRecoveryDisplayOptions,
  type RecoveryQRData,
  type RecoveryExportSession,
  type RecoveryDisplayOptions,
} from '../auth/recovery';

// ============================================================================
// Types
// ============================================================================

/**
 * Display mode for the component
 */
export type RecoveryDisplayMode = 'setup' | 'settings' | 'reminder';

/**
 * Confirmation checkbox state
 */
interface ConfirmationState {
  saved: boolean;
  understand: boolean;
}

/**
 * Props for RecoveryQRDisplay component
 */
export interface RecoveryQRDisplayProps {
  /** The recovery secret to display (32 bytes) */
  recoverySecret: RecoverySecret;
  /** User ID for tracking export status */
  userId: string;
  /** Display mode (default: 'setup') */
  mode?: RecoveryDisplayMode;
  /** Callback when user confirms they've saved the recovery code */
  onConfirm?: () => void;
  /** Callback when user skips (setup mode only) */
  onSkip?: () => void;
  /** Callback to close the dialog (settings/reminder mode) */
  onClose?: () => void;
  /** Whether to show text backup option (default: true) */
  showTextBackup?: boolean;
  /** Whether to show print option (default: false for mobile-first) */
  showPrintOption?: boolean;
  /** Custom class name for styling */
  className?: string;
  /** QR code size in pixels (default: 256) */
  qrSize?: number;
  /** App name for display (default: 'TrichoApp') */
  appName?: string;
}

// ============================================================================
// Helper Components
// ============================================================================

/**
 * Shield/Security icon SVG
 */
function ShieldIcon({ size = 24 }: { size?: number }) {
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
      className="recovery-icon recovery-icon--shield"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

/**
 * Warning/Alert icon SVG
 */
function WarningIcon({ size = 24 }: { size?: number }) {
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
      className="recovery-icon recovery-icon--warning"
      aria-hidden="true"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/**
 * Copy icon SVG
 */
function CopyIcon({ size = 16 }: { size?: number }) {
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
      className="recovery-icon recovery-icon--copy"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/**
 * Check icon SVG
 */
function CheckIcon({ size = 16 }: { size?: number }) {
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
      className="recovery-icon recovery-icon--check"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * Download icon SVG
 */
function DownloadIcon({ size = 16 }: { size?: number }) {
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
      className="recovery-icon recovery-icon--download"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/**
 * Eye/Show icon SVG
 */
function EyeIcon({ size = 16 }: { size?: number }) {
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
      className="recovery-icon recovery-icon--eye"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/**
 * Eye-off/Hide icon SVG
 */
function EyeOffIcon({ size = 16 }: { size?: number }) {
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
      className="recovery-icon recovery-icon--eye-off"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

/**
 * Security warning banner
 */
function SecurityWarning() {
  return (
    <div className="recovery-warning" role="alert">
      <WarningIcon size={20} />
      <div className="recovery-warning-content">
        <strong>Important Security Information</strong>
        <p>
          This recovery code is the <em>only way</em> to recover your account if you
          lose access to your passkey. Store it somewhere safe and private.
        </p>
      </div>
    </div>
  );
}

/**
 * Instructions for saving the recovery code
 */
function SaveInstructions({ mode }: { mode: RecoveryDisplayMode }) {
  return (
    <div className="recovery-instructions">
      <h3 className="recovery-instructions-title">How to save your recovery code:</h3>
      <ul className="recovery-instructions-list">
        <li>
          <strong>Screenshot</strong> - Take a screenshot and store it in a secure
          photo vault or password manager
        </li>
        <li>
          <strong>Print</strong> - Print this page and store it in a safe place
          (like a safety deposit box)
        </li>
        <li>
          <strong>Write it down</strong> - Copy the text backup code and keep it
          with important documents
        </li>
      </ul>
      {mode === 'setup' && (
        <p className="recovery-instructions-note">
          <ShieldIcon size={16} />
          <span>
            You won't be able to see this code again after proceeding. Make sure you've
            saved it before continuing.
          </span>
        </p>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Recovery QR Display Component
 *
 * Displays the recovery secret as a QR code and provides options
 * for users to save their recovery information.
 */
export function RecoveryQRDisplay({
  recoverySecret,
  userId,
  mode = 'setup',
  onConfirm,
  onSkip,
  onClose,
  showTextBackup = true,
  showPrintOption = false,
  className = '',
  qrSize,
  appName = 'TrichoApp',
}: RecoveryQRDisplayProps) {
  // ========================================================================
  // State
  // ========================================================================

  const [qrData, setQrData] = useState<RecoveryQRData | null>(null);
  const [textBackup, setTextBackup] = useState<string>('');
  const [showTextCode, setShowTextCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [session, setSession] = useState<RecoveryExportSession | null>(null);
  const [displayOptions, setDisplayOptions] = useState<RecoveryDisplayOptions | null>(null);
  const [confirmations, setConfirmations] = useState<ConfirmationState>({
    saved: false,
    understand: false,
  });
  const [error, setError] = useState<string | null>(null);

  // Refs
  const qrContainerRef = useRef<HTMLDivElement>(null);

  // ========================================================================
  // Initialization
  // ========================================================================

  useEffect(() => {
    try {
      // Prepare QR data
      const data = prepareRecoveryQRData(recoverySecret);
      setQrData(data);

      // Prepare text backup
      const formatted = formatRecoveryForTextBackup(recoverySecret);
      setTextBackup(formatted);

      // Get display options
      const options = getRecoveryDisplayOptions();
      setDisplayOptions(options);

      // Create export session
      const exportSession = createRecoveryExportSession(userId);
      setSession(exportSession);

      // Record that recovery was viewed (for audit)
      recordRecoveryViewed(userId);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to prepare recovery code'
      );
    }
  }, [recoverySecret, userId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear session on unmount
      clearExportSession();
    };
  }, []);

  // ========================================================================
  // Computed Values
  // ========================================================================

  const actualQrSize = qrSize ?? displayOptions?.recommendedSize ?? 256;

  const canConfirm = useMemo(() => {
    if (mode === 'settings' || mode === 'reminder') {
      return true;
    }
    return confirmations.saved && confirmations.understand;
  }, [mode, confirmations]);

  const previouslyExported = useMemo(() => {
    const status = getRecoveryExportStatus(userId);
    return status?.exported ?? false;
  }, [userId]);

  // ========================================================================
  // Event Handlers
  // ========================================================================

  const handleConfirmationChange = useCallback(
    (field: keyof ConfirmationState) => (e: ChangeEvent<HTMLInputElement>) => {
      setConfirmations((prev) => ({
        ...prev,
        [field]: e.target.checked,
      }));
    },
    []
  );

  const handleCopyText = useCallback(async () => {
    if (!textBackup) {
      return;
    }

    try {
      await navigator.clipboard.writeText(textBackup);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback for older browsers or when clipboard API fails
      const textarea = document.createElement('textarea');
      textarea.value = textBackup;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setError('Failed to copy to clipboard. Please select and copy manually.');
      }
      document.body.removeChild(textarea);
    }
  }, [textBackup]);

  const handleToggleTextCode = useCallback(() => {
    setShowTextCode((prev) => !prev);
  }, []);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleDownloadQR = useCallback(() => {
    if (!qrContainerRef.current) {
      return;
    }

    const svg = qrContainerRef.current.querySelector('svg');
    if (!svg) {
      return;
    }

    // Create a canvas to convert SVG to PNG
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const svgData = new XMLSerializer().serializeToString(svg);
    const img = new Image();

    img.onload = () => {
      canvas.width = actualQrSize * 2; // 2x for retina
      canvas.height = actualQrSize * 2;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Download
      const link = document.createElement('a');
      link.download = `${appName.toLowerCase()}-recovery-qr.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
  }, [actualQrSize, appName]);

  const handleConfirm = useCallback(() => {
    if (!session) {
      return;
    }

    try {
      // Confirm the export
      confirmRecoveryExported(session.sessionId, userId);

      // Clear recovery secret from memory
      clearRecoverySecret(recoverySecret);

      // Call callback
      onConfirm?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to confirm recovery export'
      );
    }
  }, [session, userId, recoverySecret, onConfirm]);

  const handleSkip = useCallback(() => {
    // Clear session but don't mark as confirmed
    clearExportSession();

    // Clear recovery secret from memory
    clearRecoverySecret(recoverySecret);

    onSkip?.();
  }, [recoverySecret, onSkip]);

  const handleClose = useCallback(() => {
    // Clear session
    clearExportSession();

    onClose?.();
  }, [onClose]);

  // ========================================================================
  // Render
  // ========================================================================

  if (error) {
    return (
      <div className={`recovery-display recovery-display--error ${className}`}>
        <div className="recovery-error" role="alert">
          <WarningIcon size={32} />
          <p>{error}</p>
          {onClose && (
            <button
              type="button"
              className="recovery-button recovery-button--secondary"
              onClick={onClose}
            >
              Close
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!qrData) {
    return (
      <div className={`recovery-display recovery-display--loading ${className}`}>
        <div className="recovery-loading">
          <p>Preparing recovery code...</p>
        </div>
      </div>
    );
  }

  const containerClasses = [
    'recovery-display',
    `recovery-display--${mode}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClasses}>
      {/* Header */}
      <header className="recovery-header">
        <ShieldIcon size={48} />
        <h2 className="recovery-title">
          {mode === 'setup'
            ? 'Save Your Recovery Code'
            : 'Your Recovery Code'}
        </h2>
        <p className="recovery-subtitle">
          {mode === 'setup'
            ? "This is the only way to recover your account if you lose your passkey."
            : 'Use this code to recover your account on a new device.'}
        </p>
      </header>

      {/* Security Warning */}
      {mode === 'setup' && <SecurityWarning />}

      {/* QR Code */}
      <div className="recovery-qr-section">
        <div
          ref={qrContainerRef}
          className="recovery-qr-container"
          aria-label="Recovery QR Code"
        >
          <QRCodeSVG
            value={qrData.uri}
            size={actualQrSize}
            level={displayOptions?.errorCorrectionLevel ?? 'M'}
            includeMargin
            className="recovery-qr-code"
          />
        </div>

        {/* QR Actions */}
        <div className="recovery-qr-actions">
          <button
            type="button"
            className="recovery-button recovery-button--icon"
            onClick={handleDownloadQR}
            title="Download QR code as image"
            aria-label="Download QR code as image"
          >
            <DownloadIcon size={16} />
            <span>Download</span>
          </button>
          {showPrintOption && (
            <button
              type="button"
              className="recovery-button recovery-button--icon"
              onClick={handlePrint}
              title="Print this page"
              aria-label="Print this page"
            >
              <span>Print</span>
            </button>
          )}
        </div>
      </div>

      {/* Text Backup Option */}
      {showTextBackup && (
        <div className="recovery-text-section">
          <button
            type="button"
            className="recovery-text-toggle"
            onClick={handleToggleTextCode}
            aria-expanded={showTextCode}
            aria-controls="recovery-text-backup"
          >
            {showTextCode ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
            <span>
              {showTextCode ? 'Hide text backup' : 'Show text backup'}
            </span>
          </button>

          {showTextCode && (
            <div
              id="recovery-text-backup"
              className="recovery-text-container"
            >
              <code className="recovery-text-code">{textBackup}</code>
              <button
                type="button"
                className="recovery-button recovery-button--copy"
                onClick={handleCopyText}
                aria-label={copied ? 'Copied!' : 'Copy to clipboard'}
              >
                {copied ? (
                  <>
                    <CheckIcon size={16} />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <CopyIcon size={16} />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Instructions (setup mode) */}
      {mode === 'setup' && <SaveInstructions mode={mode} />}

      {/* Confirmation Checkboxes (setup mode only) */}
      {mode === 'setup' && (
        <div className="recovery-confirmations">
          <label className="recovery-checkbox">
            <input
              type="checkbox"
              checked={confirmations.saved}
              onChange={handleConfirmationChange('saved')}
              aria-describedby="confirmation-saved-desc"
            />
            <span className="recovery-checkbox-label">
              I have saved my recovery code in a safe place
            </span>
          </label>
          <label className="recovery-checkbox">
            <input
              type="checkbox"
              checked={confirmations.understand}
              onChange={handleConfirmationChange('understand')}
              aria-describedby="confirmation-understand-desc"
            />
            <span className="recovery-checkbox-label">
              I understand that without this code, I cannot recover my account
            </span>
          </label>
        </div>
      )}

      {/* Action Buttons */}
      <div className="recovery-actions">
        {mode === 'setup' && (
          <>
            <button
              type="button"
              className="recovery-button recovery-button--primary"
              onClick={handleConfirm}
              disabled={!canConfirm}
            >
              Continue
            </button>
            {onSkip && (
              <button
                type="button"
                className="recovery-button recovery-button--text"
                onClick={handleSkip}
              >
                Skip for now (not recommended)
              </button>
            )}
          </>
        )}

        {(mode === 'settings' || mode === 'reminder') && (
          <button
            type="button"
            className="recovery-button recovery-button--primary"
            onClick={handleClose}
          >
            Done
          </button>
        )}
      </div>

      {/* Previously exported notice */}
      {mode === 'settings' && previouslyExported && (
        <p className="recovery-note">
          You have previously saved your recovery code on{' '}
          {new Date(
            getRecoveryExportStatus(userId)?.exportedAt ?? Date.now()
          ).toLocaleDateString()}
          .
        </p>
      )}
    </div>
  );
}

// ============================================================================
// Convenience Components
// ============================================================================

/**
 * Compact recovery reminder badge.
 * Shows in the app if user hasn't saved their recovery code.
 *
 * @example
 * ```tsx
 * // In your app header or settings:
 * {!hasExportedRecovery && <RecoveryReminderBadge onClick={showRecoveryModal} />}
 * ```
 */
export interface RecoveryReminderBadgeProps {
  /** User ID to check export status */
  userId: string;
  /** Callback when badge is clicked */
  onClick?: () => void;
  /** Custom class name */
  className?: string;
}

export function RecoveryReminderBadge({
  userId,
  onClick,
  className = '',
}: RecoveryReminderBadgeProps) {
  const [hasExported, setHasExported] = useState<boolean | null>(null);

  useEffect(() => {
    const status = getRecoveryExportStatus(userId);
    setHasExported(status?.exported ?? false);
  }, [userId]);

  // Don't render if already exported or still loading
  if (hasExported === null || hasExported) {
    return null;
  }

  return (
    <button
      type="button"
      className={`recovery-reminder-badge ${className}`}
      onClick={onClick}
      aria-label="Save your recovery code"
    >
      <WarningIcon size={16} />
      <span>Save recovery code</span>
    </button>
  );
}

/**
 * Recovery status indicator for settings pages.
 *
 * @example
 * ```tsx
 * <RecoveryStatusIndicator userId={userId} />
 * ```
 */
export interface RecoveryStatusIndicatorProps {
  /** User ID to check export status */
  userId: string;
  /** Callback to show recovery QR */
  onViewRecovery?: () => void;
  /** Custom class name */
  className?: string;
}

export function RecoveryStatusIndicator({
  userId,
  onViewRecovery,
  className = '',
}: RecoveryStatusIndicatorProps) {
  const [hasExported, setHasExported] = useState<boolean | null>(null);
  const [exportDate, setExportDate] = useState<Date | null>(null);

  useEffect(() => {
    const status = getRecoveryExportStatus(userId);
    setHasExported(status?.exported ?? false);
    if (status?.exportedAt) {
      setExportDate(new Date(status.exportedAt));
    }
  }, [userId]);

  if (hasExported === null) {
    return null;
  }

  return (
    <div className={`recovery-status ${className}`}>
      <div className="recovery-status-header">
        <ShieldIcon size={20} />
        <span className="recovery-status-title">Recovery Code</span>
      </div>
      <div className="recovery-status-content">
        {hasExported ? (
          <p className="recovery-status-saved">
            <CheckIcon size={16} />
            <span>
              Saved on {exportDate?.toLocaleDateString() ?? 'unknown date'}
            </span>
          </p>
        ) : (
          <p className="recovery-status-unsaved">
            <WarningIcon size={16} />
            <span>Not saved - your account cannot be recovered without it!</span>
          </p>
        )}
        {onViewRecovery && (
          <button
            type="button"
            className="recovery-button recovery-button--text"
            onClick={onViewRecovery}
          >
            {hasExported ? 'View recovery code' : 'Save recovery code'}
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export default RecoveryQRDisplay;
