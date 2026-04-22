/**
 * Envelope encryption utilities
 *
 * This module provides low-level encryption primitives for envelope encryption
 * using Web Crypto API with AES-256-GCM. These utilities are used by the payload
 * module for RxDB document encryption.
 *
 * Security considerations:
 * - Uses AES-256-GCM for authenticated encryption
 * - Random 12-byte IV generated for each encryption
 * - IV must never be reused with the same key
 * - Tag length is 128 bits (built into AES-GCM)
 */

/** Version string for domain separation */
export const ENVELOPE_VERSION = 'v1';

/** AES-GCM configuration */
export const AES_GCM_CONFIG = {
  /** Algorithm name */
  name: 'AES-GCM',
  /** Key length in bits */
  keyLength: 256,
  /** IV length in bytes (96 bits per NIST recommendation) */
  ivLength: 12,
  /** Tag length in bits */
  tagLength: 128,
  /** Algorithm identifier string */
  algId: 'AES-256-GCM',
} as const;

/**
 * Result of an envelope encryption operation
 */
export interface EnvelopeEncryptResult {
  /** Ciphertext (Base64url encoded) */
  ct: string;
  /** Initialization vector (Base64url encoded) */
  iv: string;
}

/**
 * Base64url alphabet
 * URL-safe variant: uses - and _ instead of + and /
 */
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Encodes bytes to Base64url string (no padding)
 *
 * @param bytes - Uint8Array to encode
 * @returns Base64url encoded string without padding
 */
export function encodeBase64url(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return '';
  }

  let result = '';
  let buffer = 0;
  let bitsLeft = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;

    while (bitsLeft >= 6) {
      bitsLeft -= 6;
      result += BASE64URL_ALPHABET[(buffer >> bitsLeft) & 0x3f];
    }
  }

  // Handle remaining bits (pad to 6 bits)
  if (bitsLeft > 0) {
    result += BASE64URL_ALPHABET[(buffer << (6 - bitsLeft)) & 0x3f];
  }

  return result;
}

/**
 * Decodes Base64url string to bytes
 *
 * @param encoded - Base64url encoded string (with or without padding)
 * @returns Decoded Uint8Array
 * @throws Error if input contains invalid characters
 */
export function decodeBase64url(encoded: string): Uint8Array {
  if (encoded.length === 0) {
    return new Uint8Array(0);
  }

  // Remove padding if present
  const normalized = encoded.replace(/=+$/, '');

  const result: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;

  for (const char of normalized) {
    const value = BASE64URL_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error(`Invalid Base64url character: ${char}`);
    }

    buffer = (buffer << 6) | value;
    bitsLeft += 6;

    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      result.push((buffer >> bitsLeft) & 0xff);
    }
  }

  return new Uint8Array(result);
}

/**
 * Generates a random initialization vector for AES-GCM
 *
 * Uses crypto.getRandomValues for cryptographically secure randomness.
 *
 * @returns 12-byte random IV as Uint8Array
 */
export function generateIv(): Uint8Array {
  const iv = new Uint8Array(AES_GCM_CONFIG.ivLength);
  crypto.getRandomValues(iv);
  return iv;
}

/**
 * Encrypts data using AES-GCM with the provided key
 *
 * @param key - CryptoKey for AES-GCM encryption (must have 'encrypt' usage)
 * @param plaintext - Data to encrypt as Uint8Array
 * @param additionalData - Optional AAD (Additional Authenticated Data)
 * @returns Promise resolving to EnvelopeEncryptResult with Base64url-encoded ct and iv
 * @throws Error if encryption fails
 */
export async function envelopeEncrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
  additionalData?: Uint8Array
): Promise<EnvelopeEncryptResult> {
  // Generate random IV
  const iv = generateIv();

  // Build algorithm parameters
  const algorithm: AesGcmParams = {
    name: AES_GCM_CONFIG.name,
    iv: iv as BufferSource,
    tagLength: AES_GCM_CONFIG.tagLength,
  };

  // Add AAD if provided
  if (additionalData) {
    algorithm.additionalData = additionalData as BufferSource;
  }

  // Perform encryption
  const ciphertextBuffer = await crypto.subtle.encrypt(algorithm, key, plaintext as BufferSource);
  const ciphertext = new Uint8Array(ciphertextBuffer);

  return {
    ct: encodeBase64url(ciphertext),
    iv: encodeBase64url(iv),
  };
}

