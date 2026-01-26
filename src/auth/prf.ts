/**
 * PRF Extension Handling Module
 *
 * Provides comprehensive WebAuthn PRF (Pseudo-Random Function) extension handling
 * with graceful degradation for E2EE key derivation in TrichoApp.
 *
 * PRF enables stateless key derivation tied to a passkey, meaning the KEK can be
 * recreated from just the passkey without storing any secret material. When PRF
 * is not available, we gracefully fall back to RS-based KEK derivation.
 *
 * @module auth/prf
 *
 * Platform-Specific PRF Support (CRITICAL):
 * - Safari/iOS: PRF works ONLY with iCloud Keychain passkeys (NOT hardware keys like YubiKey)
 * - iOS 18: Early versions have data loss bugs; Safari 18.2 returns different PRF values for hybrid vs on-device auth
 * - Cross-device QR flows: PRF is NOT reliable - returns inconsistent values or fails
 * - Android: Robust support across browsers and authenticators
 * - Chrome/Edge: Good support with platform authenticators
 *
 * @example
 * ```typescript
 * import { unlockWithPasskey, getPrfCapabilities, generatePrfSalt } from '@/auth/prf';
 *
 * // Check PRF capabilities before authentication
 * const caps = await getPrfCapabilities();
 * if (caps.prfLikelyAvailable) {
 *   console.log('PRF available, will use stateless key derivation');
 * } else {
 *   console.log('PRF not available, will fall back to recovery secret');
 * }
 *
 * // Authenticate and derive KEK with automatic fallback
 * const result = await unlockWithPasskey(username, {
 *   recoverySecret,
 *   deviceSalt: existingSalt || generatePrfSalt(),
 * });
 *
 * if (result.unlockMethod === 'prf') {
 *   // PRF worked - no need to store RS on device
 * } else {
 *   // RS was used - RS must be available for future unlocks
 * }
 * ```
 */

import { authenticateWithPasskey, isPrfExtensionSupported } from './passkey';
import type { PasskeyAuthenticationResult } from './passkey';
import {
  deriveKek,
  generateDeviceSalt,
  type DerivedKek,
  type DeviceSalt,
  type PrfOutput,
  type RecoverySecret,
  SALT_LENGTH,
  isValidKey,
  isValidSalt,
} from '../crypto/keys';
import { base64urlEncode, base64urlDecode } from '../crypto/utils';

// ============================================================================
// Types
// ============================================================================

/**
 * PRF salt specifically for WebAuthn PRF extension.
 * Must be 32 bytes. Stored per-device for consistent KEK derivation.
 */
export type PrfSalt = Uint8Array;

/**
 * Platform identifier for PRF capability detection
 */
export type PlatformType =
  | 'safari-ios'
  | 'safari-macos'
  | 'chrome-android'
  | 'chrome-desktop'
  | 'edge-desktop'
  | 'firefox'
  | 'unknown';

/**
 * Authentication method used for unlock
 */
export type UnlockMethod = 'prf' | 'rs';

/**
 * Detailed PRF capability information
 */
export interface PrfCapabilities {
  /** Browser supports WebAuthn at all */
  webAuthnSupported: boolean;
  /** Browser API has PRF extension support */
  prfApiAvailable: boolean;
  /** PRF is likely to work based on platform heuristics */
  prfLikelyAvailable: boolean;
  /** Detected platform type */
  platform: PlatformType;
  /** Platform-specific warnings about PRF behavior */
  warnings: string[];
  /** Whether to prefer PRF or RS for this platform */
  recommendedMethod: UnlockMethod;
}

/**
 * Options for unlocking with passkey
 */
export interface UnlockOptions {
  /** Recovery secret for RS-based KEK derivation (required for fallback) */
  recoverySecret: RecoverySecret;
  /** Existing device salt (if available from previous unlock) */
  deviceSalt?: DeviceSalt;
  /** PRF salt to use (if not provided, uses device salt) */
  prfSalt?: PrfSalt;
  /** Force a specific unlock method (for testing/recovery) */
  forceMethod?: UnlockMethod;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Device info for session tracking */
  deviceInfo?: string;
}

