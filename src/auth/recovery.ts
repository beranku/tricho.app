/**
 * Recovery Secret (RS) module for vault recovery
 *
 * This module handles:
 * - Recovery Secret generation and encoding (Base32)
 * - RS checksum generation and validation for confirmation flow
 * - Recovery export sessions with confirmation requirement
 *
 * The RS checksum confirmation flow ensures users have properly saved their RS
 * before vault creation by requiring re-entry of the last 4 characters of the
 * Base32-encoded RS.
 */

import {
  confirmRecoverySecret,
  getVaultState,
  updateWrappedDekRs,
  type WrappedKeyData,
} from '../db/keystore';

/** Version string for domain separation */
export const RECOVERY_VERSION = 'v1';

/** Session storage key for recovery export session */
const SESSION_STORAGE_KEY = 'tricho_recovery_export_session';

/** RS length in bytes (256 bits) */
export const RS_LENGTH_BYTES = 32;

/** Checksum length (last N characters of Base32 RS) */
export const CHECKSUM_LENGTH = 4;

/**
 * Base32 alphabet (RFC 4648)
 * Using uppercase letters A-Z and digits 2-7
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Recovery export session for tracking RS confirmation state
 */
export interface RecoveryExportSession {
  /** Unique session identifier */
  sessionId: string;
  /** Associated vault ID */
  vaultId: string;
  /** User ID for the vault */
  userId: string;
  /** Timestamp when session was created */
  createdAt: number;
  /** Whether RS has been confirmed by checksum re-entry */
  confirmed: boolean;
  /** Timestamp when RS was confirmed */
  confirmedAt?: number;
  /** Expected checksum for validation */
  expectedChecksum: string;
  /** Base32-encoded RS (stored temporarily in session for confirmation) */
  encodedRs: string;
}

/**
 * Result of RS generation
 */
export interface RecoverySecretResult {
  /** Raw RS bytes (Uint8Array) */
  raw: Uint8Array;
  /** Base32-encoded RS for display/storage */
  encoded: string;
  /** Checksum (last 4 chars of encoded RS) */
  checksum: string;
}

/**
 * Generates a cryptographically secure Recovery Secret
 *
 * @returns RecoverySecretResult with raw bytes, Base32 encoding, and checksum
 */
export function generateRecoverySecret(): RecoverySecretResult {
  const raw = new Uint8Array(RS_LENGTH_BYTES);
  crypto.getRandomValues(raw);

  const encoded = encodeBase32(raw);
  const checksum = generateRSChecksum(encoded);

  return {
    raw,
    encoded,
    checksum,
  };
}

/**
 * Encodes raw bytes as Base32 (RFC 4648)
 *
 * @param data - Raw bytes to encode
 * @returns Base32-encoded string
 */
export function encodeBase32(data: Uint8Array): string {
  if (data.length === 0) {
    return '';
  }

  let result = '';
  let buffer = 0;
  let bitsLeft = 0;

  for (const byte of data) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;

    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      result += BASE32_ALPHABET[(buffer >> bitsLeft) & 0x1f];
    }
  }

  // Handle remaining bits
  if (bitsLeft > 0) {
    result += BASE32_ALPHABET[(buffer << (5 - bitsLeft)) & 0x1f];
  }

  return result;
}

/**
 * Decodes Base32-encoded string to raw bytes
 *
 * @param encoded - Base32-encoded string
 * @returns Raw bytes as Uint8Array
 * @throws Error if input contains invalid characters
 */
export function decodeBase32(encoded: string): Uint8Array {
  if (encoded.length === 0) {
    return new Uint8Array(0);
  }

  // Normalize input: uppercase and remove whitespace/dashes
  const normalized = encoded.toUpperCase().replace(/[\s-]/g, '');

  const result: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;

  for (const char of normalized) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }

    buffer = (buffer << 5) | value;
    bitsLeft += 5;

    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      result.push((buffer >> bitsLeft) & 0xff);
    }
  }

  return new Uint8Array(result);
}

