// Crypto utility functions for TrichoApp
// Provides base64url encoding/decoding for key and password conversion
// Reference: spec.md - RxDB Database Initialization Pattern

import { KEY_LENGTH, isValidKey } from './keys';

/**
 * Base64url character set (URL-safe Base64)
 * Uses - instead of + and _ instead of /
 * No padding characters (=) are used
 */
const BASE64URL_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Lookup table for base64url decoding
 * Maps character code to value (0-63)
 * Invalid characters map to -1
 */
const BASE64URL_DECODE_LOOKUP: Int8Array = (() => {
  const lookup = new Int8Array(128).fill(-1);
  for (let i = 0; i < BASE64URL_CHARS.length; i++) {
    lookup[BASE64URL_CHARS.charCodeAt(i)] = i;
  }
  return lookup;
})();

/**
 * Encodes a Uint8Array to a base64url string.
 * Base64url is URL-safe and does not include padding.
 *
 * This is used to:
 * - Convert DEK to string for RxDB password
 * - Encode Recovery Secret for QR code display
 * - Encode any binary data for safe transport/storage
 *
 * @param bytes - The bytes to encode
 * @returns Base64url encoded string (no padding)
 * @throws Error if input is not a Uint8Array
 */
export function base64urlEncode(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('Input must be a Uint8Array');
  }

  if (bytes.length === 0) {
    return '';
  }

  // Calculate output length (no padding)
  // Each 3 bytes becomes 4 characters
  const outputLength = Math.ceil((bytes.length * 4) / 3);
  const chars: string[] = new Array(outputLength);
  let charIndex = 0;

  // Process 3 bytes at a time
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    chars[charIndex++] = BASE64URL_CHARS[b0 >> 2];
    chars[charIndex++] = BASE64URL_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
    chars[charIndex++] = BASE64URL_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)];
    chars[charIndex++] = BASE64URL_CHARS[b2 & 0x3f];
  }

  // Handle remaining bytes (1 or 2)
  if (i < bytes.length) {
    const b0 = bytes[i];
    chars[charIndex++] = BASE64URL_CHARS[b0 >> 2];

    if (i + 1 < bytes.length) {
      // 2 remaining bytes
      const b1 = bytes[i + 1];
      chars[charIndex++] = BASE64URL_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
      chars[charIndex++] = BASE64URL_CHARS[(b1 & 0x0f) << 2];
    } else {
      // 1 remaining byte
      chars[charIndex++] = BASE64URL_CHARS[(b0 & 0x03) << 4];
    }
  }

  return chars.join('');
}

/**
 * Decodes a base64url string to a Uint8Array.
 * Handles both padded and unpadded input.
 *
 * This is used to:
 * - Parse Recovery Secret from QR code scan
 * - Convert stored base64url strings back to binary
 *
 * @param str - The base64url encoded string
 * @returns Decoded bytes as Uint8Array
 * @throws Error if input contains invalid characters
 */
export function base64urlDecode(str: string): Uint8Array {
  if (typeof str !== 'string') {
    throw new Error('Input must be a string');
  }

  // Remove any padding characters (for compatibility)
  str = str.replace(/=+$/, '');

  if (str.length === 0) {
    return new Uint8Array(0);
  }

  // Calculate output length
  // Every 4 characters becomes 3 bytes (with remainder handling)
  const outputLength = Math.floor((str.length * 3) / 4);
  const bytes = new Uint8Array(outputLength);
  let byteIndex = 0;

  // Process 4 characters at a time
  let i = 0;
  for (; i + 3 < str.length; i += 4) {
    const v0 = decodeChar(str, i);
    const v1 = decodeChar(str, i + 1);
    const v2 = decodeChar(str, i + 2);
    const v3 = decodeChar(str, i + 3);

    bytes[byteIndex++] = (v0 << 2) | (v1 >> 4);
    bytes[byteIndex++] = ((v1 & 0x0f) << 4) | (v2 >> 2);
    bytes[byteIndex++] = ((v2 & 0x03) << 6) | v3;
  }

  // Handle remaining characters (2 or 3)
  if (i < str.length) {
    const v0 = decodeChar(str, i);
    const v1 = decodeChar(str, i + 1);
    bytes[byteIndex++] = (v0 << 2) | (v1 >> 4);

    if (i + 2 < str.length) {
      // 3 remaining characters
      const v2 = decodeChar(str, i + 2);
      bytes[byteIndex++] = ((v1 & 0x0f) << 4) | (v2 >> 2);
    }
  }

  return bytes;
}

/**
 * Helper function to decode a single base64url character
 * @throws Error if character is invalid
 */
function decodeChar(str: string, index: number): number {
  const charCode = str.charCodeAt(index);
  if (charCode >= 128) {
    throw new Error(`Invalid base64url character at position ${index}: '${str[index]}'`);
  }
  const value = BASE64URL_DECODE_LOOKUP[charCode];
  if (value === -1) {
    throw new Error(`Invalid base64url character at position ${index}: '${str[index]}'`);
  }
  return value;
}

