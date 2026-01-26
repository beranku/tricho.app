/**
 * Recovery QR Export Module
 *
 * Provides functionality for exporting and displaying the Recovery Secret (RS)
 * as a QR code. The RS is the ultimate "break glass" mechanism for account
 * recovery when passkeys are unavailable or deleted.
 *
 * SECURITY CONSIDERATIONS:
 * - The RS is extremely powerful and must be treated as a secret
 * - RS should only be displayed once during initial setup
 * - Users must be clearly instructed to save the QR securely
 * - The RS should never be transmitted to any server
 * - Clear the RS from memory as soon as possible after display
 *
 * @module auth/recovery
 *
 * @example
 * ```typescript
 * import {
 *   prepareRecoveryQRData,
 *   createRecoveryExportSession,
 *   confirmRecoveryExported,
 *   hasUserExportedRecovery,
 * } from '@/auth/recovery';
 *
 * // During first-time setup, after key generation
 * const recoverySecret = generateRecoverySecret();
 * const qrData = prepareRecoveryQRData(recoverySecret);
 *
 * // Track the export session
 * const session = createRecoveryExportSession(userId);
 *
 * // Display QR code to user (use qrcode.react component)
 * <QRCode value={qrData.uri} />
 *
 * // After user confirms they've saved it
 * confirmRecoveryExported(session.sessionId, userId);
 *
 * // Clear sensitive data
 * clearRecoverySecret(recoverySecret);
 * ```
 */

import {
  type RecoverySecret,
  type DataEncryptionKey,
  type DeviceSalt,
  type WrappedDek,
  isValidKey,
  clearKey,
  KEY_LENGTH,
  generateRecoverySecret,
  generateDeviceSalt,
  deriveKekFromRS,
  wrapDek,
} from '../crypto/keys';
import {
  formatRecoveryQRData,
  parseRecoveryQRData,
  base64urlEncode,
  base64urlDecode,
  isValidBase64url,
} from '../crypto/utils';

// ============================================================================
// Types
// ============================================================================

/**
 * Data prepared for QR code display
 */
export interface RecoveryQRData {
  /** Full URI for QR code (tricho://recover/{base64url}) */
  uri: string;
  /** Base64url-encoded recovery secret (for text backup) */
  base64url: string;
  /** Length of the recovery secret in bytes */
  secretLength: number;
  /** Timestamp when data was prepared */
  preparedAt: number;
}

/**
 * Recovery export session for tracking user acknowledgment
 */
export interface RecoveryExportSession {
  /** Unique session identifier */
  sessionId: string;
  /** User ID associated with this export */
  userId: string;
  /** Timestamp when session was created */
  createdAt: number;
  /** Whether user has confirmed saving the recovery QR */
  confirmed: boolean;
  /** Timestamp when user confirmed (if confirmed) */
  confirmedAt?: number;
}

/**
 * Stored recovery export status
 */
export interface RecoveryExportStatus {
  /** User ID */
  userId: string;
  /** Whether recovery has been exported and confirmed */
  exported: boolean;
  /** When the export was confirmed */
  exportedAt?: number;
  /** Number of times recovery has been viewed (for audit) */
  viewCount: number;
  /** Last time recovery was viewed */
  lastViewedAt?: number;
}

/**
 * Options for recovery QR display
 */
export interface RecoveryDisplayOptions {
  /** Error correction level for QR code (L, M, Q, H) */
  errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H';
  /** Recommended QR code size in pixels */
  recommendedSize: number;
  /** Whether to show text backup option */
  showTextBackup: boolean;
}

// ============================================================================
// Recovery Import Types
// ============================================================================

/**
 * Result of recovery import operation.
 * Contains the derived KEK and all data needed to set up the device.
 */
export interface RecoveryImportResult {
  /** The recovery secret extracted from QR code */
  recoverySecret: RecoverySecret;
  /** The KEK derived from recovery secret for this device */
  kek: CryptoKey;
  /** Device-specific salt used in KEK derivation */
  deviceSalt: DeviceSalt;
  /** Timestamp when import was completed */
  importedAt: number;
}

/**
 * Result of recovery import with DEK wrapping.
 * Extends RecoveryImportResult to include wrapped DEK for storage.
 */
export interface RecoveryImportWithDekResult extends RecoveryImportResult {
  /** The DEK wrapped with the derived KEK */
  wrappedDek: WrappedDek;
}

