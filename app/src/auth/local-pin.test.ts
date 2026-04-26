import { describe, expect, it } from 'vitest';
import { deriveKekFromPin, generatePinSalt, isPinValid, PIN_MAX_LENGTH, PIN_MIN_LENGTH } from './local-pin';
import { envelopeEncrypt, envelopeDecrypt } from '../crypto/envelope';

describe('local-pin', () => {
  it('validates PIN length', () => {
    expect(isPinValid('abc')).toBe(false);
    expect(isPinValid('1234')).toBe(true);
    expect(isPinValid('x'.repeat(PIN_MIN_LENGTH))).toBe(true);
    expect(isPinValid('x'.repeat(PIN_MAX_LENGTH))).toBe(true);
    expect(isPinValid('x'.repeat(PIN_MAX_LENGTH + 1))).toBe(false);
  });

  it('generates 16-byte salts', () => {
    const s1 = generatePinSalt();
    const s2 = generatePinSalt();
    expect(s1.length).toBe(16);
    expect(s1).not.toEqual(s2);
  });

  it('derives deterministic KEK from same PIN + salt and round-trips AES-GCM', async () => {
    const salt = generatePinSalt();
    const kek1 = await deriveKekFromPin('1234', salt);
    const kek2 = await deriveKekFromPin('1234', salt);
    // Round-trip: encrypt with one derivation, decrypt with the other.
    const dek = new Uint8Array(32);
    crypto.getRandomValues(dek);
    const { ct, iv } = await envelopeEncrypt(kek1, dek);
    const roundTripped = await envelopeDecrypt(kek2, ct, iv);
    expect(Array.from(roundTripped)).toEqual(Array.from(dek));
  });

  it('different PINs produce independent KEKs', async () => {
    const salt = generatePinSalt();
    const kekA = await deriveKekFromPin('aaaa', salt);
    const kekB = await deriveKekFromPin('bbbb', salt);
    const dek = new Uint8Array(32);
    crypto.getRandomValues(dek);
    const { ct, iv } = await envelopeEncrypt(kekA, dek);
    await expect(envelopeDecrypt(kekB, ct, iv)).rejects.toThrow();
  });
}, 60000);