/**
 * Result from passkey unlock operation
 */
export interface UnlockResult {
  /** Method used for key derivation */
  unlockMethod: UnlockMethod;
  /** Derived KEK with metadata */
  kek: DerivedKek;
  /** Device salt used (save for future unlocks) */
  deviceSalt: DeviceSalt;
  /** PRF salt used (save for future unlocks, only if PRF worked) */
  prfSalt?: PrfSalt;
  /** Whether PRF was attempted and succeeded */
  prfSucceeded: boolean;
  /** Authentication result from passkey ceremony */
  authResult: PasskeyAuthenticationResult;
}

/**
 * Stored device credentials for unlock
 */
export interface StoredDeviceCredentials {
  /** Serialized device salt (base64url) */
  deviceSalt: string;
  /** Serialized PRF salt (base64url, if PRF was used) */
  prfSalt?: string;
  /** Method used on last successful unlock */
  lastUnlockMethod: UnlockMethod;
  /** User ID associated with these credentials */
  userId: string;
  /** Timestamp of last successful unlock */
  lastUnlockAt: number;
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when PRF extension fails
 */
export class PrfExtensionError extends Error {
  constructor(
    message: string,
    public readonly reason: 'not_supported' | 'authenticator_rejected' | 'no_output' | 'inconsistent'
  ) {
    super(message);
    this.name = 'PrfExtensionError';
  }
}

/**
 * Error thrown when unlock fails entirely (both PRF and RS)
 */
export class UnlockFailedError extends Error {
  constructor(
    message: string,
    public readonly prfError?: Error,
    public readonly rsError?: Error
  ) {
    super(message);
    this.name = 'UnlockFailedError';
  }
}

// ============================================================================
// Platform Detection
// ============================================================================

/**
 * Detects the current platform for PRF capability assessment.
 *
 * @returns Detected platform type
 *
 * @internal
 */
export function detectPlatform(): PlatformType {
  if (typeof navigator === 'undefined') {
    return 'unknown';
  }

  const ua = navigator.userAgent;
  const platform = navigator.platform || '';

  // iOS Safari (includes iPad)
  if (/iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    // iPad on iOS 13+ reports as MacIntel
    if (/Safari/.test(ua) && !/Chrome/.test(ua) && !/CriOS/.test(ua)) {
      return 'safari-ios';
    }
    // Chrome on iOS uses WebKit, but PRF behavior may differ
    return 'safari-ios'; // All iOS browsers use Safari's WebKit
  }

  // macOS Safari
  if (/Mac/.test(platform) && /Safari/.test(ua) && !/Chrome/.test(ua)) {
    return 'safari-macos';
  }

  // Android Chrome
  if (/Android/.test(ua)) {
    if (/Chrome/.test(ua) && !/Edge/.test(ua)) {
      return 'chrome-android';
    }
    // Other Android browsers - treat as Chrome-like for PRF
    return 'chrome-android';
  }

  // Desktop Chrome
  if (/Chrome/.test(ua) && !/Edge/.test(ua)) {
    return 'chrome-desktop';
  }

  // Desktop Edge
  if (/Edge/.test(ua) || /Edg\//.test(ua)) {
    return 'edge-desktop';
  }

  // Firefox (limited PRF support)
  if (/Firefox/.test(ua)) {
    return 'firefox';
  }

  return 'unknown';
}

/**
 * Detects Safari version to check for iOS 18 bugs.
 *
 * @returns Safari version number or null if not Safari
 *
 * @internal
 */
function detectSafariVersion(): number | null {
  if (typeof navigator === 'undefined') {
    return null;
  }

  const match = navigator.userAgent.match(/Version\/(\d+)/);
  if (match) {
    return parseInt(match[1], 10);
  }

  return null;
}

// ============================================================================
// PRF Capability Detection
// ============================================================================

/**
 * Assesses PRF extension capabilities for the current browser and platform.
 * This provides detailed information about PRF support and platform-specific warnings.
 *
 * @returns Promise resolving to detailed PRF capability information
 *
 * @example
 * ```typescript
 * const caps = await getPrfCapabilities();
 *
 * if (!caps.webAuthnSupported) {
 *   showError('Passkeys are not supported in this browser');
 *   return;
 * }
 *
 * if (caps.warnings.length > 0) {
 *   console.warn('PRF warnings:', caps.warnings);
 * }
 *
 * if (caps.recommendedMethod === 'rs') {
 *   // PRF not reliable on this platform, use recovery secret
 * }
 * ```
 */
export async function getPrfCapabilities(): Promise<PrfCapabilities> {
  const platform = detectPlatform();
  const warnings: string[] = [];

  // Check basic WebAuthn support
  const webAuthnSupported =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials !== 'undefined' &&
    typeof PublicKeyCredential !== 'undefined';

  if (!webAuthnSupported) {
    return {
      webAuthnSupported: false,
      prfApiAvailable: false,
      prfLikelyAvailable: false,
      platform,
      warnings: ['WebAuthn is not supported in this browser'],
      recommendedMethod: 'rs',
    };
  }

  // Check PRF API availability
  const prfApiAvailable = isPrfExtensionSupported();

  // Platform-specific PRF availability assessment
  let prfLikelyAvailable = prfApiAvailable;
  let recommendedMethod: UnlockMethod = 'prf';

  switch (platform) {
    case 'safari-ios': {
      // iOS Safari: PRF only works with iCloud Keychain passkeys
      warnings.push('PRF only works with iCloud Keychain passkeys on iOS');
      warnings.push('Hardware security keys (YubiKey) do not support PRF on iOS');

      // Check for iOS 18 bugs
      const safariVersion = detectSafariVersion();
      if (safariVersion !== null && safariVersion >= 18 && safariVersion < 19) {
        warnings.push('iOS 18 has known PRF bugs - values may be inconsistent');
        // Still attempt PRF but be ready for fallback
      }

      // Cross-device auth via QR is unreliable for PRF
      warnings.push('Cross-device QR authentication may not provide consistent PRF values');

      // PRF is available but with caveats
      prfLikelyAvailable = prfApiAvailable;
      recommendedMethod = 'prf'; // Still try PRF first, with RS fallback
      break;
    }

    case 'safari-macos': {
      // macOS Safari: Similar to iOS, PRF works with iCloud Keychain
      warnings.push('PRF works best with iCloud Keychain passkeys on macOS');
      warnings.push('Hardware security keys may have limited PRF support');

      prfLikelyAvailable = prfApiAvailable;
      recommendedMethod = 'prf';
      break;
    }

    case 'chrome-android': {
      // Android Chrome: Robust PRF support
      prfLikelyAvailable = prfApiAvailable;
      recommendedMethod = 'prf';
      // No specific warnings for Android
      break;
    }

    case 'chrome-desktop':
    case 'edge-desktop': {
      // Desktop Chrome/Edge: Good PRF support with platform authenticators
      prfLikelyAvailable = prfApiAvailable;
      recommendedMethod = 'prf';
      break;
    }

    case 'firefox': {
      // Firefox: Limited PRF support
      warnings.push('Firefox has limited PRF extension support');
      prfLikelyAvailable = false; // Don't attempt PRF on Firefox
      recommendedMethod = 'rs';
      break;
    }

    default: {
      // Unknown platform: Be conservative
      warnings.push('Unknown browser/platform - PRF support uncertain');
      prfLikelyAvailable = prfApiAvailable;
      recommendedMethod = prfApiAvailable ? 'prf' : 'rs';
    }
  }

  return {
    webAuthnSupported,
    prfApiAvailable,
    prfLikelyAvailable,
    platform,
    warnings,
    recommendedMethod,
  };
}

// ============================================================================
// PRF Salt Management
// ============================================================================

/**
 * Generates a new 32-byte PRF salt for WebAuthn PRF extension.
 * This salt is used in the PRF eval request and should be stored per-device.
 *
 * @returns 32-byte random salt
 * @throws Error if Web Crypto API is not available
 *
 * @example
 * ```typescript
 * // Generate a new PRF salt for first-time setup
 * const prfSalt = generatePrfSalt();
 * localStorage.setItem('prf_salt', serializePrfSalt(prfSalt));
 * ```
 */
export function generatePrfSalt(): PrfSalt {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('Web Crypto API not available');
  }