/**
 * Recovery import session for tracking the import flow
 */
export interface RecoveryImportSession {
  /** Unique session identifier */
  sessionId: string;
  /** Timestamp when session was created */
  createdAt: number;
  /** Current step in the import flow */
  step: RecoveryImportStep;
  /** Timestamp when QR was successfully scanned */
  scannedAt?: number;
  /** Timestamp when keys were derived */
  derivedAt?: number;
  /** Whether the import was completed successfully */
  completed: boolean;
  /** Timestamp when import completed */
  completedAt?: number;
  /** Error message if import failed */
  error?: string;
}

/**
 * Steps in the recovery import flow
 */
export type RecoveryImportStep =
  | 'awaiting_scan'
  | 'validating'
  | 'deriving_keys'
  | 'completed'
  | 'failed';

/**
 * Stored recovery import status for a device
 */
export interface RecoveryImportStatus {
  /** Whether this device was set up via recovery */
  recoveredDevice: boolean;
  /** When the recovery was performed */
  recoveredAt?: number;
  /** Number of recovery attempts (for audit) */
  attemptCount: number;
  /** Last attempt timestamp */
  lastAttemptAt?: number;
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when recovery secret is invalid
 */
export class InvalidRecoverySecretError extends Error {
  constructor(message = 'Invalid recovery secret') {
    super(message);
    this.name = 'InvalidRecoverySecretError';
  }
}

/**
 * Error thrown when recovery export session is invalid
 */
export class InvalidExportSessionError extends Error {
  constructor(message = 'Invalid or expired export session') {
    super(message);
    this.name = 'InvalidExportSessionError';
  }
}

/**
 * Error thrown when recovery data parsing fails
 */
export class RecoveryParseError extends Error {
  constructor(message = 'Failed to parse recovery data') {
    super(message);
    this.name = 'RecoveryParseError';
  }
}

/**
 * Error thrown when recovery import fails
 */
export class RecoveryImportError extends Error {
  /** The step at which the import failed */
  step: RecoveryImportStep;

