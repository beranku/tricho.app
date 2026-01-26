// Key generation module for TrichoApp E2EE
// Implements key hierarchy: RS (Recovery Secret), DEK (Data Encryption Key), KEK (Key Encryption Key)

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

/**
 * Key byte length constants
 * All keys are 256-bit (32 bytes) for AES-256
 */
export const KEY_LENGTH = 32;

/**
 * Salt length for HKDF derivation
 * Using 32 bytes for sufficient entropy
 */
export const SALT_LENGTH = 32;

/**
 * HKDF info strings for domain separation
 * These ensure keys derived for different purposes are cryptographically independent
 */
export const HKDF_INFO = {
  KEK_FROM_PRF: 'tricho:kek:prf:v1',
  KEK_FROM_RS: 'tricho:kek:rs:v1',
} as const;

/**
 * Recovery Secret (RS)
 * The ultimate recovery mechanism - 32 bytes of cryptographically random data.
 * User must save this (typically as QR code) for account recovery.
 */
export type RecoverySecret = Uint8Array;

/**
 * Data Encryption Key (DEK)
 * Used by RxDB for database-level encryption.
 * Wrapped per-device with KEK for storage.
 */
export type DataEncryptionKey = Uint8Array;

/**
 * Device Salt
 * A per-device random value used in KEK derivation.
 * Stored locally alongside the wrapped DEK.
 */
export type DeviceSalt = Uint8Array;

/**
 * PRF Output from WebAuthn PRF extension
 * 32 bytes of deterministic output derived from the passkey
 */
export type PrfOutput = Uint8Array;

/**
 * Key Encryption Key (KEK) derivation source
 * Indicates how the KEK was derived for this device
 */
export type KekSource = 'prf' | 'rs';

/**
 * Result of key generation during first-time setup
 */
export interface GeneratedKeys {
  recoverySecret: RecoverySecret;
  dataEncryptionKey: DataEncryptionKey;
}

/**
 * Result of KEK derivation
 * Contains the CryptoKey and metadata about how it was derived
 */
export interface DerivedKek {
  key: CryptoKey;
  source: KekSource;
  deviceSalt: DeviceSalt;
}

/**
 * Validates that a key has the correct length
 */
export function isValidKey(key: Uint8Array): boolean {
  return key instanceof Uint8Array && key.length === KEY_LENGTH;
}

/**
 * Validates that a salt has the correct length
 */
export function isValidSalt(salt: Uint8Array): boolean {
  return salt instanceof Uint8Array && salt.length === SALT_LENGTH;
}

/**
 * Generates a random device salt for KEK derivation.
 * This salt should be stored locally alongside the wrapped DEK.
 *
 * @returns 32 bytes of cryptographically random data
 * @throws Error if Web Crypto API is not available
 */
export function generateDeviceSalt(): DeviceSalt {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('Web Crypto API not available');
  }

  const salt = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(salt);
  return salt;
}

/**
 * Derives a KEK (Key Encryption Key) from PRF output.
 * This is the preferred method when the WebAuthn PRF extension is supported.
 *
 * PRF provides deterministic output tied to the passkey, enabling
 * "stateless" key derivation where the KEK can be recreated from
 * just the passkey without storing any secret material.
 *
 * @param prfOutput - 32 bytes from WebAuthn PRF extension
 * @param deviceSalt - Device-specific salt for domain separation
 * @returns Promise resolving to a CryptoKey suitable for AES-GCM wrapping
 * @throws Error if inputs are invalid or Web Crypto API unavailable
 */
export async function deriveKekFromPRF(
  prfOutput: PrfOutput,
  deviceSalt: DeviceSalt
): Promise<CryptoKey> {
  if (!isValidKey(prfOutput)) {
    throw new Error('Invalid PRF output: must be a 32-byte Uint8Array');
  }
  if (!isValidSalt(deviceSalt)) {
    throw new Error('Invalid device salt: must be a 32-byte Uint8Array');
  }

  // Use HKDF to derive 32 bytes for AES-256
  // Info string provides domain separation for this specific use case
  const kekBytes = hkdf(
    sha256,
    prfOutput,
    deviceSalt,
    HKDF_INFO.KEK_FROM_PRF,
    KEY_LENGTH
  );

  // Import as CryptoKey for AES-GCM wrapping operations
  return crypto.subtle.importKey(
    'raw',
    kekBytes,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable - security best practice
    ['wrapKey', 'unwrapKey']
  );
}

/**
 * Derives a KEK (Key Encryption Key) from the Recovery Secret.
 * This is the fallback method when PRF is not supported.
 *
 * When PRF is unavailable (e.g., Safari with hardware keys, some older
 * platforms), we fall back to deriving the KEK from the Recovery Secret.
 * This means the RS must be stored securely on the device (encrypted
 * or in secure storage) for the KEK to be recreated.
 *
 * @param recoverySecret - The user's 32-byte recovery secret
 * @param deviceSalt - Device-specific salt for domain separation
 * @returns Promise resolving to a CryptoKey suitable for AES-GCM wrapping
 * @throws Error if inputs are invalid or Web Crypto API unavailable
 */
