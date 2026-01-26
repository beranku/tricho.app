// Key generation module for TrichoApp E2EE
// Implements key hierarchy: RS (Recovery Secret), DEK (Data Encryption Key)

/**
 * Key byte length constants
 * All keys are 256-bit (32 bytes) for AES-256
 */
export const KEY_LENGTH = 32;

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
 * Result of key generation during first-time setup
 */
export interface GeneratedKeys {
  recoverySecret: RecoverySecret;
  dataEncryptionKey: DataEncryptionKey;
}

/**
 * Validates that a key has the correct length
 */
export function isValidKey(key: Uint8Array): boolean {
  return key instanceof Uint8Array && key.length === KEY_LENGTH;
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