  constructor(message = 'Recovery import failed', step: RecoveryImportStep = 'failed') {
    super(message);
    this.name = 'RecoveryImportError';
    this.step = step;
  }
}

// ============================================================================
// Constants
// ============================================================================

/** Storage key prefix for recovery export status */
const STORAGE_KEY_PREFIX = 'tricho:recovery_export';

/** Storage key prefix for recovery import status */
const IMPORT_STORAGE_KEY_PREFIX = 'tricho:recovery_import';

/** Storage key for active export sessions */
const SESSION_STORAGE_KEY = 'tricho:recovery_session';

/** Storage key for active import sessions */
const IMPORT_SESSION_STORAGE_KEY = 'tricho:recovery_import_session';

/** Export session timeout in milliseconds (30 minutes) */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** Import session timeout in milliseconds (15 minutes) */
const IMPORT_SESSION_TIMEOUT_MS = 15 * 60 * 1000;

/** Default QR code display options */
export const DEFAULT_DISPLAY_OPTIONS: RecoveryDisplayOptions = {
  errorCorrectionLevel: 'M',
  recommendedSize: 256,
  showTextBackup: true,
};

// ============================================================================
// QR Data Preparation
// ============================================================================

/**
 * Prepares recovery secret data for QR code display.
 * This creates the URI and formatted data needed for the QR component.
 *
 * @param recoverySecret - The 32-byte recovery secret to encode
 * @returns Prepared QR data including URI and base64url
 * @throws {InvalidRecoverySecretError} If the recovery secret is invalid
 *
 * @example
 * ```typescript
 * const recoverySecret = generateRecoverySecret();
 * const qrData = prepareRecoveryQRData(recoverySecret);
 *
 * // Use with qrcode.react
 * <QRCode value={qrData.uri} size={256} level="M" />
 *
 * // Also show text backup option
 * <p>Manual backup code: {qrData.base64url}</p>
 * ```
 */
export function prepareRecoveryQRData(recoverySecret: RecoverySecret): RecoveryQRData {
  if (!isValidKey(recoverySecret)) {
    throw new InvalidRecoverySecretError(
      `Recovery secret must be a ${KEY_LENGTH}-byte Uint8Array`
    );
  }

  const uri = formatRecoveryQRData(recoverySecret);
  const base64url = base64urlEncode(recoverySecret);

  return {
    uri,
    base64url,
    secretLength: recoverySecret.length,
    preparedAt: Date.now(),
  };
}

/**
 * Validates a recovery secret without exposing its value.
 * Use this to check if a secret is valid before attempting operations.
 *
 * @param recoverySecret - The recovery secret to validate
 * @returns true if the recovery secret is valid (32 bytes)
 */
export function isValidRecoverySecret(recoverySecret: unknown): recoverySecret is RecoverySecret {
  return (
    recoverySecret instanceof Uint8Array &&
    recoverySecret.length === KEY_LENGTH
  );
}

/**
 * Gets recommended display options for the recovery QR code.
 * These settings balance scannability with information density.
 *
 * @returns Display options for the QR component
 *
 * @example
 * ```typescript
 * const options = getRecoveryDisplayOptions();
 * <QRCode
 *   value={qrData.uri}
 *   size={options.recommendedSize}
 *   level={options.errorCorrectionLevel}
 * />
 * ```
 */
export function getRecoveryDisplayOptions(): RecoveryDisplayOptions {
  return { ...DEFAULT_DISPLAY_OPTIONS };
}

// ============================================================================
// Export Session Management
// ============================================================================

/**
 * Creates a new recovery export session.
 * This tracks that the user is viewing the recovery QR and should confirm saving it.
 *
 * @param userId - The user ID for this export session
 * @returns New export session
 *
 * @example
 * ```typescript
 * const session = createRecoveryExportSession(userId);
 * // Show QR code to user
 * // ...
 * // When user clicks "I've saved my recovery code"
 * confirmRecoveryExported(session.sessionId, userId);
 * ```
 */
export function createRecoveryExportSession(userId: string): RecoveryExportSession {
  if (!userId || typeof userId !== 'string') {
    throw new Error('User ID is required');
  }

  const session: RecoveryExportSession = {
    sessionId: generateSessionId(),
    userId,
    createdAt: Date.now(),
    confirmed: false,
  };

  // Store session in sessionStorage (cleared on browser close)
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  return session;
}

/**
 * Gets the current active export session, if any.
 *
 * @returns Active session or null if none exists or expired
 */
export function getActiveExportSession(): RecoveryExportSession | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }

  const data = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!data) {
    return null;
  }

  try {
    const session = JSON.parse(data) as RecoveryExportSession;

    // Check if session has expired
    if (Date.now() - session.createdAt > SESSION_TIMEOUT_MS) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }

    return session;
  } catch {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

/**
 * Confirms that the user has exported/saved their recovery QR code.
 * This should be called when the user acknowledges they've saved the recovery data.
 *
 * @param sessionId - The session ID from createRecoveryExportSession
 * @param userId - The user ID to confirm for
 * @throws {InvalidExportSessionError} If session is invalid or expired
 *
 * @example
 * ```typescript
 * // User clicked "I've saved my recovery code"
 * confirmRecoveryExported(session.sessionId, userId);
 *
 * // Now check status
 * const status = getRecoveryExportStatus(userId);
 * console.log(status.exported); // true
 * ```
 */
export function confirmRecoveryExported(sessionId: string, userId: string): void {
  const session = getActiveExportSession();

  if (!session) {
    throw new InvalidExportSessionError('No active export session found');
  }

  if (session.sessionId !== sessionId) {
    throw new InvalidExportSessionError('Session ID does not match');
  }

  if (session.userId !== userId) {
    throw new InvalidExportSessionError('User ID does not match session');
  }

  // Update session
  const updatedSession: RecoveryExportSession = {
    ...session,
    confirmed: true,
    confirmedAt: Date.now(),
  };

  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updatedSession));
  }

  // Update persistent export status
  updateExportStatus(userId, {
    exported: true,
    exportedAt: Date.now(),
  });
}

/**
 * Clears the active export session.
 * Call this when the user cancels or leaves the export flow.
 */
export function clearExportSession(): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

// ============================================================================
// Export Status Tracking
// ============================================================================

/**
 * Gets the recovery export status for a user.
 *
 * @param userId - The user ID to check
 * @returns Export status or null if no status recorded
 */
export function getRecoveryExportStatus(userId: string): RecoveryExportStatus | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  const key = `${STORAGE_KEY_PREFIX}:${userId}`;
  const data = localStorage.getItem(key);

  if (!data) {
    return null;
  }

  try {
    return JSON.parse(data) as RecoveryExportStatus;
  } catch {
    return null;
  }
}