  const salt = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(salt);
  return salt;
}

/**
 * Validates a PRF salt.
 *
 * @param salt - Salt to validate
 * @returns true if salt is valid (32-byte Uint8Array)
 */
export function isValidPrfSalt(salt: unknown): salt is PrfSalt {
  return salt instanceof Uint8Array && salt.length === SALT_LENGTH;
}

/**
 * Serializes a PRF salt for storage.
 *
 * @param salt - The 32-byte PRF salt
 * @returns Base64url encoded string
 */
export function serializePrfSalt(salt: PrfSalt): string {
  if (!isValidPrfSalt(salt)) {
    throw new Error('Invalid PRF salt: must be a 32-byte Uint8Array');
  }
  return base64urlEncode(salt);
}

/**
 * Deserializes a PRF salt from storage.
 *
 * @param data - Base64url encoded string
 * @returns The 32-byte PRF salt
 * @throws Error if data is invalid
 */
export function deserializePrfSalt(data: string): PrfSalt {
  if (typeof data !== 'string') {
    throw new Error('Invalid PRF salt data: must be a string');
  }

  const salt = base64urlDecode(data);
  if (!isValidPrfSalt(salt)) {
    throw new Error('Invalid PRF salt data: must decode to 32 bytes');
  }

  return salt;
}