/**
 * Generates checksum from Base32-encoded RS
 *
 * The checksum is the last CHECKSUM_LENGTH characters of the encoded RS,
 * which provides verification that the user has correctly copied the RS.
 *
 * @param encodedRs - Base32-encoded Recovery Secret
 * @returns Checksum string (last 4 characters, uppercase)
 */
export function generateRSChecksum(encodedRs: string): string {
  if (encodedRs.length < CHECKSUM_LENGTH) {
    throw new Error(`RS too short: must be at least ${CHECKSUM_LENGTH} characters`);
  }

  return encodedRs.slice(-CHECKSUM_LENGTH).toUpperCase();
}

/**
 * Validates RS checksum
 *
 * Compares the provided checksum with the expected checksum derived from the RS.
 * Comparison is case-insensitive.
 *
 * @param encodedRs - Base32-encoded Recovery Secret
 * @param checksum - Checksum to validate (user input)
 * @returns true if checksum matches, false otherwise
 */
export function validateRSChecksum(encodedRs: string, checksum: string): boolean {
  if (!encodedRs || !checksum) {
    return false;
  }

  const expectedChecksum = generateRSChecksum(encodedRs);
  const normalizedInput = checksum.toUpperCase().replace(/[\s-]/g, '');

  return expectedChecksum === normalizedInput;
}

/**
 * Generates a unique session ID
 *
 * @returns Session ID string
 */
function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Creates a new recovery export session
 *
 * A recovery export session tracks the RS confirmation state during vault creation.
 * The user must re-enter the RS checksum to confirm they have saved the RS.
 *
 * @param vaultId - Vault ID being created
 * @param userId - User ID for the vault
 * @param encodedRs - Base32-encoded Recovery Secret
 * @returns New RecoveryExportSession
 */
export function createRecoveryExportSession(
  vaultId: string,
  userId: string,
  encodedRs: string
): RecoveryExportSession {
  const session: RecoveryExportSession = {
    sessionId: generateSessionId(),
    vaultId,
    userId,
    createdAt: Date.now(),
    confirmed: false,
    expectedChecksum: generateRSChecksum(encodedRs),
    encodedRs,
  };

  // Store in sessionStorage (cleared on browser close for security)
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  return session;
}

/**
 * Retrieves the current recovery export session
 *
 * @returns RecoveryExportSession or null if no session exists
 */
export function getRecoveryExportSession(): RecoveryExportSession | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }

  const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored) as RecoveryExportSession;
  } catch {
    return null;
  }
}

/**
 * Retrieves recovery export session by vault ID
 *
 * @param vaultId - Vault ID to look up
 * @returns RecoveryExportSession or null if not found or vault ID doesn't match
 */
export function getRecoveryExportSessionByVaultId(vaultId: string): RecoveryExportSession | null {
  const session = getRecoveryExportSession();
  if (!session || session.vaultId !== vaultId) {
    return null;
  }
  return session;
}

/**
 * Confirms the recovery export session with checksum validation
 *
 * This is the core of the RS confirmation flow. The user enters the checksum
 * (last 4 characters of their RS), and this function validates it matches.
 * If valid, the session is marked as confirmed and the KeyStore is updated.
 *
 * @param checksum - Checksum entered by user
 * @returns true if confirmation successful, false if checksum invalid
 * @throws Error if no active session exists
 */
export async function confirmRecoveryExportSession(checksum: string): Promise<boolean> {
  const session = getRecoveryExportSession();
  if (!session) {
    throw new Error('No active recovery export session');
  }

  if (session.confirmed) {
    // Already confirmed
    return true;
  }

  // Validate checksum
  if (!validateRSChecksum(session.encodedRs, checksum)) {
    return false;
  }

  // Mark session as confirmed
  session.confirmed = true;
  session.confirmedAt = Date.now();

  // Update sessionStorage
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  // Update KeyStore to mark RS as confirmed
  await confirmRecoverySecret(session.vaultId);

  return true;
}

/**
 * Confirms recovery export session for a specific vault
 *
 * @param vaultId - Vault ID to confirm
 * @param checksum - Checksum entered by user
 * @returns true if confirmation successful, false if checksum invalid or session not found
 */