export async function deriveKekFromRS(
  recoverySecret: RecoverySecret,
  deviceSalt: DeviceSalt
): Promise<CryptoKey> {
  if (!isValidKey(recoverySecret)) {
    throw new Error('Invalid recovery secret: must be a 32-byte Uint8Array');
  }
  if (!isValidSalt(deviceSalt)) {
    throw new Error('Invalid device salt: must be a 32-byte Uint8Array');
  }

  // Use HKDF to derive 32 bytes for AES-256
  // Different info string than PRF path for domain separation
  const kekBytes = hkdf(
    sha256,
    recoverySecret,
    deviceSalt,
    HKDF_INFO.KEK_FROM_RS,
    KEY_LENGTH
  );

  // Import as CryptoKey for AES-GCM wrapping operations
  return crypto.subtle.importKey(
    'raw',
    kekBytes,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable - security best practice
    ['wrapKey', 'unwrapKey']
  );
}

/**
 * Derives a KEK with automatic fallback from PRF to RS.
 * This is the main entry point for KEK derivation during authentication.
 *
 * The function first attempts to use PRF output if provided and valid.
 * If PRF is not available (null/undefined), it falls back to RS derivation.
 *
 * @param prfOutput - PRF output from WebAuthn, or null if PRF not supported
 * @param recoverySecret - The user's recovery secret (required for fallback)
 * @param deviceSalt - Device-specific salt (can be generated if not provided)
 * @returns Promise resolving to derived KEK with metadata
 * @throws Error if neither PRF nor RS can derive a valid KEK
 */
export async function deriveKek(
  prfOutput: PrfOutput | null | undefined,
  recoverySecret: RecoverySecret,
  deviceSalt?: DeviceSalt
): Promise<DerivedKek> {
  // Generate device salt if not provided
  const salt = deviceSalt ?? generateDeviceSalt();

  // Attempt PRF-based derivation first (preferred)
  if (prfOutput && isValidKey(prfOutput)) {
    const key = await deriveKekFromPRF(prfOutput, salt);
    return { key, source: 'prf', deviceSalt: salt };
  }

  // Fall back to RS-based derivation
  if (!isValidKey(recoverySecret)) {
    throw new Error(
      'Cannot derive KEK: PRF not available and recovery secret is invalid'
    );
  }

  const key = await deriveKekFromRS(recoverySecret, salt);
  return { key, source: 'rs', deviceSalt: salt };
}

/**
 * Generates a cryptographically secure 32-byte Recovery Secret (RS).
 * This should be displayed as a QR code for the user to save.
 *
 * @returns 32 bytes of cryptographically random data
 * @throws Error if crypto.getRandomValues is not available
 */
export function generateRecoverySecret(): RecoverySecret {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('Web Crypto API not available');
  }

  const rs = new Uint8Array(KEY_LENGTH);
  crypto.getRandomValues(rs);
  return rs;
}

/**
 * Generates a cryptographically secure 32-byte Data Encryption Key (DEK).
 * This key is used to encrypt all data in RxDB.
 * Should be wrapped with KEK before storage.
 *
 * @returns 32 bytes of cryptographically random data
 * @throws Error if crypto.getRandomValues is not available
 */
export function generateDataEncryptionKey(): DataEncryptionKey {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('Web Crypto API not available');
  }

  const dek = new Uint8Array(KEY_LENGTH);
  crypto.getRandomValues(dek);
  return dek;
}

/**
 * Generates all keys needed for first-time account setup.
 * Creates a new Recovery Secret (RS) and Data Encryption Key (DEK).
 *
 * @returns Object containing recoverySecret and dataEncryptionKey
 * @throws Error if crypto.getRandomValues is not available
 */
export function generateInitialKeys(): GeneratedKeys {
  return {
    recoverySecret: generateRecoverySecret(),
    dataEncryptionKey: generateDataEncryptionKey(),
  };
}

/**
 * Securely clears a key from memory by overwriting with zeros.
 * Note: This is a best-effort operation; JavaScript does not guarantee
 * immediate memory clearing, but it reduces the window of exposure.
 *
 * @param key The key to clear
 */
export function clearKey(key: Uint8Array): void {
  if (key instanceof Uint8Array) {
    key.fill(0);
  }
}

/**
 * Creates a copy of a key.
 * Useful when you need to pass a key to a function that may modify it.
 *
 * @param key The key to copy
 * @returns A new Uint8Array with the same contents
 */
export function copyKey(key: Uint8Array): Uint8Array {
  if (!isValidKey(key)) {
    throw new Error('Invalid key: must be a 32-byte Uint8Array');
  }
  return new Uint8Array(key);
}

/**
 * Compares two keys for equality in constant time.
 * This prevents timing attacks when comparing secret values.
 *
 * @param a First key to compare
 * @param b Second key to compare
 * @returns true if keys are equal, false otherwise
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }

  return result === 0;
}