/**
 * Checks if the user has confirmed exporting their recovery QR.
 * Use this to determine if the user needs to be prompted to save recovery.
 *
 * @param userId - The user ID to check
 * @returns true if user has confirmed saving recovery data
 *
 * @example
 * ```typescript
 * if (!hasUserExportedRecovery(userId)) {
 *   showRecoveryExportReminder();
 * }
 * ```
 */
export function hasUserExportedRecovery(userId: string): boolean {
  const status = getRecoveryExportStatus(userId);
  return status?.exported ?? false;
}

/**
 * Records that the recovery QR was viewed (for audit purposes).
 * Call this each time the user views the recovery QR in settings.
 *
 * @param userId - The user ID
 */
export function recordRecoveryViewed(userId: string): void {
  const currentStatus = getRecoveryExportStatus(userId);
  const now = Date.now();

  const newStatus: RecoveryExportStatus = {
    userId,
    exported: currentStatus?.exported ?? false,
    exportedAt: currentStatus?.exportedAt,
    viewCount: (currentStatus?.viewCount ?? 0) + 1,
    lastViewedAt: now,
  };

  saveExportStatus(newStatus);
}

/**
 * Clears recovery export status for a user.
 * Use this when resetting the app or during testing.
 *
 * @param userId - The user ID to clear
 */
export function clearRecoveryExportStatus(userId: string): void {
  if (typeof localStorage !== 'undefined') {
    const key = `${STORAGE_KEY_PREFIX}:${userId}`;
    localStorage.removeItem(key);
  }
}

// ============================================================================
// Recovery Secret Utilities
// ============================================================================

/**
 * Securely clears a recovery secret from memory.
 * Call this as soon as the recovery secret is no longer needed.
 *
 * Note: JavaScript doesn't guarantee immediate memory clearing,
 * but this reduces the window of exposure.
 *
 * @param recoverySecret - The recovery secret to clear
 *
 * @example
 * ```typescript
 * const recoverySecret = generateRecoverySecret();
 * const qrData = prepareRecoveryQRData(recoverySecret);
 *
 * // Display QR to user...
 *
 * // After user confirms saving, clear the secret
 * clearRecoverySecret(recoverySecret);
 * ```
 */
export function clearRecoverySecret(recoverySecret: RecoverySecret): void {
  clearKey(recoverySecret);
}

/**
 * Re-exports generateRecoverySecret from crypto/keys for convenience.
 * Generates a new 32-byte cryptographically secure recovery secret.
 *
 * @returns New 32-byte recovery secret
 * @throws Error if Web Crypto API is not available
 */
export { generateRecoverySecret };

// ============================================================================
// QR Code Validation
// ============================================================================

/**
 * Validates QR code data format without parsing.
 * Use this for quick validation before attempting to parse.
 *
 * @param qrData - The QR code data to validate
 * @returns true if the data appears to be valid recovery data
 *
 * @example
 * ```typescript
 * const scannedData = "tricho://recover/...";
 * if (isValidRecoveryQRFormat(scannedData)) {
 *   const recoverySecret = parseRecoveryQR(scannedData);
 * }
 * ```
 */
export function isValidRecoveryQRFormat(qrData: string): boolean {
  if (typeof qrData !== 'string' || qrData.length === 0) {
    return false;
  }

  // Check for tricho:// URI format
  const uriPrefix = 'tricho://recover/';
  if (qrData.startsWith(uriPrefix)) {
    const base64urlPart = qrData.slice(uriPrefix.length);
    return isValidBase64url(base64urlPart) && base64urlPart.length > 0;
  }

  // Check for plain base64url (43 chars for 32 bytes)
  if (isValidBase64url(qrData) && qrData.length >= 42 && qrData.length <= 44) {
    return true;
  }

  return false;
}

/**
 * Parses scanned QR code data to extract the recovery secret.
 * Supports both tricho:// URI format and plain base64url.
 *
 * This function will be extended in subtask-4-5 to handle the full
 * recovery import flow. For now, it provides the parsing functionality.
 *
 * @param qrData - The scanned QR code data
 * @returns The 32-byte recovery secret
 * @throws {RecoveryParseError} If the data is invalid
 *
 * @example
 * ```typescript
 * try {
 *   const recoverySecret = parseRecoveryQR(scannedData);
 *   // Use recovery secret to derive keys...
 * } catch (error) {
 *   if (error instanceof RecoveryParseError) {
 *     showError('Invalid recovery code');
 *   }
 * }
 * ```
 */