export async function confirmRecoveryExportSessionForVault(
  vaultId: string,
  checksum: string
): Promise<boolean> {
  const session = getRecoveryExportSessionByVaultId(vaultId);
  if (!session) {
    return false;
  }

  return confirmRecoveryExportSession(checksum);
}

/**
 * Checks if the current recovery session is confirmed
 *
 * @returns true if session exists and is confirmed, false otherwise
 */
export function isRecoverySessionConfirmed(): boolean {
  const session = getRecoveryExportSession();
  return session?.confirmed ?? false;
}

/**
 * Checks if recovery is confirmed for a specific vault
 *
 * @param vaultId - Vault ID to check
 * @returns true if session exists for vault and is confirmed
 */
export function isRecoveryConfirmedForVault(vaultId: string): boolean {
  const session = getRecoveryExportSessionByVaultId(vaultId);
  return session?.confirmed ?? false;
}

/**
 * Clears the recovery export session
 *
 * Should be called after vault creation is complete or cancelled.
 */
export function clearRecoveryExportSession(): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

/**
 * Gets the encoded RS from the current session
 *
 * This is only available during vault creation before the session is cleared.
 *
 * @returns Base32-encoded RS or null if no session exists
 */
export function getEncodedRsFromSession(): string | null {
  const session = getRecoveryExportSession();
  return session?.encodedRs ?? null;
}

/**
 * Validates that a recovery session exists and is confirmed
 *
 * Use this as a guard before proceeding with vault finalization.
 *
 * @param vaultId - Optional vault ID to verify session belongs to
 * @returns true if session is valid and confirmed
 * @throws Error with descriptive message if validation fails
 */
export function requireConfirmedRecoverySession(vaultId?: string): void {
  const session = getRecoveryExportSession();

  if (!session) {
    throw new Error('Recovery confirmation required: no active session');
  }

  if (vaultId && session.vaultId !== vaultId) {
    throw new Error('Recovery confirmation required: session does not match vault');
  }

  if (!session.confirmed) {
    throw new Error('Recovery confirmation required: checksum not verified');
  }
}

/**
 * Formats RS for display with grouping
 *
 * Groups the Base32 RS into chunks of 4 characters for readability.
 * Example: "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567"
 *
 * @param encodedRs - Base32-encoded Recovery Secret
 * @param groupSize - Size of each group (default: 4)
 * @param separator - Separator between groups (default: '-')
 * @returns Formatted RS string
 */
export function formatRsForDisplay(
  encodedRs: string,
  groupSize: number = 4,
  separator: string = '-'
): string {
  const groups: string[] = [];
  for (let i = 0; i < encodedRs.length; i += groupSize) {
    groups.push(encodedRs.slice(i, i + groupSize));
  }
  return groups.join(separator);
}

/**
 * Parses user-entered RS, removing formatting
 *
 * Handles various input formats (with dashes, spaces, lowercase).
 *
 * @param input - User input RS string
 * @returns Normalized RS string (uppercase, no separators)
 */