// ============================================================================
// Device Credentials Storage
// ============================================================================

/**
 * Serializes device credentials for storage.
 *
 * @param credentials - The credentials to serialize
 * @returns JSON string for storage
 */
export function serializeDeviceCredentials(credentials: StoredDeviceCredentials): string {
  return JSON.stringify(credentials);
}

/**
 * Deserializes device credentials from storage.
 *
 * @param data - JSON string from storage
 * @returns Parsed credentials
 * @throws Error if data is invalid
 */
export function deserializeDeviceCredentials(data: string): StoredDeviceCredentials {
  if (typeof data !== 'string') {
    throw new Error('Invalid credentials data: must be a string');
  }

  try {
    const parsed = JSON.parse(data) as StoredDeviceCredentials;

    // Validate required fields
    if (typeof parsed.deviceSalt !== 'string') {
      throw new Error('Missing deviceSalt');
    }
    if (parsed.lastUnlockMethod !== 'prf' && parsed.lastUnlockMethod !== 'rs') {
      throw new Error('Invalid lastUnlockMethod');
    }
    if (typeof parsed.userId !== 'string') {
      throw new Error('Missing userId');
    }
    if (typeof parsed.lastUnlockAt !== 'number') {
      throw new Error('Missing lastUnlockAt');
    }

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid credentials data: malformed JSON');
    }
    throw error;
  }
}

/**
 * Creates stored device credentials from an unlock result.
 *
 * @param result - The unlock result
 * @param userId - The user ID
 * @returns Credentials object ready for storage
 */
export function createStoredCredentials(
  result: UnlockResult,
  userId: string
): StoredDeviceCredentials {
  return {
    deviceSalt: base64urlEncode(result.deviceSalt),
    prfSalt: result.prfSalt ? base64urlEncode(result.prfSalt) : undefined,
    lastUnlockMethod: result.unlockMethod,
    userId,
    lastUnlockAt: Date.now(),
  };
}