/**
 * Decrypts data using AES-GCM with the provided key
 *
 * @param key - CryptoKey for AES-GCM decryption (must have 'decrypt' usage)
 * @param ciphertextBase64url - Ciphertext as Base64url string
 * @param ivBase64url - IV as Base64url string
 * @param additionalData - Optional AAD (must match what was used during encryption)
 * @returns Promise resolving to decrypted data as Uint8Array
 * @throws Error if decryption fails (wrong key, tampered data, wrong AAD)
 */
export async function envelopeDecrypt(
  key: CryptoKey,
  ciphertextBase64url: string,
  ivBase64url: string,
  additionalData?: Uint8Array
): Promise<Uint8Array> {
  // Decode Base64url inputs
  const ciphertext = decodeBase64url(ciphertextBase64url);
  const iv = decodeBase64url(ivBase64url);

  // Validate IV length
  if (iv.length !== AES_GCM_CONFIG.ivLength) {
    throw new Error(`Invalid IV length: expected ${AES_GCM_CONFIG.ivLength}, got ${iv.length}`);
  }

  // Build algorithm parameters
  const algorithm: AesGcmParams = {
    name: AES_GCM_CONFIG.name,
    iv: iv as BufferSource,
    tagLength: AES_GCM_CONFIG.tagLength,
  };

  // Add AAD if provided
  if (additionalData) {
    algorithm.additionalData = additionalData as BufferSource;
  }

  // Perform decryption
  const plaintextBuffer = await crypto.subtle.decrypt(algorithm, key, ciphertext as BufferSource);
  return new Uint8Array(plaintextBuffer);
}

/**
 * Encodes a string as UTF-8 bytes
 *
 * @param str - String to encode
 * @returns UTF-8 encoded Uint8Array
 */
export function encodeUtf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Decodes UTF-8 bytes to a string
 *
 * @param bytes - UTF-8 encoded Uint8Array
 * @returns Decoded string
 */
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Imports a raw key for AES-GCM operations
 *
 * @param rawKey - Raw key bytes (must be 32 bytes for AES-256)
 * @param extractable - Whether the key can be exported (default: false for security)
 * @param usages - Key usages (default: encrypt and decrypt)
 * @returns Promise resolving to CryptoKey
 * @throws Error if key length is invalid
 */
export async function importAesGcmKey(
  rawKey: Uint8Array,
  extractable: boolean = false,
  usages: KeyUsage[] = ['encrypt', 'decrypt']
): Promise<CryptoKey> {
  if (rawKey.length !== AES_GCM_CONFIG.keyLength / 8) {
    throw new Error(
      `Invalid key length: expected ${AES_GCM_CONFIG.keyLength / 8} bytes, got ${rawKey.length}`
    );
  }

  return crypto.subtle.importKey(
    'raw',
    rawKey as BufferSource,
    { name: AES_GCM_CONFIG.name, length: AES_GCM_CONFIG.keyLength },
    extractable,
    usages
  );
}

/**
 * Generates a random AES-256 key for testing purposes
 *
 * @param extractable - Whether the key can be exported (default: true for testing)
 * @returns Promise resolving to CryptoKey
 */
export async function generateAesGcmKey(extractable: boolean = true): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: AES_GCM_CONFIG.name, length: AES_GCM_CONFIG.keyLength },
    extractable,
    ['encrypt', 'decrypt']
  );
}

/**
 * Exports a CryptoKey to raw bytes
 *
 * @param key - CryptoKey to export (must be extractable)
 * @returns Promise resolving to raw key bytes as Uint8Array
 * @throws Error if key is not extractable
 */
export async function exportAesGcmKey(key: CryptoKey): Promise<Uint8Array> {
  const rawBuffer = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(rawBuffer);
}

/**
 * Securely compares two byte arrays in constant time
 *
 * This prevents timing attacks when comparing sensitive data like MACs.
 *
 * @param a - First byte array
 * @param b - Second byte array
 * @returns true if arrays are equal, false otherwise
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