export function parseRecoveryQR(qrData: string): RecoverySecret {
  if (!isValidRecoveryQRFormat(qrData)) {
    throw new RecoveryParseError('Invalid QR code format');
  }

  try {
    return parseRecoveryQRData(qrData);
  } catch (error) {
    throw new RecoveryParseError(
      error instanceof Error ? error.message : 'Failed to parse recovery QR'
    );
  }
}

// ============================================================================
// Text Backup Utilities
// ============================================================================

/**
 * Formats recovery secret as a human-readable backup string.
 * Splits the base64url into groups for easier transcription.
 *
 * @param recoverySecret - The recovery secret to format
 * @param groupSize - Characters per group (default: 4)
 * @returns Formatted string with groups separated by spaces
 *
 * @example
 * ```typescript
 * const formatted = formatRecoveryForTextBackup(recoverySecret);
 * // "ABCD EFGH IJKL MNOP QRST UVWX YZab cdef ghij klm"
 * ```
 */
export function formatRecoveryForTextBackup(
  recoverySecret: RecoverySecret,
  groupSize = 4
): string {
  if (!isValidKey(recoverySecret)) {
    throw new InvalidRecoverySecretError('Invalid recovery secret');
  }

  const base64url = base64urlEncode(recoverySecret);
  const groups: string[] = [];

  for (let i = 0; i < base64url.length; i += groupSize) {
    groups.push(base64url.slice(i, i + groupSize));
  }

  return groups.join(' ');
}

/**
 * Parses a human-readable backup string back to recovery secret.
 * Removes spaces and validates the format.
 *
 * @param textBackup - The text backup string (with or without spaces)
 * @returns The 32-byte recovery secret
 * @throws {RecoveryParseError} If the text is invalid
 *
 * @example
 * ```typescript
 * const userInput = "ABCD EFGH IJKL...";
 * const recoverySecret = parseTextBackup(userInput);
 * ```
 */
export function parseTextBackup(textBackup: string): RecoverySecret {
  if (typeof textBackup !== 'string' || textBackup.length === 0) {
    throw new RecoveryParseError('Invalid text backup: must be a non-empty string');
  }

  // Remove spaces and normalize
  const normalized = textBackup.replace(/\s+/g, '').trim();

  if (!isValidBase64url(normalized)) {
    throw new RecoveryParseError('Invalid text backup: contains invalid characters');
  }

  try {
    return parseRecoveryQRData(normalized);
  } catch (error) {
    throw new RecoveryParseError(
      error instanceof Error ? error.message : 'Failed to parse text backup'
    );
  }
}

// ============================================================================
// Recovery Import Functions
// ============================================================================

/**
 * Creates a new recovery import session.
 * Call this when starting the recovery/import flow.
 *
 * @returns New import session
 *
 * @example
 * ```typescript
 * const session = createRecoveryImportSession();
 * // Show QR scanner to user...
 * // On scan success:
 * const result = await importFromRecoveryQR(scannedData);
 * completeRecoveryImportSession(session.sessionId, result);
 * ```
 */
export function createRecoveryImportSession(): RecoveryImportSession {
  const session: RecoveryImportSession = {
    sessionId: generateSessionId(),
    createdAt: Date.now(),
    step: 'awaiting_scan',
    completed: false,
  };

  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(IMPORT_SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  // Record attempt for audit
  recordRecoveryAttempt();

  return session;
}

/**
 * Gets the current active import session, if any.
 *
 * @returns Active session or null if none exists or expired
 */
export function getActiveImportSession(): RecoveryImportSession | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }

  const data = sessionStorage.getItem(IMPORT_SESSION_STORAGE_KEY);
  if (!data) {
    return null;
  }

  try {
    const session = JSON.parse(data) as RecoveryImportSession;

    // Check if session has expired
    if (Date.now() - session.createdAt > IMPORT_SESSION_TIMEOUT_MS) {
      sessionStorage.removeItem(IMPORT_SESSION_STORAGE_KEY);
      return null;
    }

    return session;
  } catch {
    sessionStorage.removeItem(IMPORT_SESSION_STORAGE_KEY);
    return null;
  }
}

/**
 * Updates the current import session step.
 *
 * @param step - New step in the import flow
 * @param error - Optional error message if step is 'failed'
 */