// ============================================================================
// Unified Unlock Flow
// ============================================================================

/**
 * Authenticates with passkey and derives KEK with automatic fallback.
 * This is the main entry point for unlocking the app.
 *
 * The function:
 * 1. Checks PRF capabilities for the current platform
 * 2. Attempts authentication with PRF if available and not forced to RS
 * 3. Derives KEK from PRF output if available, or falls back to RS
 * 4. Returns the KEK and metadata for database unlock
 *
 * @param username - The username for authentication
 * @param options - Unlock options including recovery secret
 * @returns Promise resolving to unlock result with KEK
 * @throws {UnlockFailedError} If both PRF and RS derivation fail
 *
 * @example
 * ```typescript
 * // Basic unlock with automatic method selection
 * const result = await unlockWithPasskey('user@example.com', {
 *   recoverySecret: savedRecoverySecret,
 * });
 *
 * // Use the KEK to unlock the database
 * const dek = await unwrapDek(wrappedDek, result.kek.key);
 *
 * // Save credentials for next unlock
 * const creds = createStoredCredentials(result, result.authResult.userId);
 * localStorage.setItem('device_creds', serializeDeviceCredentials(creds));
 * ```
 */
export async function unlockWithPasskey(
  username: string,
  options: UnlockOptions
): Promise<UnlockResult> {
  // Validate inputs
  if (!username || typeof username !== 'string') {
    throw new Error('Username is required');
  }

  if (!options.recoverySecret || !isValidKey(options.recoverySecret)) {
    throw new Error('Valid recovery secret is required for fallback');
  }

  // Determine the device salt to use
  const deviceSalt = options.deviceSalt ?? generateDeviceSalt();

  // Determine the PRF salt to use (defaults to device salt if not provided)
  const prfSalt = options.prfSalt ?? deviceSalt;

  // Check PRF capabilities
  const capabilities = await getPrfCapabilities();

  // Determine whether to attempt PRF
  const shouldAttemptPrf =
    options.forceMethod !== 'rs' &&
    capabilities.prfLikelyAvailable &&
    capabilities.webAuthnSupported;

  let authResult: PasskeyAuthenticationResult;
  let prfOutput: PrfOutput | undefined;
  let prfSucceeded = false;
  let prfError: Error | undefined;

  try {
    // Attempt authentication with or without PRF
    authResult = await authenticateWithPasskey(username, {
      prfSalt: shouldAttemptPrf ? prfSalt : undefined,
      signal: options.signal,
      deviceInfo: options.deviceInfo,
    });

    // Check if PRF succeeded
    if (shouldAttemptPrf && authResult.prfSupported && authResult.prfOutput) {
      prfOutput = authResult.prfOutput;
      prfSucceeded = true;
    } else if (shouldAttemptPrf && !authResult.prfSupported) {
      // PRF was requested but authenticator didn't support it
      prfError = new PrfExtensionError(
        'Authenticator does not support PRF extension',
        'authenticator_rejected'
      );
    } else if (shouldAttemptPrf && !authResult.prfOutput) {
      // PRF was supported but no output received (unusual)
      prfError = new PrfExtensionError(
        'PRF was supported but returned no output',
        'no_output'
      );
    }
  } catch (error) {
    // Authentication failed entirely
    throw new UnlockFailedError(
      `Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      undefined,
      error instanceof Error ? error : undefined
    );
  }

  // Derive KEK with automatic fallback
  let kek: DerivedKek;
  let unlockMethod: UnlockMethod;
  let rsError: Error | undefined;

  try {
    // deriveKek handles PRF-to-RS fallback internally
    kek = await deriveKek(
      options.forceMethod === 'rs' ? null : prfOutput,
      options.recoverySecret,
      deviceSalt
    );
    unlockMethod = kek.source;
  } catch (error) {
    rsError = error instanceof Error ? error : new Error('Unknown error');
    throw new UnlockFailedError(
      'Failed to derive key encryption key',
      prfError,
      rsError
    );
  }

  return {
    unlockMethod,
    kek,
    deviceSalt,
    prfSalt: prfSucceeded ? prfSalt : undefined,
    prfSucceeded,
    authResult,
  };
}

/**
 * Re-attempts unlock with forced RS method after PRF failure.
 * Use this when PRF unlock failed and you want to try RS explicitly.
 *
 * @param username - The username for authentication
 * @param options - Unlock options (forceMethod will be set to 'rs')
 * @returns Promise resolving to unlock result with KEK
 *
 * @example
 * ```typescript
 * try {
 *   const result = await unlockWithPasskey(username, options);
 * } catch (error) {
 *   if (error instanceof UnlockFailedError && error.prfError) {
 *     // PRF failed, retry with RS
 *     const rsResult = await forceRecoverySecretUnlock(username, options);
 *   }
 * }
 * ```
 */
export async function forceRecoverySecretUnlock(
  username: string,
  options: Omit<UnlockOptions, 'forceMethod'>
): Promise<UnlockResult> {
  return unlockWithPasskey(username, {
    ...options,
    forceMethod: 'rs',
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Checks if the last unlock used PRF or RS.
 * Useful for displaying the unlock method to users.
 *
 * @param credentials - Stored device credentials
 * @returns The unlock method used
 */
export function getLastUnlockMethod(credentials: StoredDeviceCredentials): UnlockMethod {
  return credentials.lastUnlockMethod;
}

/**
 * Checks if PRF is recommended for the current platform.
 * This is a convenience function that checks capabilities and returns a simple boolean.
 *
 * @returns Promise resolving to true if PRF is recommended
 */
export async function isPrfRecommended(): Promise<boolean> {
  const capabilities = await getPrfCapabilities();
  return capabilities.recommendedMethod === 'prf' && capabilities.prfLikelyAvailable;
}

/**
 * Gets platform-specific PRF warnings for display to users.
 *
 * @returns Promise resolving to array of warning messages
 */
export async function getPrfWarnings(): Promise<string[]> {
  const capabilities = await getPrfCapabilities();
  return capabilities.warnings;
}

/**
 * Determines the storage key for device credentials.
 * Uses a consistent naming pattern for localStorage.
 *
 * @param userId - Optional user ID for multi-user scenarios
 * @returns Storage key string
 */
export function getCredentialsStorageKey(userId?: string): string {
  if (userId) {
    return `tricho:device_creds:${userId}`;
  }
  return 'tricho:device_creds';
}

/**
 * Loads stored device credentials from localStorage.
 *
 * @param userId - Optional user ID for multi-user scenarios
 * @returns Stored credentials or null if not found
 */
export function loadStoredCredentials(userId?: string): StoredDeviceCredentials | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  const key = getCredentialsStorageKey(userId);
  const data = localStorage.getItem(key);

  if (!data) {
    return null;
  }

  try {
    return deserializeDeviceCredentials(data);
  } catch {
    // Invalid stored data - clear it
    localStorage.removeItem(key);
    return null;
  }
}

/**
 * Saves device credentials to localStorage.
 *
 * @param credentials - The credentials to save
 */
export function saveStoredCredentials(credentials: StoredDeviceCredentials): void {
  if (typeof localStorage === 'undefined') {
    throw new Error('localStorage not available');
  }

  const key = getCredentialsStorageKey(credentials.userId);
  localStorage.setItem(key, serializeDeviceCredentials(credentials));
}

/**
 * Clears stored device credentials from localStorage.
 *
 * @param userId - Optional user ID for multi-user scenarios
 */
export function clearStoredCredentials(userId?: string): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  const key = getCredentialsStorageKey(userId);
  localStorage.removeItem(key);
}
