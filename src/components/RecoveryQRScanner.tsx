/**
 * Recovery QR Scanner Component
 *
 * Provides QR code scanning functionality for account recovery.
 * Uses the html5-qrcode library to scan recovery QR codes and
 * initiates the recovery flow to restore access to encrypted data.
 *
 * SECURITY CONSIDERATIONS:
 * - The scanned recovery secret is extremely powerful
 * - Clear the secret from memory as soon as possible after use
 * - Only proceed with recovery after validating the QR format
 * - Provide clear feedback about what will happen during recovery
 *
 * @module components/RecoveryQRScanner
 *
 * @example
 * ```tsx
 * import { RecoveryQRScanner } from '@/components/RecoveryQRScanner';
 *
 * // In your recovery flow:
 * <RecoveryQRScanner
 *   onScanSuccess={(result) => {
 *     // result contains recoverySecret and derived keys
 *     completeRecoveryFlow(result);
 *   }}
 *   onCancel={() => navigateBack()}
 * />
 *
 * // With manual entry option:
 * <RecoveryQRScanner
 *   allowManualEntry
 *   onScanSuccess={handleRecovery}
 *   onCancel={handleCancel}
 * />
 * ```
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ChangeEvent,
} from 'react';
import {
  createRecoveryImportSession,
  importFromRecoveryQR,
  validateRecoveryQRData,
  parseTextBackup,
  clearImportSession,
  clearRecoverySecret,
  isValidRecoveryQRFormat,
  type RecoveryImportResult,
  type RecoveryImportSession,
  type RecoveryImportStep,
  RecoveryParseError,
  RecoveryImportError,
} from '../auth/recovery';

// ============================================================================
// Types
// ============================================================================

/**
 * Scanner status states
 */
export type ScannerStatus =
  | 'initializing'
  | 'ready'
  | 'scanning'
  | 'processing'
  | 'success'
  | 'error'
  | 'camera_denied'
  | 'camera_unavailable';

/**
 * Camera facing mode
 */
export type CameraFacingMode = 'environment' | 'user';

/**
 * Props for RecoveryQRScanner component
 */
export interface RecoveryQRScannerProps {
  /** Callback when QR is successfully scanned and processed */
  onScanSuccess: (result: RecoveryImportResult) => void;
  /** Callback when user cancels the scan */
  onCancel?: () => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
  /** Whether to show manual text entry option (default: true) */
  allowManualEntry?: boolean;
  /** Whether to auto-start the camera (default: true) */
  autoStart?: boolean;
  /** Preferred camera facing mode (default: 'environment') */
  preferredCamera?: CameraFacingMode;
  /** Custom class name for styling */
  className?: string;
  /** App name for display (default: 'TrichoApp') */
  appName?: string;
}

/**
 * Internal scanner state
 */
interface ScannerState {
  status: ScannerStatus;
  error: string | null;
  importSession: RecoveryImportSession | null;
  hasMultipleCameras: boolean;
  currentCamera: CameraFacingMode;
}

// ============================================================================
// Helper Components
// ============================================================================

/**
 * Camera icon SVG
 */
function CameraIcon({ size = 24 }: { size?: number }) {
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
      className="scanner-icon scanner-icon--camera"
      aria-hidden="true"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

/**
 * QR Code icon SVG
 */
function QRCodeIcon({ size = 24 }: { size?: number }) {
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
      className="scanner-icon scanner-icon--qrcode"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="3" height="3" />
      <rect x="18" y="14" width="3" height="3" />
      <rect x="14" y="18" width="3" height="3" />
      <rect x="18" y="18" width="3" height="3" />
    </svg>
  );
}

/**
 * Flip camera icon SVG
 */
function FlipCameraIcon({ size = 20 }: { size?: number }) {
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
      className="scanner-icon scanner-icon--flip"
      aria-hidden="true"
    >
      <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
      <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
      <circle cx="12" cy="12" r="3" />
      <path d="m18 22-3-3 3-3" />
      <path d="m6 2 3 3-3 3" />
    </svg>
  );
}

/**
 * Close/X icon SVG
 */
