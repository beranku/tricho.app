/**
 * Tests for envelope encryption utilities
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  encodeBase64url,
  decodeBase64url,
  generateIv,
  envelopeEncrypt,
  envelopeDecrypt,
  encodeUtf8,
  decodeUtf8,
  importAesGcmKey,
  generateAesGcmKey,
  exportAesGcmKey,
  constantTimeEqual,
  AES_GCM_CONFIG,
} from './envelope';

describe('Base64url Encoding', () => {
  describe('encodeBase64url', () => {
    it('encodes empty array', () => {
      expect(encodeBase64url(new Uint8Array(0))).toBe('');
    });

    it('encodes single byte', () => {
      const result = encodeBase64url(new Uint8Array([0]));
      expect(result).toBe('AA');
    });

    it('encodes multiple bytes', () => {
      const result = encodeBase64url(new Uint8Array([72, 101, 108, 108, 111]));
      expect(result).toBe('SGVsbG8');
    });

    it('produces URL-safe output (no + or /)', () => {
      // Test bytes that would produce + and / in standard base64
      const bytes = new Uint8Array([251, 255, 254, 62, 63]);
      const result = encodeBase64url(bytes);

      expect(result).not.toContain('+');
      expect(result).not.toContain('/');
    });

    it('produces output without padding', () => {
      const result = encodeBase64url(new Uint8Array([1, 2, 3]));
      expect(result).not.toContain('=');
    });
  });

  describe('decodeBase64url', () => {
    it('decodes empty string', () => {
      expect(decodeBase64url('')).toEqual(new Uint8Array(0));
    });

    it('decodes single character pair', () => {
      const result = decodeBase64url('AA');
      expect(result).toEqual(new Uint8Array([0]));
    });

    it('decodes "Hello"', () => {
      const result = decodeBase64url('SGVsbG8');
      expect(result).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
    });

    it('handles padding', () => {
      // Same as above but with padding
      const result = decodeBase64url('SGVsbG8=');
      expect(result).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
    });

    it('throws on invalid characters', () => {
      expect(() => decodeBase64url('!@#$')).toThrow('Invalid Base64url character');
    });

    it('round-trips random data', () => {
      const original = new Uint8Array(100);
      crypto.getRandomValues(original);

      const encoded = encodeBase64url(original);
      const decoded = decodeBase64url(encoded);

      expect(decoded).toEqual(original);
    });
  });
});

describe('IV Generation', () => {
  describe('generateIv', () => {
    it('generates correct length IV', () => {
      const iv = generateIv();
      expect(iv.length).toBe(AES_GCM_CONFIG.ivLength);
    });

    it('generates unique IVs', () => {
      const iv1 = generateIv();
      const iv2 = generateIv();

      expect(iv1).not.toEqual(iv2);
    });

    it('generates non-zero IVs (with high probability)', () => {
      const iv = generateIv();
      const allZero = iv.every(byte => byte === 0);
      expect(allZero).toBe(false);
    });
  });
});

describe('UTF-8 Encoding', () => {
  describe('encodeUtf8', () => {
    it('encodes empty string', () => {
      expect(Array.from(encodeUtf8(''))).toEqual([]);
    });

    it('encodes ASCII string', () => {
      const result = encodeUtf8('Hello');
      expect(Array.from(result)).toEqual([72, 101, 108, 108, 111]);
    });

    it('encodes unicode characters', () => {
      const result = encodeUtf8('日本');
      expect(result.length).toBe(6); // 3 bytes per character
    });

    it('encodes emoji', () => {
      const result = encodeUtf8('🔐');
      expect(result.length).toBe(4); // 4 bytes for this emoji
    });
  });

  describe('decodeUtf8', () => {
    it('decodes empty array', () => {
      expect(decodeUtf8(new Uint8Array(0))).toBe('');
    });

    it('decodes ASCII bytes', () => {
      const result = decodeUtf8(new Uint8Array([72, 101, 108, 108, 111]));
      expect(result).toBe('Hello');
    });

    it('round-trips unicode', () => {
      const original = '日本語 🎉 Emoji!';
      const encoded = encodeUtf8(original);
      const decoded = decodeUtf8(encoded);
      expect(decoded).toBe(original);
    });
  });
});

describe('AES-GCM Key Operations', () => {
  describe('importAesGcmKey', () => {
    it('imports valid 32-byte key', async () => {
      const rawKey = new Uint8Array(32);
      crypto.getRandomValues(rawKey);

      const key = await importAesGcmKey(rawKey);

      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('AES-GCM');
    });

    it('rejects wrong key length', async () => {
      const shortKey = new Uint8Array(16);
      await expect(importAesGcmKey(shortKey)).rejects.toThrow('Invalid key length');

      const longKey = new Uint8Array(64);
      await expect(importAesGcmKey(longKey)).rejects.toThrow('Invalid key length');
    });

    it('creates non-extractable key by default', async () => {
      const rawKey = new Uint8Array(32);
      crypto.getRandomValues(rawKey);

      const key = await importAesGcmKey(rawKey);

      expect(key.extractable).toBe(false);
    });

    it('creates extractable key when requested', async () => {
      const rawKey = new Uint8Array(32);
      crypto.getRandomValues(rawKey);

      const key = await importAesGcmKey(rawKey, true);

      expect(key.extractable).toBe(true);
    });
  });

  describe('generateAesGcmKey', () => {
    it('generates valid AES-GCM key', async () => {
      const key = await generateAesGcmKey();

      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('AES-GCM');
    });

    it('generates extractable key by default', async () => {
      const key = await generateAesGcmKey();
      expect(key.extractable).toBe(true);
    });

    it('generates non-extractable key when requested', async () => {
      const key = await generateAesGcmKey(false);
      expect(key.extractable).toBe(false);
    });

    it('generates unique keys', async () => {
      const key1 = await generateAesGcmKey();
      const key2 = await generateAesGcmKey();

      const raw1 = await exportAesGcmKey(key1);
      const raw2 = await exportAesGcmKey(key2);

      expect(raw1).not.toEqual(raw2);
    });
  });

  describe('exportAesGcmKey', () => {
    it('exports key to raw bytes', async () => {
      const key = await generateAesGcmKey(true);
      const raw = await exportAesGcmKey(key);

      expect(raw.length).toBe(32);
    });

    it('round-trips key', async () => {
      const originalKey = await generateAesGcmKey(true);
      const raw = await exportAesGcmKey(originalKey);
      const importedKey = await importAesGcmKey(raw, true);
      const reExported = await exportAesGcmKey(importedKey);

      expect(reExported).toEqual(raw);
    });
  });
});

describe('Envelope Encryption/Decryption', () => {
  let testKey: CryptoKey;

  beforeEach(async () => {
    testKey = await generateAesGcmKey();
  });

  describe('envelopeEncrypt', () => {
    it('encrypts plaintext', async () => {
      const plaintext = encodeUtf8('Hello, World!');
      const result = await envelopeEncrypt(testKey, plaintext);

      expect(typeof result.ct).toBe('string');
      expect(result.ct.length).toBeGreaterThan(0);
      expect(typeof result.iv).toBe('string');
      expect(result.iv.length).toBeGreaterThan(0);
    });

    it('generates unique IV each time', async () => {
      const plaintext = encodeUtf8('Same message');

      const result1 = await envelopeEncrypt(testKey, plaintext);
      const result2 = await envelopeEncrypt(testKey, plaintext);

      expect(result1.iv).not.toBe(result2.iv);
    });

    it('produces different ciphertext for same plaintext', async () => {
      const plaintext = encodeUtf8('Same message');

      const result1 = await envelopeEncrypt(testKey, plaintext);
      const result2 = await envelopeEncrypt(testKey, plaintext);

      expect(result1.ct).not.toBe(result2.ct);
    });

    it('includes AAD in encryption', async () => {
      const plaintext = encodeUtf8('Secret data');
      const aad = encodeUtf8('document-id-123');

      const result = await envelopeEncrypt(testKey, plaintext, aad);

      expect(result.ct).toBeTruthy();
    });
  });

  describe('envelopeDecrypt', () => {
    it('decrypts ciphertext', async () => {
      const original = encodeUtf8('Hello, World!');
      const { ct, iv } = await envelopeEncrypt(testKey, original);

      const decrypted = await envelopeDecrypt(testKey, ct, iv);

      expect(Array.from(decrypted)).toEqual(Array.from(original));
    });

    it('decrypts with AAD', async () => {
      const original = encodeUtf8('Secret data');
      const aad = encodeUtf8('document-id-123');

      const { ct, iv } = await envelopeEncrypt(testKey, original, aad);
      const decrypted = await envelopeDecrypt(testKey, ct, iv, aad);

      expect(Array.from(decrypted)).toEqual(Array.from(original));
    });

    it('fails with wrong key', async () => {
      const original = encodeUtf8('Secret message');
      const { ct, iv } = await envelopeEncrypt(testKey, original);

      const wrongKey = await generateAesGcmKey();

      await expect(envelopeDecrypt(wrongKey, ct, iv)).rejects.toThrow();
    });

    it('fails with wrong AAD', async () => {
      const original = encodeUtf8('Secret data');
      const aad = encodeUtf8('correct-id');

      const { ct, iv } = await envelopeEncrypt(testKey, original, aad);
      const wrongAad = encodeUtf8('wrong-id');

      await expect(envelopeDecrypt(testKey, ct, iv, wrongAad)).rejects.toThrow();
    });

    it('fails when AAD missing but expected', async () => {
      const original = encodeUtf8('Secret data');
      const aad = encodeUtf8('document-id');

      const { ct, iv } = await envelopeEncrypt(testKey, original, aad);

      // Try to decrypt without AAD
      await expect(envelopeDecrypt(testKey, ct, iv)).rejects.toThrow();
    });

    it('fails with tampered ciphertext', async () => {
      const original = encodeUtf8('Original message');
      const { ct, iv } = await envelopeEncrypt(testKey, original);

      // Tamper with ciphertext (change first character)
      const tamperedCt = 'X' + ct.slice(1);

      await expect(envelopeDecrypt(testKey, tamperedCt, iv)).rejects.toThrow();
    });

    it('fails with invalid IV length', async () => {
      const original = encodeUtf8('Test');
      const { ct } = await envelopeEncrypt(testKey, original);

      // Create wrong-length IV
      const shortIv = encodeBase64url(new Uint8Array(8));

      await expect(envelopeDecrypt(testKey, ct, shortIv)).rejects.toThrow('Invalid IV length');
    });

    it('round-trips binary data', async () => {
      const original = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        original[i] = i;
      }

      const { ct, iv } = await envelopeEncrypt(testKey, original);
      const decrypted = await envelopeDecrypt(testKey, ct, iv);

      expect(decrypted).toEqual(original);
    });

    it('round-trips large data', async () => {
      // WebCrypto.getRandomValues is capped at 65_536 bytes per call.
      const original = new Uint8Array(1000000);
      for (let offset = 0; offset < original.length; offset += 65_536) {
        crypto.getRandomValues(original.subarray(offset, Math.min(offset + 65_536, original.length)));
      }

      const { ct, iv } = await envelopeEncrypt(testKey, original);
      const decrypted = await envelopeDecrypt(testKey, ct, iv);

      expect(Array.from(decrypted)).toEqual(Array.from(original));
    });
  });
});

describe('Constant Time Comparison', () => {
  describe('constantTimeEqual', () => {
    it('returns true for equal arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 5]);

      expect(constantTimeEqual(a, b)).toBe(true);
    });

    it('returns false for different arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 6]);

      expect(constantTimeEqual(a, b)).toBe(false);
    });

    it('returns false for different length arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4]);

      expect(constantTimeEqual(a, b)).toBe(false);
    });

    it('returns true for empty arrays', () => {
      const a = new Uint8Array(0);
      const b = new Uint8Array(0);

      expect(constantTimeEqual(a, b)).toBe(true);
    });

    it('returns true for same reference', () => {
      const a = new Uint8Array([1, 2, 3]);

      expect(constantTimeEqual(a, a)).toBe(true);
    });

    it('detects difference at any position', () => {
      for (let pos = 0; pos < 10; pos++) {
        const a = new Uint8Array(10).fill(0);
        const b = new Uint8Array(10).fill(0);
        b[pos] = 1;

        expect(constantTimeEqual(a, b)).toBe(false);
      }
    });
  });
});

describe('Configuration Constants', () => {
  it('has correct AES-GCM configuration', () => {
    expect(AES_GCM_CONFIG.name).toBe('AES-GCM');
    expect(AES_GCM_CONFIG.keyLength).toBe(256);
    expect(AES_GCM_CONFIG.ivLength).toBe(12);
    expect(AES_GCM_CONFIG.tagLength).toBe(128);
    expect(AES_GCM_CONFIG.algId).toBe('AES-256-GCM');
  });
});