export function updateImportSessionStep(
  step: RecoveryImportStep,
  error?: string
): void {
  const session = getActiveImportSession();
  if (!session) {
    return;
  }

  const updatedSession: RecoveryImportSession = {
    ...session,
    step,
    error: step === 'failed' ? error : undefined,
  };

  if (step === 'validating') {
    updatedSession.scannedAt = Date.now();
  } else if (step === 'deriving_keys') {
    updatedSession.derivedAt = Date.now();
  } else if (step === 'completed') {
    updatedSession.completed = true;
    updatedSession.completedAt = Date.now();
  }

  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(IMPORT_SESSION_STORAGE_KEY, JSON.stringify(updatedSession));
  }
}

/**
 * Clears the active import session.
 * Call this when the user cancels or the import completes.
 */
export function clearImportSession(): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(IMPORT_SESSION_STORAGE_KEY);
  }
}

/**
 * Imports a recovery secret from scanned QR data and derives keys.
 * This is the main entry point for the recovery import flow.
 *
 * The function:
 * 1. Parses and validates the QR data
 * 2. Generates a new device salt for this device
 * 3. Derives a KEK from the recovery secret
 *
 * @param qrData - The scanned QR code data (URI or base64url)
 * @returns Promise resolving to RecoveryImportResult
 * @throws {RecoveryParseError} If QR data is invalid
 * @throws {RecoveryImportError} If key derivation fails
 *
 * @example
 * ```typescript
 * // Start import session
 * const session = createRecoveryImportSession();
 *
 * // User scans QR code
 * const scannedData = await scanQRCode();
 *
 * try {
 *   const result = await importFromRecoveryQR(scannedData);
 *
 *   // Result contains:
 *   // - recoverySecret: for further operations if needed
 *   // - kek: CryptoKey for wrapping/unwrapping DEK
 *   // - deviceSalt: to store alongside wrapped DEK
 *
 *   // Now register a new passkey and complete setup...
 * } catch (error) {
 *   if (error instanceof RecoveryParseError) {
 *     showError('Invalid QR code. Please try again.');
 *   }
 * } finally {
 *   clearImportSession();
 * }
 * ```
 */
export async function importFromRecoveryQR(
  qrData: string
): Promise<RecoveryImportResult> {
  // Update session step
  updateImportSessionStep('validating');

  // Parse and validate QR data
  let recoverySecret: RecoverySecret;
  try {
    recoverySecret = parseRecoveryQR(qrData);
  } catch (error) {
    updateImportSessionStep('failed', 'Invalid QR code format');
    throw error;
  }

  // Update session step
  updateImportSessionStep('deriving_keys');

  // Generate device salt for this device
  const deviceSalt = generateDeviceSalt();

  // Derive KEK from recovery secret
  let kek: CryptoKey;
  try {
    kek = await deriveKekFromRS(recoverySecret, deviceSalt);
  } catch (error) {
    updateImportSessionStep('failed', 'Failed to derive keys');
    throw new RecoveryImportError(
      error instanceof Error ? error.message : 'Failed to derive KEK from recovery secret',
      'deriving_keys'
    );
  }

  // Mark session as completed
  updateImportSessionStep('completed');

  return {
    recoverySecret,
    kek,
    deviceSalt,
    importedAt: Date.now(),
  };
}

/**
 * Imports from recovery QR and wraps a provided DEK.
 * Use this during recovery when you have the DEK from sync.
 *
 * @param qrData - The scanned QR code data
 * @param dek - The Data Encryption Key to wrap
 * @returns Promise resolving to result with wrapped DEK
 *
 * @example
 * ```typescript
 * // After syncing from another device, you have the DEK
 * const result = await importFromRecoveryQRAndWrapDek(scannedData, dek);
 *
 * // Store the wrapped DEK and device salt for this device
 * localStorage.setItem('wrapped_dek', serialize(result.wrappedDek));
 * localStorage.setItem('device_salt', serialize(result.deviceSalt));
 *
 * // Clear sensitive data
 * clearRecoverySecret(result.recoverySecret);
 * ```
 */
export async function importFromRecoveryQRAndWrapDek(
  qrData: string,
  dek: DataEncryptionKey
): Promise<RecoveryImportWithDekResult> {
  // Import and derive keys
  const importResult = await importFromRecoveryQR(qrData);

  // Wrap the DEK with the derived KEK
  let wrappedDek: WrappedDek;
  try {
    wrappedDek = await wrapDek(dek, importResult.kek);
  } catch (error) {
    throw new RecoveryImportError(
      error instanceof Error ? error.message : 'Failed to wrap DEK',
      'completed'
    );
  }

  return {
    ...importResult,
    wrappedDek,
  };
}