export function parseRsInput(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

/**
 * Validates RS format
 *
 * Checks that the RS is valid Base32 and correct length.
 *
 * @param encodedRs - RS string to validate
 * @returns true if valid, false otherwise
 */
export function isValidRsFormat(encodedRs: string): boolean {
  const normalized = parseRsInput(encodedRs);

  // Check length (32 bytes = 52 Base32 characters)
  if (normalized.length !== 52) {
    return false;
  }

  // Check all characters are valid Base32
  for (const char of normalized) {
    if (BASE32_ALPHABET.indexOf(char) === -1) {
      return false;
    }
  }

  return true;
}

/**
 * Decodes user-entered RS to raw bytes
 *
 * Convenience function that handles input normalization and decoding.
 *
 * @param input - User input RS string
 * @returns Raw RS bytes as Uint8Array
 * @throws Error if RS format is invalid
 */
export function decodeRsFromInput(input: string): Uint8Array {
  const normalized = parseRsInput(input);

  if (!isValidRsFormat(normalized)) {
    throw new Error('Invalid Recovery Secret format');
  }

  return decodeBase32(normalized);
}

// ============================================================================
// RS Rotation
// ============================================================================

/**
 * Handler function type for wrapping DEK with a new RS
 *
 * This callback is provided by the caller who has access to the DEK in memory.
 * The handler should:
 * 1. Derive KEK from RS using HKDF with the device salt
 * 2. Wrap the DEK with the derived KEK using AES-GCM
 * 3. Return the wrapped key data
 *
 * @param rs - New Recovery Secret raw bytes
 * @param deviceSalt - Device salt for key derivation (Base64url encoded)
 * @returns Promise resolving to WrappedKeyData
 */
export type WrapDekWithRsHandler = (rs: Uint8Array, deviceSalt: string) => Promise<WrappedKeyData>;

/**
 * Result of RS rotation operation
 */
export interface RotationResult {
  /** Whether rotation was successful */
  success: boolean;
  /** New Recovery Secret (only present on success) */
  newRs?: RecoverySecretResult;
  /** Error message (only present on failure) */
  error?: string;
}

/**
 * Session storage key for RS rotation session
 */
const ROTATION_SESSION_STORAGE_KEY = 'tricho_rs_rotation_session';

/**
 * RS rotation session for tracking rotation state
 */
export interface RSRotationSession {
  /** Unique session identifier */
  sessionId: string;
  /** Associated vault ID */
  vaultId: string;
  /** Timestamp when rotation was initiated */
  initiatedAt: number;
  /** Whether rotation has been confirmed */
  confirmed: boolean;
  /** Timestamp when rotation was confirmed */
  confirmedAt?: number;
  /** Expected checksum for new RS validation */
  expectedChecksum: string;
  /** Previous RS version (for audit) */
  previousVersion: number;
  /** New RS version */
  newVersion: number;
}

/**
 * Initiates RS rotation for a vault
 *
 * RS rotation allows users to generate a new Recovery Secret and re-wrap
 * the DEK. The old RS is invalidated once the new wrapped DEK is stored.
 *
 * **Security considerations:**
 * - Vault must be unlocked (DEK must be in memory)
 * - Old RS can no longer unwrap the DEK after rotation
 * - User should save the new RS before confirming rotation
 *
 * @param vaultId - Vault identifier to rotate RS for
 * @param wrapDekHandler - Handler function to wrap DEK with new RS
 * @returns Promise resolving to RotationResult
 * @throws Error if vault doesn't exist or is not properly initialized
 */
export async function rotateRecoverySecret(
  vaultId: string,
  wrapDekHandler: WrapDekWithRsHandler
): Promise<RotationResult> {
  // Validate vault exists
  const vault = await getVaultState(vaultId);
  if (!vault) {
    return {
      success: false,
      error: `Vault with ID ${vaultId} not found`,
    };
  }

  // Validate vault has existing RS wrap (can't rotate if no RS exists)
  if (!vault.wrappedDekRs) {
    return {
      success: false,
      error: 'Vault does not have an existing RS wrap to rotate',
    };
  }

  // Validate RS was previously confirmed
  if (!vault.rsConfirmed) {
    return {
      success: false,
      error: 'Cannot rotate RS: current RS has not been confirmed',
    };
  }

  try {
    // Generate new RS
    const newRs = generateRecoverySecret();

    // Wrap DEK with new RS using provided handler
    const newWrappedDekRs = await wrapDekHandler(newRs.raw, vault.deviceSalt);

    // Calculate new version
    const newVersion = vault.wrappedDekRs.version + 1;

    // Update the wrapped DEK with new version
    const wrappedKeyWithVersion: WrappedKeyData = {
      ...newWrappedDekRs,
      version: newVersion,
    };

    // Update KeyStore with new wrapped DEK
    await updateWrappedDekRs(vaultId, wrappedKeyWithVersion);

    // Create rotation session for confirmation tracking
    const rotationSession: RSRotationSession = {
      sessionId: generateRotationSessionId(),
      vaultId,
      initiatedAt: Date.now(),
      confirmed: false,
      expectedChecksum: newRs.checksum,
      previousVersion: vault.wrappedDekRs.version,
      newVersion,
    };

    // Store rotation session
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(ROTATION_SESSION_STORAGE_KEY, JSON.stringify(rotationSession));
    }

    return {
      success: true,
      newRs,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during RS rotation',
    };
  }
}