/**
 * Converts a 32-byte key (DEK or RS) to a base64url password string.
 * This is specifically for RxDB database password usage.
 *
 * @param key - The 32-byte key (DEK or RS)
 * @returns Base64url encoded password string (43 characters)
 * @throws Error if key is not exactly 32 bytes
 */
export function keyToPassword(key: Uint8Array): string {
  if (!isValidKey(key)) {
    throw new Error(`Invalid key: must be a ${KEY_LENGTH}-byte Uint8Array`);
  }
  return base64urlEncode(key);
}

/**
 * Converts a base64url password string back to a 32-byte key.
 * Validates that the result is exactly 32 bytes.
 *
 * @param password - Base64url encoded password (43 characters)
 * @returns The 32-byte key
 * @throws Error if password doesn't decode to 32 bytes
 */
export function passwordToKey(password: string): Uint8Array {
  const key = base64urlDecode(password);
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `Invalid password: expected ${KEY_LENGTH} bytes after decoding, got ${key.length}`
    );
  }
  return key;
}

/**
 * Formats a Recovery Secret for QR code display.
 * Adds a URI prefix for better UX when scanning.
 *
 * Format: tricho://recover/{base64url}
 *
 * @param recoverySecret - The 32-byte recovery secret
 * @returns Formatted recovery URI
 * @throws Error if recovery secret is invalid
 */
export function formatRecoveryQRData(recoverySecret: Uint8Array): string {
  if (!isValidKey(recoverySecret)) {
    throw new Error(`Invalid recovery secret: must be a ${KEY_LENGTH}-byte Uint8Array`);
  }
  return `tricho://recover/${base64urlEncode(recoverySecret)}`;
}

/**
 * Parses a scanned QR code to extract the Recovery Secret.
 * Handles both plain base64url and URI-prefixed formats.
 *
 * Supported formats:
 * - tricho://recover/{base64url}
 * - Plain base64url string
 *
 * @param qrData - The scanned QR code data
 * @returns The 32-byte recovery secret
 * @throws Error if QR data is invalid or doesn't contain a valid RS
 */
export function parseRecoveryQRData(qrData: string): Uint8Array {
  if (typeof qrData !== 'string' || qrData.length === 0) {
    throw new Error('Invalid QR data: must be a non-empty string');
  }

  // Handle URI-prefixed format
  const uriPrefix = 'tricho://recover/';
  let base64urlData: string;

  if (qrData.startsWith(uriPrefix)) {
    base64urlData = qrData.slice(uriPrefix.length);
  } else if (qrData.startsWith('tricho:')) {
    // Invalid tricho: URI format
    throw new Error('Invalid QR data: unrecognized tricho:// URI format');
  } else {
    // Assume plain base64url
    base64urlData = qrData;
  }

  // Decode and validate
  let recoverySecret: Uint8Array;
  try {
    recoverySecret = base64urlDecode(base64urlData);
  } catch (error) {
    throw new Error('Invalid QR data: failed to decode base64url');
  }

  if (recoverySecret.length !== KEY_LENGTH) {
    throw new Error(
      `Invalid QR data: expected ${KEY_LENGTH} bytes, got ${recoverySecret.length}`
    );
  }

  return recoverySecret;
}

/**
 * Converts bytes to a hexadecimal string.
 * Useful for debugging and logging (with appropriate caution for secrets).
 *
 * @param bytes - The bytes to convert
 * @returns Lowercase hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('Input must be a Uint8Array');
  }

  const hex: string[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    hex[i] = bytes[i].toString(16).padStart(2, '0');
  }
  return hex.join('');
}

/**
 * Converts a hexadecimal string to bytes.
 *
 * @param hex - The hex string to convert (must be even length)
 * @returns Decoded bytes
 * @throws Error if input is not valid hex
 */
export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string') {
    throw new Error('Input must be a string');
  }

  // Remove optional 0x prefix
  if (hex.startsWith('0x') || hex.startsWith('0X')) {
    hex = hex.slice(2);
  }

  if (hex.length % 2 !== 0) {
    throw new Error('Hex string must have even length');
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`Invalid hex character at position ${i * 2}`);
    }
    bytes[i] = byte;
  }

  return bytes;
}

/**
 * Concatenates multiple Uint8Arrays into a single array.
 * Useful for building protocol messages.
 *
 * @param arrays - Arrays to concatenate
 * @returns Combined array
 */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Checks if a string is valid base64url (without decoding).
 * Useful for quick validation before attempting decode.
 *
 * @param str - The string to check
 * @returns true if string contains only valid base64url characters
 */
export function isValidBase64url(str: string): boolean {
  if (typeof str !== 'string') {
    return false;
  }

  // Empty string is valid
  if (str.length === 0) {
    return true;
  }

  // Check each character
  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    // Allow padding for compatibility
    if (str[i] === '=') {
      continue;
    }
    if (charCode >= 128 || BASE64URL_DECODE_LOOKUP[charCode] === -1) {
      return false;
    }
  }

  return true;
}

/**
 * Compares two Uint8Arrays for equality.
 * Note: For secret comparison, use constantTimeEqual from keys.ts
 *
 * @param a - First array
 * @param b - Second array
 * @returns true if arrays have identical content
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