/**
 * Validates QR data without performing full import.
 * Use this for quick validation before starting the full import flow.
 *
 * @param qrData - The scanned QR code data to validate
 * @returns Object with isValid flag and optional error message
 *
 * @example
 * ```typescript
 * const validation = validateRecoveryQRData(scannedData);
 * if (!validation.isValid) {
 *   showError(validation.error);
 *   return;
 * }
 *
 * // Proceed with full import
 * const result = await importFromRecoveryQR(scannedData);
 * ```
 */
export function validateRecoveryQRData(qrData: string): {
  isValid: boolean;
  error?: string;
  secretLength?: number;
} {
  if (!qrData || typeof qrData !== 'string') {
    return { isValid: false, error: 'QR data is empty or invalid' };
  }

  if (!isValidRecoveryQRFormat(qrData)) {
    return { isValid: false, error: 'Invalid QR code format' };
  }

  try {
    const secret = parseRecoveryQR(qrData);
    return {
      isValid: true,
      secretLength: secret.length,
    };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Failed to parse QR data',
    };
  }
}

// ============================================================================
// Recovery Import Status Tracking
// ============================================================================

/**
 * Gets the recovery import status for this device.
 *
 * @returns Import status or null if never imported
 */
export function getRecoveryImportStatus(): RecoveryImportStatus | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  const data = localStorage.getItem(IMPORT_STORAGE_KEY_PREFIX);
  if (!data) {
    return null;
  }

  try {
    return JSON.parse(data) as RecoveryImportStatus;
  } catch {
    return null;
  }
}

/**
 * Checks if this device was set up via recovery.
 *
 * @returns true if device was recovered, false otherwise
 */
export function isRecoveredDevice(): boolean {
  const status = getRecoveryImportStatus();
  return status?.recoveredDevice ?? false;
}

/**
 * Marks this device as recovered.
 * Call this after successful recovery import and passkey registration.
 */
export function markDeviceAsRecovered(): void {
  const currentStatus = getRecoveryImportStatus();
  const now = Date.now();

  const newStatus: RecoveryImportStatus = {
    recoveredDevice: true,
    recoveredAt: now,
    attemptCount: (currentStatus?.attemptCount ?? 0),
    lastAttemptAt: currentStatus?.lastAttemptAt,
  };

  saveImportStatus(newStatus);
}

/**
 * Records a recovery attempt (for audit).
 *
 * @internal
 */
function recordRecoveryAttempt(): void {
  const currentStatus = getRecoveryImportStatus();
  const now = Date.now();

  const newStatus: RecoveryImportStatus = {
    recoveredDevice: currentStatus?.recoveredDevice ?? false,
    recoveredAt: currentStatus?.recoveredAt,
    attemptCount: (currentStatus?.attemptCount ?? 0) + 1,
    lastAttemptAt: now,
  };

  saveImportStatus(newStatus);
}

/**
 * Clears recovery import status.
 * Use this when resetting the app or during testing.
 */
export function clearRecoveryImportStatus(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(IMPORT_STORAGE_KEY_PREFIX);
  }
}

/**
 * Saves import status to localStorage.
 *
 * @internal
 */
function saveImportStatus(status: RecoveryImportStatus): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(IMPORT_STORAGE_KEY_PREFIX, JSON.stringify(status));
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Generates a unique session ID.
 *
 * @internal
 */
function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Updates export status in localStorage.
 *
 * @internal
 */
function updateExportStatus(
  userId: string,
  updates: Partial<RecoveryExportStatus>
): void {
  const currentStatus = getRecoveryExportStatus(userId);
  const newStatus: RecoveryExportStatus = {
    userId,
    exported: currentStatus?.exported ?? false,
    exportedAt: currentStatus?.exportedAt,
    viewCount: currentStatus?.viewCount ?? 0,
    lastViewedAt: currentStatus?.lastViewedAt,
    ...updates,
  };
  saveExportStatus(newStatus);
}

/**
 * Saves export status to localStorage.
 *
 * @internal
 */
function saveExportStatus(status: RecoveryExportStatus): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  const key = `${STORAGE_KEY_PREFIX}:${status.userId}`;
  localStorage.setItem(key, JSON.stringify(status));
}