function CloseIcon({ size = 24 }: { size?: number }) {
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
      className="scanner-icon scanner-icon--close"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/**
 * Check/Success icon SVG
 */
function CheckIcon({ size = 24 }: { size?: number }) {
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
      className="scanner-icon scanner-icon--check"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * Warning icon SVG
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
      className="scanner-icon scanner-icon--warning"
      aria-hidden="true"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/**
 * Keyboard/Text icon SVG
 */
function KeyboardIcon({ size = 20 }: { size?: number }) {
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
      className="scanner-icon scanner-icon--keyboard"
      aria-hidden="true"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
      <line x1="6" y1="8" x2="6.01" y2="8" />
      <line x1="10" y1="8" x2="10.01" y2="8" />
      <line x1="14" y1="8" x2="14.01" y2="8" />
      <line x1="18" y1="8" x2="18.01" y2="8" />
      <line x1="8" y1="12" x2="8.01" y2="12" />
      <line x1="12" y1="12" x2="12.01" y2="12" />
      <line x1="16" y1="12" x2="16.01" y2="12" />
      <line x1="7" y1="16" x2="17" y2="16" />
    </svg>
  );
}

/**
 * Spinner component for loading states
 */
function Spinner() {
  return (
    <div className="scanner-spinner" aria-hidden="true">
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="scanner-spinner-icon"
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    </div>
  );
}

/**
 * Scanner frame overlay (viewfinder corners)
 */
function ScannerFrame() {
  return (
    <div className="scanner-frame" aria-hidden="true">
      <div className="scanner-frame-corner scanner-frame-corner--tl" />
      <div className="scanner-frame-corner scanner-frame-corner--tr" />
      <div className="scanner-frame-corner scanner-frame-corner--bl" />
      <div className="scanner-frame-corner scanner-frame-corner--br" />
      <div className="scanner-frame-hint">
        Position the QR code within the frame
      </div>
    </div>
  );
}

/**
 * Camera permission denied message
 */
function CameraPermissionDenied({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="scanner-permission-denied" role="alert">
      <CameraIcon size={48} />
      <h3>Camera Access Required</h3>
      <p>
        To scan your recovery QR code, please allow camera access in your
        browser settings.
      </p>
      <button
        type="button"
        className="scanner-button scanner-button--primary"
        onClick={onRetry}
      >
        Try Again
      </button>
    </div>
  );
}

/**
 * Camera unavailable message
 */
function CameraUnavailable({ onManualEntry }: { onManualEntry?: () => void }) {
  return (
    <div className="scanner-unavailable" role="alert">
      <CameraIcon size={48} />
      <h3>Camera Unavailable</h3>
      <p>
        Your device doesn't have a camera or it's not accessible. You can enter
        your recovery code manually instead.
      </p>
      {onManualEntry && (
        <button
          type="button"
          className="scanner-button scanner-button--primary"
          onClick={onManualEntry}
        >
          <KeyboardIcon size={16} />
          <span>Enter Code Manually</span>
        </button>
      )}
    </div>
  );
}

/**
 * Manual entry form
 */
function ManualEntryForm({
  onSubmit,
  onCancel,
  isProcessing,
  error,
}: {
  onSubmit: (code: string) => void;
  onCancel: () => void;
  isProcessing: boolean;
  error: string | null;
}) {
  const [code, setCode] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Focus input on mount
    inputRef.current?.focus();
  }, []);

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setCode(e.target.value);
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = code.trim();
      if (trimmed) {
        onSubmit(trimmed);
      }
    },
    [code, onSubmit]
  );

  const isValid = code.trim().length >= 40; // Minimum base64url length for 32 bytes

  return (
    <form className="scanner-manual-form" onSubmit={handleSubmit}>
      <div className="scanner-manual-header">
        <KeyboardIcon size={32} />
        <h3>Enter Recovery Code</h3>
        <p>
          Enter the recovery code from your backup. The code should look like a
          long string of letters and numbers.
        </p>
      </div>

      <div className="scanner-manual-input-wrapper">
        <textarea
          ref={inputRef}
          className="scanner-manual-input"
          value={code}
          onChange={handleChange}
          placeholder="Paste or type your recovery code here..."
          rows={4}
          disabled={isProcessing}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label="Recovery code"
          aria-describedby={error ? 'manual-entry-error' : undefined}
        />
      </div>

      {error && (
        <div id="manual-entry-error" className="scanner-manual-error" role="alert">
          <WarningIcon size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="scanner-manual-actions">
        <button
          type="button"
          className="scanner-button scanner-button--secondary"
          onClick={onCancel}
          disabled={isProcessing}
        >
          Back to Scanner
        </button>
        <button
          type="submit"
          className="scanner-button scanner-button--primary"
          disabled={!isValid || isProcessing}
        >
          {isProcessing ? (
            <>
              <Spinner />
              <span>Verifying...</span>
            </>
          ) : (
            <span>Verify Code</span>
          )}
        </button>
      </div>
    </form>
  );
}

/**
 * Processing overlay
 */
function ProcessingOverlay({ step }: { step: RecoveryImportStep }) {
  const getMessage = () => {
    switch (step) {
      case 'validating':
        return 'Validating recovery code...';
      case 'deriving_keys':
        return 'Deriving encryption keys...';
      case 'completed':
        return 'Recovery successful!';
      default:
        return 'Processing...';
    }
  };

  return (
    <div className="scanner-processing" role="status" aria-live="polite">
      {step === 'completed' ? (
        <CheckIcon size={48} />
      ) : (
        <Spinner />
      )}
      <p>{getMessage()}</p>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Recovery QR Scanner Component
 *
 * Provides camera-based QR code scanning for account recovery,
 * with fallback to manual text entry.
 */
export function RecoveryQRScanner({
  onScanSuccess,
  onCancel,
  onError,
  allowManualEntry = true,
  autoStart = true,
  preferredCamera = 'environment',
  className = '',
  appName = 'TrichoApp',
}: RecoveryQRScannerProps) {
  // ========================================================================
  // State
  // ========================================================================

  const [state, setState] = useState<ScannerState>({
    status: 'initializing',
    error: null,
    importSession: null,
    hasMultipleCameras: false,
    currentCamera: preferredCamera,
  });

  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [importStep, setImportStep] = useState<RecoveryImportStep>('awaiting_scan');

  // Refs
  const scannerRef = useRef<HTMLDivElement>(null);
  const html5QrCodeRef = useRef<any>(null);
  const isInitializedRef = useRef(false);
  const isMountedRef = useRef(true);

  // Scanner element ID
  const scannerId = useMemo(() => `recovery-qr-scanner-${Date.now()}`, []);

  // ========================================================================
  // Scanner Setup
  // ========================================================================

  /**
   * Initialize the QR scanner
   */
  const initializeScanner = useCallback(async () => {
    // Prevent double initialization
    if (isInitializedRef.current || !isMountedRef.current) {
      return;
    }

    try {
      setState((s) => ({ ...s, status: 'initializing', error: null }));

      // Dynamically import html5-qrcode to avoid SSR issues
      const { Html5Qrcode } = await import('html5-qrcode');

      // Check for multiple cameras
      let hasMultipleCameras = false;
      try {
        const devices = await Html5Qrcode.getCameras();
        hasMultipleCameras = devices.length > 1;
      } catch {
        // Cameras not enumerable, continue with single camera assumption
      }

      if (!isMountedRef.current) {
        return;
      }

      // Create scanner instance
      const scanner = new Html5Qrcode(scannerId, { verbose: false });
      html5QrCodeRef.current = scanner;

      // Create import session
      const session = createRecoveryImportSession();

      setState((s) => ({
        ...s,
        status: 'ready',
        importSession: session,
        hasMultipleCameras,
      }));

      isInitializedRef.current = true;

      // Auto-start if configured
      if (autoStart) {
        await startScanning(scanner, preferredCamera);
      }
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      const errorMessage = error instanceof Error ? error.message : 'Failed to initialize scanner';
      setState((s) => ({ ...s, status: 'error', error: errorMessage }));
      onError?.(error instanceof Error ? error : new Error(errorMessage));
    }
  }, [scannerId, autoStart, preferredCamera, onError]);

  /**
   * Start the camera and begin scanning
   */
  const startScanning = useCallback(
    async (scanner?: any, facingMode?: CameraFacingMode) => {
      const qrScanner = scanner || html5QrCodeRef.current;
      if (!qrScanner || !isMountedRef.current) {
        return;
      }

      const camera = facingMode || state.currentCamera;

      try {
        setState((s) => ({ ...s, status: 'scanning', currentCamera: camera }));

        await qrScanner.start(
          { facingMode: camera },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
          },
          handleScanSuccess,
          () => {} // Ignore scan failures (expected during scanning)
        );
      } catch (error) {
        if (!isMountedRef.current) {
          return;
        }

        const errorMessage = error instanceof Error ? error.message : 'Camera access failed';

        // Check for permission denied
        if (
          errorMessage.includes('Permission') ||
          errorMessage.includes('denied') ||
          errorMessage.includes('NotAllowedError')
        ) {
          setState((s) => ({ ...s, status: 'camera_denied', error: errorMessage }));
        } else if (
          errorMessage.includes('NotFoundError') ||
          errorMessage.includes('No camera')
        ) {
          setState((s) => ({ ...s, status: 'camera_unavailable', error: errorMessage }));
        } else {
          setState((s) => ({ ...s, status: 'error', error: errorMessage }));
        }

        onError?.(error instanceof Error ? error : new Error(errorMessage));
      }
    },
    [state.currentCamera, onError]
  );

  /**
   * Stop the scanner
   */
  const stopScanning = useCallback(async () => {
    const scanner = html5QrCodeRef.current;
    if (!scanner) {
      return;
    }

    try {
      const scannerState = scanner.getState();
      if (scannerState === 2) {
        // 2 = SCANNING
        await scanner.stop();
      }
    } catch {
      // Ignore errors when stopping
    }
  }, []);

  /**
   * Handle successful QR scan
   */
  const handleScanSuccess = useCallback(
    async (decodedText: string) => {
      // Stop scanning immediately to prevent duplicate processing
      await stopScanning();

      if (!isMountedRef.current) {
        return;
      }

      // Validate format before processing
      const validation = validateRecoveryQRData(decodedText);
      if (!validation.isValid) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: validation.error || 'Invalid QR code format',
        }));
        return;
      }

      // Process the scanned data
      await processRecoveryData(decodedText);
    },
    [stopScanning]
  );

  /**
   * Process recovery data (from scan or manual entry)
   */
  const processRecoveryData = useCallback(
    async (data: string) => {
      if (!isMountedRef.current) {
        return;
      }

      setState((s) => ({ ...s, status: 'processing', error: null }));
      setImportStep('validating');

      try {
        // Import and derive keys
        const result = await importFromRecoveryQR(data);

        if (!isMountedRef.current) {
          // Clean up if unmounted during processing
          clearRecoverySecret(result.recoverySecret);
          return;
        }

        setImportStep('completed');
        setState((s) => ({ ...s, status: 'success' }));

        // Short delay to show success state before calling callback
        setTimeout(() => {
          if (isMountedRef.current) {
            onScanSuccess(result);
          }
        }, 500);
      } catch (error) {
        if (!isMountedRef.current) {
          return;
        }

        setImportStep('failed');

        let errorMessage = 'Failed to process recovery code';
        if (error instanceof RecoveryParseError) {
          errorMessage = error.message;
        } else if (error instanceof RecoveryImportError) {
          errorMessage = error.message;
        } else if (error instanceof Error) {
          errorMessage = error.message;
        }

        setState((s) => ({
          ...s,
          status: 'error',
          error: errorMessage,
        }));

        onError?.(error instanceof Error ? error : new Error(errorMessage));
      }
    },
    [onScanSuccess, onError]
  );

  // ========================================================================
  // Event Handlers
  // ========================================================================

  /**
   * Handle flip camera button
   */
  const handleFlipCamera = useCallback(async () => {
    const newCamera: CameraFacingMode =
      state.currentCamera === 'environment' ? 'user' : 'environment';

    await stopScanning();
    await startScanning(undefined, newCamera);
  }, [state.currentCamera, stopScanning, startScanning]);

  /**
   * Handle retry after permission denied
   */
  const handleRetryPermission = useCallback(async () => {
    setState((s) => ({ ...s, status: 'initializing', error: null }));

    // Reset initialization flag to allow re-init
    isInitializedRef.current = false;

    // Re-initialize scanner
    await initializeScanner();
  }, [initializeScanner]);

  /**
   * Handle retry after error
   */
  const handleRetry = useCallback(async () => {
    setState((s) => ({ ...s, status: 'ready', error: null }));
    await startScanning();
  }, [startScanning]);

  /**
   * Handle switch to manual entry
   */
  const handleSwitchToManual = useCallback(async () => {
    await stopScanning();
    setShowManualEntry(true);
    setManualError(null);
  }, [stopScanning]);

  /**
   * Handle switch back to scanner
   */
  const handleSwitchToScanner = useCallback(async () => {
    setShowManualEntry(false);
    setManualError(null);
    await startScanning();
  }, [startScanning]);

  /**
   * Handle manual code submission
   */
  const handleManualSubmit = useCallback(
    async (code: string) => {
      // Try to parse as text backup first (with spaces)
      // then as direct QR data
      let processedCode = code;

      // Remove any whitespace formatting
      const cleanCode = code.replace(/\s+/g, '');

      // Check if it's a tricho:// URI or plain base64url
      if (isValidRecoveryQRFormat(code)) {
        processedCode = code;
      } else if (isValidRecoveryQRFormat(cleanCode)) {
        processedCode = cleanCode;
      } else if (isValidRecoveryQRFormat(`tricho://recover/${cleanCode}`)) {
        processedCode = `tricho://recover/${cleanCode}`;
      } else {
        // Try parsing as text backup
        try {
          const secret = parseTextBackup(code);
          // Re-encode for processing
          const { base64urlEncode } = await import('../crypto/utils');
          processedCode = `tricho://recover/${base64urlEncode(secret)}`;
        } catch {
          setManualError('Invalid recovery code format. Please check and try again.');
          return;
        }
      }

      await processRecoveryData(processedCode);
    },
    [processRecoveryData]
  );

  /**
   * Handle cancel
   */
  const handleCancel = useCallback(async () => {
    await stopScanning();
    clearImportSession();
    onCancel?.();
  }, [stopScanning, onCancel]);

  // ========================================================================
  // Effects
  // ========================================================================

  // Initialize scanner on mount
  useEffect(() => {
    isMountedRef.current = true;
    initializeScanner();

    return () => {
      isMountedRef.current = false;
      stopScanning();
      clearImportSession();

      // Clean up scanner instance
      if (html5QrCodeRef.current) {
        try {
          html5QrCodeRef.current.clear();
        } catch {
          // Ignore cleanup errors
        }
        html5QrCodeRef.current = null;
      }

      isInitializedRef.current = false;
    };
  }, [initializeScanner, stopScanning]);

  // ========================================================================
  // Render
  // ========================================================================

  const containerClasses = [
    'recovery-scanner',
    `recovery-scanner--${state.status}`,
    showManualEntry ? 'recovery-scanner--manual' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  // Render manual entry form
  if (showManualEntry) {
    return (
      <div className={containerClasses}>
        <ManualEntryForm
          onSubmit={handleManualSubmit}
          onCancel={handleSwitchToScanner}
          isProcessing={state.status === 'processing'}
          error={manualError || (state.status === 'error' ? state.error : null)}
        />
      </div>
    );
  }

  // Render camera permission denied
  if (state.status === 'camera_denied') {
    return (
      <div className={containerClasses}>
        <CameraPermissionDenied onRetry={handleRetryPermission} />
        {allowManualEntry && (
          <div className="scanner-manual-option">
            <span>or</span>
            <button
              type="button"
              className="scanner-button scanner-button--text"
              onClick={handleSwitchToManual}
            >
              <KeyboardIcon size={16} />
              <span>Enter code manually</span>
            </button>
          </div>
        )}
        {onCancel && (
          <button
            type="button"
            className="scanner-cancel-button"
            onClick={handleCancel}
            aria-label="Cancel recovery"
          >
            <CloseIcon size={20} />
          </button>
        )}
      </div>
    );
  }

  // Render camera unavailable
  if (state.status === 'camera_unavailable') {
    return (
      <div className={containerClasses}>
        <CameraUnavailable
          onManualEntry={allowManualEntry ? handleSwitchToManual : undefined}
        />
        {onCancel && (
          <button
            type="button"
            className="scanner-cancel-button"
            onClick={handleCancel}
            aria-label="Cancel recovery"
          >
            <CloseIcon size={20} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      {/* Header */}
      <header className="scanner-header">
        <QRCodeIcon size={32} />
        <h2 className="scanner-title">Scan Recovery Code</h2>
        <p className="scanner-subtitle">
          Point your camera at the recovery QR code to restore your {appName} account.
        </p>
      </header>

      {/* Scanner viewport */}
      <div className="scanner-viewport-container">
        <div
          ref={scannerRef}
          id={scannerId}
          className="scanner-viewport"
        />

        {/* Overlay states */}
        {state.status === 'scanning' && <ScannerFrame />}

        {state.status === 'initializing' && (
          <div className="scanner-initializing">
            <Spinner />
            <p>Starting camera...</p>
          </div>
        )}

        {state.status === 'processing' && (
          <ProcessingOverlay step={importStep} />
        )}

        {state.status === 'success' && (
          <ProcessingOverlay step="completed" />
        )}

        {state.status === 'error' && state.error && (
          <div className="scanner-error-overlay" role="alert">
            <WarningIcon size={32} />
            <p>{state.error}</p>
            <button
              type="button"
              className="scanner-button scanner-button--primary"
              onClick={handleRetry}
            >
              Try Again
            </button>
          </div>
        )}
      </div>

      {/* Controls */}
      {state.status === 'scanning' && (
        <div className="scanner-controls">
          {state.hasMultipleCameras && (
            <button
              type="button"
              className="scanner-button scanner-button--icon"
              onClick={handleFlipCamera}
              aria-label="Switch camera"
              title="Switch camera"
            >
              <FlipCameraIcon />
            </button>
          )}
        </div>
      )}

      {/* Manual entry option */}
      {allowManualEntry && state.status !== 'processing' && state.status !== 'success' && (
        <div className="scanner-manual-option">
          <span>Can't scan?</span>
          <button
            type="button"
            className="scanner-button scanner-button--text"
            onClick={handleSwitchToManual}
          >
            <KeyboardIcon size={16} />
            <span>Enter code manually</span>
          </button>
        </div>
      )}

      {/* Cancel button */}
      {onCancel && state.status !== 'processing' && state.status !== 'success' && (
        <button
          type="button"
          className="scanner-cancel-button"
          onClick={handleCancel}
          aria-label="Cancel recovery"
        >
          <CloseIcon size={20} />
        </button>
      )}

      {/* Security notice */}
      <div className="scanner-security-notice">
        <WarningIcon size={16} />
        <p>
          Your recovery code is the key to your encrypted data.
          Never share it with anyone.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Convenience Components
// ============================================================================

/**
 * Compact scan button that opens the full scanner when clicked.
 * Useful for embedding in login screens or settings.
 *
 * @example
 * ```tsx
 * <RecoveryScanButton onClick={() => setShowScanner(true)} />
 * ```
 */
export interface RecoveryScanButtonProps {
  /** Callback when button is clicked */
  onClick: () => void;
  /** Button label (default: 'Recover Account') */
  label?: string;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Custom class name */
  className?: string;
}

export function RecoveryScanButton({
  onClick,
  label = 'Recover Account',
  disabled = false,
  className = '',
}: RecoveryScanButtonProps) {
  return (
    <button
      type="button"
      className={`recovery-scan-button ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      <QRCodeIcon size={20} />
      <span>{label}</span>
    </button>
  );
}

/**
 * Recovery flow modal/dialog wrapper.
 * Provides a full-screen modal experience for the recovery scanner.
 *
 * @example
 * ```tsx
 * {showRecoveryModal && (
 *   <RecoveryScannerModal
 *     isOpen={showRecoveryModal}
 *     onClose={() => setShowRecoveryModal(false)}
 *     onSuccess={handleRecoverySuccess}
 *   />
 * )}
 * ```
 */
export interface RecoveryScannerModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Callback when recovery succeeds */
  onSuccess: (result: RecoveryImportResult) => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
  /** Custom class name */
  className?: string;
}

export function RecoveryScannerModal({
  isOpen,
  onClose,
  onSuccess,
  onError,
  className = '',
}: RecoveryScannerModalProps) {
  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={`recovery-scanner-modal ${className}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-scanner-title"
    >
      <div className="recovery-scanner-modal-backdrop" onClick={onClose} />
      <div className="recovery-scanner-modal-content">
        <RecoveryQRScanner
          onScanSuccess={onSuccess}
          onCancel={onClose}
          onError={onError}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export default RecoveryQRScanner;