/**
 * Generates a unique rotation session ID
 *
 * @returns Rotation session ID string
 */
function generateRotationSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `rotation-${crypto.randomUUID()}`;
  }
  // Fallback for older browsers
  return `rotation-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Retrieves the current RS rotation session
 *
 * @returns RSRotationSession or null if no session exists
 */
export function getRotationSession(): RSRotationSession | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }

  const stored = sessionStorage.getItem(ROTATION_SESSION_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored) as RSRotationSession;
  } catch {
    return null;
  }
}

/**
 * Retrieves rotation session for a specific vault
 *
 * @param vaultId - Vault ID to look up
 * @returns RSRotationSession or null if not found or vault ID doesn't match
 */
export function getRotationSessionByVaultId(vaultId: string): RSRotationSession | null {
  const session = getRotationSession();
  if (!session || session.vaultId !== vaultId) {
    return null;
  }
  return session;
}

/**
 * Confirms the RS rotation session
 *
 * User must re-enter the checksum of the new RS to confirm they have
 * saved it. This is similar to the initial RS confirmation flow.
 *
 * @param checksum - Checksum entered by user (last 4 chars of new RS)
 * @returns true if confirmation successful, false if checksum invalid
 * @throws Error if no active rotation session exists
 */
export function confirmRotationSession(checksum: string): boolean {
  const session = getRotationSession();
  if (!session) {
    throw new Error('No active RS rotation session');
  }

  if (session.confirmed) {
    // Already confirmed
    return true;
  }

  // Validate checksum
  const normalizedInput = checksum.toUpperCase().replace(/[\s-]/g, '');
  if (session.expectedChecksum !== normalizedInput) {
    return false;
  }

  // Mark session as confirmed
  session.confirmed = true;
  session.confirmedAt = Date.now();

  // Update sessionStorage
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(ROTATION_SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  return true;
}

/**
 * Confirms rotation session for a specific vault
 *
 * @param vaultId - Vault ID to confirm
 * @param checksum - Checksum entered by user
 * @returns true if confirmation successful, false if checksum invalid or session not found
 */
export function confirmRotationSessionForVault(vaultId: string, checksum: string): boolean {
  const session = getRotationSessionByVaultId(vaultId);
  if (!session) {
    return false;
  }

  return confirmRotationSession(checksum);
}

/**
 * Checks if the current rotation session is confirmed
 *
 * @returns true if session exists and is confirmed, false otherwise
 */
export function isRotationSessionConfirmed(): boolean {
  const session = getRotationSession();
  return session?.confirmed ?? false;
}

/**
 * Checks if rotation is confirmed for a specific vault
 *
 * @param vaultId - Vault ID to check
 * @returns true if session exists for vault and is confirmed
 */
export function isRotationConfirmedForVault(vaultId: string): boolean {
  const session = getRotationSessionByVaultId(vaultId);
  return session?.confirmed ?? false;
}

/**
 * Clears the RS rotation session
 *
 * Should be called after rotation is complete or cancelled.
 */
export function clearRotationSession(): void {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(ROTATION_SESSION_STORAGE_KEY);
  }
}

/**
 * Gets the new RS version from the rotation session
 *
 * @returns New version number or null if no session exists
 */
export function getRotationNewVersion(): number | null {
  const session = getRotationSession();
  return session?.newVersion ?? null;
}

/**
 * Validates that a rotation session exists and is confirmed
 *
 * Use this as a guard after RS rotation before showing success.
 *
 * @param vaultId - Optional vault ID to verify session belongs to
 * @throws Error with descriptive message if validation fails
 */
export function requireConfirmedRotationSession(vaultId?: string): void {
  const session = getRotationSession();

  if (!session) {
    throw new Error('RS rotation confirmation required: no active rotation session');
  }

  if (vaultId && session.vaultId !== vaultId) {
    throw new Error('RS rotation confirmation required: session does not match vault');
  }

  if (!session.confirmed) {
    throw new Error('RS rotation confirmation required: new RS checksum not verified');
  }
}
