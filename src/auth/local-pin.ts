/**
 * Local PIN fallback.
 *
 * When the authenticator doesn't support the PRF extension, we can't produce
 * a stateless per-device KEK from biometrics. The PIN path lets the user set
 * a short local secret that PBKDF2-stretches into a KEK, which wraps the DEK
 * as `wrappedDekPin`. Daily unlock is then PIN entry.
 *
 * Parameters:
 *   - PBKDF2-SHA256, 600 000 iterations (OWASP 2025 guidance).
 *   - 16-byte salt persisted alongside the wrapped DEK.
 *
 * This never leaves the device. Server sees nothing of the PIN.
 */

import { encodeUtf8 } from '../crypto/envelope';

const PBKDF2_ITERATIONS = 600_000;

export function generatePinSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

export async function deriveKekFromPin(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const pinBytes = encodeUtf8(pin);
  const baseKey = await crypto.subtle.importKey('raw', pinBytes as BufferSource, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 32;

export function isPinValid(pin: string): boolean {
  if (typeof pin !== 'string') return false;
  return pin.length >= PIN_MIN_LENGTH && pin.length <= PIN_MAX_LENGTH;
}
