import { describe, it, expect } from 'vitest';
import {
  generateRecoverySecret,
  generateDataEncryptionKey,
  generateDeviceSalt,
  deriveKekFromRS,
  wrapDek,
  unwrapDek,
  KEY_LENGTH,
  SALT_LENGTH,
  constantTimeEqual,
} from './keys';

describe('Key Generation', () => {
  it('generates 32-byte recovery secret', () => {
    const rs = generateRecoverySecret();
    expect(rs).toBeInstanceOf(Uint8Array);
    expect(rs.length).toBe(KEY_LENGTH);
  });

  it('generates unique recovery secrets', () => {
    const rs1 = generateRecoverySecret();
    const rs2 = generateRecoverySecret();
    expect(constantTimeEqual(rs1, rs2)).toBe(false);
  });

  it('generates 32-byte DEK', () => {
    const dek = generateDataEncryptionKey();
    expect(dek).toBeInstanceOf(Uint8Array);
    expect(dek.length).toBe(KEY_LENGTH);
  });

  it('generates unique DEKs', () => {
    const dek1 = generateDataEncryptionKey();
    const dek2 = generateDataEncryptionKey();
    expect(constantTimeEqual(dek1, dek2)).toBe(false);
  });

  it('generates 32-byte device salt', () => {
    const salt = generateDeviceSalt();
    expect(salt).toBeInstanceOf(Uint8Array);
    expect(salt.length).toBe(SALT_LENGTH);
  });
});

describe('Key Wrapping', () => {
  it('wraps and unwraps DEK correctly', async () => {
    const rs = generateRecoverySecret();
    const dek = generateDataEncryptionKey();
    const salt = generateDeviceSalt();

    const kek = await deriveKekFromRS(rs, salt);
    const wrapped = await wrapDek(dek, kek);
    const unwrapped = await unwrapDek(wrapped, kek);

    expect(constantTimeEqual(unwrapped, dek)).toBe(true);
  });

  it('produces different ciphertext each wrap', async () => {
    const rs = generateRecoverySecret();
    const dek = generateDataEncryptionKey();
    const salt = generateDeviceSalt();

    const kek = await deriveKekFromRS(rs, salt);
    const wrapped1 = await wrapDek(dek, kek);
    const wrapped2 = await wrapDek(dek, kek);

    // IVs should be different
    expect(constantTimeEqual(wrapped1.iv, wrapped2.iv)).toBe(false);
  });
});

describe('Constant Time Comparison', () => {
  it('returns true for equal arrays', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(constantTimeEqual(a, b)).toBe(true);
  });

  it('returns false for different arrays', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 5]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });

  it('returns false for different lengths', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3, 4]);
    expect(constantTimeEqual(a, b)).toBe(false);
  });
});
