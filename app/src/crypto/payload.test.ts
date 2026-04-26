/**
 * Tests for encrypted payload module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  encryptPayloadForRxDB,
  decryptPayloadFromRxDB,
  validatePayloadStructure,
  isEncryptedPayload,
  createEncryptedDocument,
  decryptDocument,
  getPayloadKeyId,
  getPayloadVersion,
  reencryptPayload,
  PayloadValidationError,
  PayloadDecryptionError,
  PAYLOAD_SCHEMA_VERSION,
  type EncryptedPayload,
} from './payload';
import { generateAesGcmKey, AES_GCM_CONFIG } from './envelope';

describe('Payload Encryption', () => {
  let testDek: CryptoKey;
  const testKeyId = 'test-vault-id-123';

  beforeEach(async () => {
    // Generate a fresh DEK for each test
    testDek = await generateAesGcmKey(true);
  });

  describe('encryptPayloadForRxDB', () => {
    it('encrypts simple object data', async () => {
      const data = { name: 'Test', value: 42 };

      const payload = await encryptPayloadForRxDB(data, {
        dek: testDek,
        keyId: testKeyId,
      });

      expect(payload.v).toBe(PAYLOAD_SCHEMA_VERSION);
      expect(payload.alg).toBe(AES_GCM_CONFIG.algId);
      expect(payload.kid).toBe(testKeyId);
      expect(typeof payload.iv).toBe('string');
      expect(payload.iv.length).toBeGreaterThan(0);
      expect(typeof payload.ct).toBe('string');
      expect(payload.ct.length).toBeGreaterThan(0);
    });

    it('encrypts nested object data', async () => {
      const data = {
        customer: {
          name: 'John Doe',
          email: 'john@example.com',
          addresses: [
            { street: '123 Main St', city: 'New York' },
            { street: '456 Oak Ave', city: 'Boston' },
          ],
        },
        createdAt: Date.now(),
      };

      const payload = await encryptPayloadForRxDB(data, {
        dek: testDek,
        keyId: testKeyId,
      });

      expect(payload.ct).toBeTruthy();
      expect(payload.iv).toBeTruthy();
    });

    it('encrypts array data', async () => {
      const data = [1, 2, 3, 'four', { five: 5 }];

      const payload = await encryptPayloadForRxDB(data, {
        dek: testDek,
        keyId: testKeyId,
      });

      expect(payload.ct).toBeTruthy();
    });

    it('encrypts string data', async () => {
      const data = 'Hello, encrypted world!';

      const payload = await encryptPayloadForRxDB(data, {
        dek: testDek,
        keyId: testKeyId,
      });

      expect(payload.ct).toBeTruthy();
    });

    it('encrypts null and boolean values', async () => {
      const payloadNull = await encryptPayloadForRxDB(null, {
        dek: testDek,
        keyId: testKeyId,
      });
      expect(payloadNull.ct).toBeTruthy();

      const payloadTrue = await encryptPayloadForRxDB(true, {
        dek: testDek,
        keyId: testKeyId,
      });
      expect(payloadTrue.ct).toBeTruthy();

      const payloadFalse = await encryptPayloadForRxDB(false, {
        dek: testDek,
        keyId: testKeyId,
      });
      expect(payloadFalse.ct).toBeTruthy();
    });

    it('generates unique IV for each encryption', async () => {
      const data = { test: 'data' };

      const payload1 = await encryptPayloadForRxDB(data, {
        dek: testDek,
        keyId: testKeyId,
      });

      const payload2 = await encryptPayloadForRxDB(data, {
        dek: testDek,
        keyId: testKeyId,
      });

      // IVs must be different even for same plaintext
      expect(payload1.iv).not.toBe(payload2.iv);
      // Ciphertexts will also differ due to different IVs
      expect(payload1.ct).not.toBe(payload2.ct);
    });

    it('includes AAD when document ID is provided', async () => {
      const data = { test: 'data' };

      const payload = await encryptPayloadForRxDB(data, {
        dek: testDek,
        keyId: testKeyId,
        documentId: 'doc-123',
      });

      expect(payload.aad).toBeTruthy();
    });

    it('includes AAD when context is provided', async () => {
      const data = { test: 'data' };

      const payload = await encryptPayloadForRxDB(data, {
        dek: testDek,
        keyId: testKeyId,
        context: 'customer:v1',
      });

      expect(payload.aad).toBeTruthy();
    });

    it('includes combined AAD when both documentId and context provided', async () => {
      const data = { test: 'data' };

      const payload = await encryptPayloadForRxDB(data, {
        dek: testDek,
        keyId: testKeyId,
        documentId: 'doc-123',
        context: 'customer:v1',
      });

      expect(payload.aad).toBeTruthy();
    });

    it('omits AAD when neither documentId nor context provided', async () => {
      const data = { test: 'data' };

      const payload = await encryptPayloadForRxDB(data, {
        dek: testDek,
        keyId: testKeyId,
      });

      expect(payload.aad).toBeUndefined();
    });
  });

  describe('decryptPayloadFromRxDB', () => {
    it('decrypts simple object data', async () => {
      const originalData = { name: 'Test', value: 42 };

      const payload = await encryptPayloadForRxDB(originalData, {
        dek: testDek,
        keyId: testKeyId,
      });

      const result = await decryptPayloadFromRxDB<typeof originalData>(payload, {
        dek: testDek,
      });

      expect(result.data).toEqual(originalData);
      expect(result.keyId).toBe(testKeyId);
      expect(result.version).toBe(PAYLOAD_SCHEMA_VERSION);
    });

    it('decrypts nested object data', async () => {
      const originalData = {
        customer: {
          name: 'John Doe',
          visits: [
            { date: '2024-01-01', notes: 'First visit' },
            { date: '2024-02-15', notes: 'Follow-up' },
          ],
        },
      };

      const payload = await encryptPayloadForRxDB(originalData, {
        dek: testDek,
        keyId: testKeyId,
      });

      const result = await decryptPayloadFromRxDB<typeof originalData>(payload, {
        dek: testDek,
      });

      expect(result.data).toEqual(originalData);
    });

    it('decrypts array data', async () => {
      const originalData = [1, 'two', { three: 3 }, null, true];

      const payload = await encryptPayloadForRxDB(originalData, {
        dek: testDek,
        keyId: testKeyId,
      });

      const result = await decryptPayloadFromRxDB<typeof originalData>(payload, {
        dek: testDek,
      });

      expect(result.data).toEqual(originalData);
    });

    it('decrypts string data', async () => {
      const originalData = 'Hello, encrypted world!';

      const payload = await encryptPayloadForRxDB(originalData, {
        dek: testDek,
        keyId: testKeyId,
      });

      const result = await decryptPayloadFromRxDB<string>(payload, {
        dek: testDek,
      });

      expect(result.data).toBe(originalData);
    });

    it('decrypts with AAD correctly', async () => {
      const originalData = { sensitive: 'data' };
      const documentId = 'doc-456';

      const payload = await encryptPayloadForRxDB(originalData, {
        dek: testDek,
        keyId: testKeyId,
        documentId,
      });

      const result = await decryptPayloadFromRxDB<typeof originalData>(payload, {
        dek: testDek,
        documentId,
      });

      expect(result.data).toEqual(originalData);
    });

    it('decrypts with documentId and context AAD', async () => {
      const originalData = { data: 'value' };
      const documentId = 'doc-789';
      const context = 'visit:v1';

      const payload = await encryptPayloadForRxDB(originalData, {
        dek: testDek,
        keyId: testKeyId,
        documentId,
        context,
      });

      const result = await decryptPayloadFromRxDB<typeof originalData>(payload, {
        dek: testDek,
        documentId,
        context,
      });

      expect(result.data).toEqual(originalData);
    });

    it('fails with wrong key', async () => {
      const originalData = { secret: 'message' };

      const payload = await encryptPayloadForRxDB(originalData, {
        dek: testDek,
        keyId: testKeyId,
      });

      // Use a different key
      const wrongDek = await generateAesGcmKey();

      await expect(
        decryptPayloadFromRxDB(payload, { dek: wrongDek })
      ).rejects.toThrow(PayloadDecryptionError);
    });

    it('fails when AAD mismatches', async () => {
      const originalData = { bound: 'data' };
      const documentId = 'doc-original';

      const payload = await encryptPayloadForRxDB(originalData, {
        dek: testDek,
        keyId: testKeyId,
        documentId,
      });

      // Try to decrypt with different document ID
      await expect(
        decryptPayloadFromRxDB(payload, {
          dek: testDek,
          documentId: 'doc-different',
        })
      ).rejects.toThrow(PayloadValidationError);
    });

    it('validates expected key ID', async () => {
      const originalData = { data: 'test' };

      const payload = await encryptPayloadForRxDB(originalData, {
        dek: testDek,
        keyId: testKeyId,
      });

      await expect(
        decryptPayloadFromRxDB(payload, {
          dek: testDek,
          expectedKeyId: 'wrong-key-id',
        })
      ).rejects.toThrow(PayloadValidationError);
    });

    it('passes with correct expected key ID', async () => {
      const originalData = { data: 'test' };

      const payload = await encryptPayloadForRxDB(originalData, {
        dek: testDek,
        keyId: testKeyId,
      });

      const result = await decryptPayloadFromRxDB<typeof originalData>(payload, {
        dek: testDek,
        expectedKeyId: testKeyId,
      });

      expect(result.data).toEqual(originalData);
    });
  });

  describe('validatePayloadStructure', () => {
    it('accepts valid payload', () => {
      const validPayload: EncryptedPayload = {
        v: 1,
        alg: 'AES-256-GCM',
        kid: 'key-123',
        iv: 'abc123',
        ct: 'xyz789',
      };

      expect(() => validatePayloadStructure(validPayload)).not.toThrow();
    });

    it('accepts payload with AAD', () => {
      const validPayload: EncryptedPayload = {
        v: 1,
        alg: 'AES-256-GCM',
        kid: 'key-123',
        iv: 'abc123',
        ct: 'xyz789',
        aad: 'aad-data',
      };

      expect(() => validatePayloadStructure(validPayload)).not.toThrow();
    });

    it('rejects null payload', () => {
      expect(() => validatePayloadStructure(null)).toThrow(PayloadValidationError);
    });

    it('rejects non-object payload', () => {
      expect(() => validatePayloadStructure('string')).toThrow(PayloadValidationError);
      expect(() => validatePayloadStructure(123)).toThrow(PayloadValidationError);
      expect(() => validatePayloadStructure(true)).toThrow(PayloadValidationError);
    });

    it('rejects payload without version', () => {
      expect(() =>
        validatePayloadStructure({
          alg: 'AES-256-GCM',
          kid: 'key',
          iv: 'iv',
          ct: 'ct',
        })
      ).toThrow(PayloadValidationError);
    });

    it('rejects payload with invalid version', () => {
      expect(() =>
        validatePayloadStructure({
          v: 0,
          alg: 'AES-256-GCM',
          kid: 'key',
          iv: 'iv',
          ct: 'ct',
        })
      ).toThrow(PayloadValidationError);

      expect(() =>
        validatePayloadStructure({
          v: -1,
          alg: 'AES-256-GCM',
          kid: 'key',
          iv: 'iv',
          ct: 'ct',
        })
      ).toThrow(PayloadValidationError);
    });

    it('rejects payload without algorithm', () => {
      expect(() =>
        validatePayloadStructure({
          v: 1,
          kid: 'key',
          iv: 'iv',
          ct: 'ct',
        })
      ).toThrow(PayloadValidationError);
    });

    it('rejects payload with empty algorithm', () => {
      expect(() =>
        validatePayloadStructure({
          v: 1,
          alg: '',
          kid: 'key',
          iv: 'iv',
          ct: 'ct',
        })
      ).toThrow(PayloadValidationError);
    });

    it('rejects payload without key ID', () => {
      expect(() =>
        validatePayloadStructure({
          v: 1,
          alg: 'AES-256-GCM',
          iv: 'iv',
          ct: 'ct',
        })
      ).toThrow(PayloadValidationError);
    });

    it('rejects payload with empty key ID', () => {
      expect(() =>
        validatePayloadStructure({
          v: 1,
          alg: 'AES-256-GCM',
          kid: '',
          iv: 'iv',
          ct: 'ct',
        })
      ).toThrow(PayloadValidationError);
    });

    it('rejects payload without IV', () => {
      expect(() =>
        validatePayloadStructure({
          v: 1,
          alg: 'AES-256-GCM',
          kid: 'key',
          ct: 'ct',
        })
      ).toThrow(PayloadValidationError);
    });

    it('rejects payload with empty IV', () => {
      expect(() =>
        validatePayloadStructure({
          v: 1,
          alg: 'AES-256-GCM',
          kid: 'key',
          iv: '',
          ct: 'ct',
        })
      ).toThrow(PayloadValidationError);
    });

    it('rejects payload without ciphertext', () => {
      expect(() =>
        validatePayloadStructure({
          v: 1,
          alg: 'AES-256-GCM',
          kid: 'key',
          iv: 'iv',
        })
      ).toThrow(PayloadValidationError);
    });

    it('rejects payload with empty ciphertext', () => {
      expect(() =>
        validatePayloadStructure({
          v: 1,
          alg: 'AES-256-GCM',
          kid: 'key',
          iv: 'iv',
          ct: '',
        })
      ).toThrow(PayloadValidationError);
    });

    it('rejects payload with non-string AAD', () => {
      expect(() =>
        validatePayloadStructure({
          v: 1,
          alg: 'AES-256-GCM',
          kid: 'key',
          iv: 'iv',
          ct: 'ct',
          aad: 123,
        })
      ).toThrow(PayloadValidationError);
    });
  });

  describe('isEncryptedPayload', () => {
    it('returns true for valid encrypted payload', () => {
      const payload: EncryptedPayload = {
        v: 1,
        alg: 'AES-256-GCM',
        kid: 'key-123',
        iv: 'abc',
        ct: 'xyz',
      };

      expect(isEncryptedPayload(payload)).toBe(true);
    });

    it('returns true for payload with AAD', () => {
      const payload: EncryptedPayload = {
        v: 1,
        alg: 'AES-256-GCM',
        kid: 'key-123',
        iv: 'abc',
        ct: 'xyz',
        aad: 'aad',
      };

      expect(isEncryptedPayload(payload)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isEncryptedPayload(null)).toBe(false);
    });

    it('returns false for non-object', () => {
      expect(isEncryptedPayload('string')).toBe(false);
      expect(isEncryptedPayload(123)).toBe(false);
      expect(isEncryptedPayload(true)).toBe(false);
      expect(isEncryptedPayload(undefined)).toBe(false);
    });

    it('returns false for partial payload', () => {
      expect(isEncryptedPayload({ v: 1 })).toBe(false);
      expect(isEncryptedPayload({ v: 1, alg: 'AES-256-GCM' })).toBe(false);
      expect(isEncryptedPayload({ v: 1, alg: 'AES-256-GCM', kid: 'key' })).toBe(false);
      expect(isEncryptedPayload({ v: 1, alg: 'AES-256-GCM', kid: 'key', iv: 'iv' })).toBe(false);
    });

    it('returns false for plaintext object', () => {
      expect(isEncryptedPayload({ name: 'John', email: 'john@example.com' })).toBe(false);
    });
  });

  describe('createEncryptedDocument', () => {
    it('creates document with encrypted payload', async () => {
      const data = { customerName: 'Jane Doe', email: 'jane@example.com' };

      const doc = await createEncryptedDocument('cust-123', 'customer', data, {
        dek: testDek,
        keyId: testKeyId,
      });

      expect(doc.id).toBe('cust-123');
      expect(doc.type).toBe('customer');
      expect(typeof doc.updatedAt).toBe('number');
      expect(doc.updatedAt).toBeGreaterThan(0);
      expect(doc.deleted).toBe(false);
      expect(isEncryptedPayload(doc.payload)).toBe(true);
      expect(doc.payload.kid).toBe(testKeyId);
    });

    it('binds payload to document ID via AAD', async () => {
      const data = { value: 'test' };

      const doc = await createEncryptedDocument('doc-456', 'test', data, {
        dek: testDek,
        keyId: testKeyId,
      });

      // Payload should have AAD (document ID)
      expect(doc.payload.aad).toBeTruthy();
    });
  });

  describe('decryptDocument', () => {
    it('decrypts document to plaintext', async () => {
      const originalData = { customerName: 'Jane Doe', visits: 5 };

      const encDoc = await createEncryptedDocument('cust-789', 'customer', originalData, {
        dek: testDek,
        keyId: testKeyId,
      });

      const plainDoc = await decryptDocument<typeof originalData>(encDoc, {
        dek: testDek,
      });

      expect(plainDoc.id).toBe('cust-789');
      expect(plainDoc.type).toBe('customer');
      expect(plainDoc.deleted).toBe(false);
      expect(plainDoc.data).toEqual(originalData);
    });

    it('preserves document metadata after round-trip', async () => {
      const originalData = { test: 'data' };

      const encDoc = await createEncryptedDocument('doc-001', 'testType', originalData, {
        dek: testDek,
        keyId: testKeyId,
      });

      const plainDoc = await decryptDocument<typeof originalData>(encDoc, {
        dek: testDek,
      });

      expect(plainDoc.id).toBe(encDoc.id);
      expect(plainDoc.type).toBe(encDoc.type);
      expect(plainDoc.updatedAt).toBe(encDoc.updatedAt);
      expect(plainDoc.deleted).toBe(encDoc.deleted);
    });
  });

  describe('getPayloadKeyId', () => {
    it('extracts key ID from payload', async () => {
      const payload = await encryptPayloadForRxDB({ test: 'data' }, {
        dek: testDek,
        keyId: 'vault-abc-123',
      });

      const keyId = getPayloadKeyId(payload);
      expect(keyId).toBe('vault-abc-123');
    });

    it('throws for invalid payload', () => {
      expect(() => getPayloadKeyId(null)).toThrow(PayloadValidationError);
      expect(() => getPayloadKeyId({ invalid: 'payload' })).toThrow(PayloadValidationError);
    });
  });

  describe('getPayloadVersion', () => {
    it('extracts version from payload', async () => {
      const payload = await encryptPayloadForRxDB({ test: 'data' }, {
        dek: testDek,
        keyId: testKeyId,
      });

      const version = getPayloadVersion(payload);
      expect(version).toBe(PAYLOAD_SCHEMA_VERSION);
    });

    it('throws for invalid payload', () => {
      expect(() => getPayloadVersion(null)).toThrow(PayloadValidationError);
      expect(() => getPayloadVersion({ invalid: 'payload' })).toThrow(PayloadValidationError);
    });
  });

  describe('reencryptPayload', () => {
    it('re-encrypts with new key', async () => {
      const originalData = { sensitive: 'information' };

      // Encrypt with old key
      const oldPayload = await encryptPayloadForRxDB(originalData, {
        dek: testDek,
        keyId: 'old-key-id',
      });

      // Generate new key
      const newDek = await generateAesGcmKey();
      const newKeyId = 'new-key-id';

      // Re-encrypt
      const newPayload = await reencryptPayload(
        oldPayload,
        testDek,
        newDek,
        newKeyId
      );

      // Verify new payload
      expect(newPayload.kid).toBe(newKeyId);
      expect(newPayload.iv).not.toBe(oldPayload.iv);
      expect(newPayload.ct).not.toBe(oldPayload.ct);

      // Verify can decrypt with new key
      const result = await decryptPayloadFromRxDB<typeof originalData>(newPayload, {
        dek: newDek,
      });
      expect(result.data).toEqual(originalData);

      // Verify old key can't decrypt new payload
      await expect(
        decryptPayloadFromRxDB(newPayload, { dek: testDek })
      ).rejects.toThrow(PayloadDecryptionError);
    });

    it('preserves data during re-encryption', async () => {
      const complexData = {
        customer: {
          name: 'Test Customer',
          addresses: [
            { street: '123 Main', city: 'NYC' },
            { street: '456 Oak', city: 'LA' },
          ],
        },
        notes: ['Note 1', 'Note 2'],
        metadata: {
          createdAt: Date.now(),
          version: 5,
        },
      };

      const oldPayload = await encryptPayloadForRxDB(complexData, {
        dek: testDek,
        keyId: 'old-key',
      });

      const newDek = await generateAesGcmKey();
      const newPayload = await reencryptPayload(
        oldPayload,
        testDek,
        newDek,
        'new-key'
      );

      const result = await decryptPayloadFromRxDB<typeof complexData>(newPayload, {
        dek: newDek,
      });

      expect(result.data).toEqual(complexData);
    });

    it('handles AAD during re-encryption', async () => {
      const data = { test: 'value' };
      const documentId = 'doc-reencrypt';
      const context = 'test:v1';

      const oldPayload = await encryptPayloadForRxDB(data, {
        dek: testDek,
        keyId: 'old-key',
        documentId,
        context,
      });

      const newDek = await generateAesGcmKey();
      const newPayload = await reencryptPayload(
        oldPayload,
        testDek,
        newDek,
        'new-key',
        documentId,
        context
      );

      // Should have AAD
      expect(newPayload.aad).toBeTruthy();

      // Should decrypt with correct AAD
      const result = await decryptPayloadFromRxDB<typeof data>(newPayload, {
        dek: newDek,
        documentId,
        context,
      });
      expect(result.data).toEqual(data);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty object', async () => {
      const data = {};

      const payload = await encryptPayloadForRxDB(data, {
        dek: testDek,
        keyId: testKeyId,
      });

      const result = await decryptPayloadFromRxDB<typeof data>(payload, {
        dek: testDek,
      });

      expect(result.data).toEqual({});
    });

    it('handles empty array', async () => {
      const data: unknown[] = [];

      const payload = await encryptPayloadForRxDB(data, {
        dek: testDek,
        keyId: testKeyId,
      });

      const result = await decryptPayloadFromRxDB<typeof data>(payload, {
        dek: testDek,
      });

      expect(result.data).toEqual([]);
    });

    it('handles unicode characters', async () => {
      const data = {
        name: 'Müller',
        emoji: '🔐🎉',
        japanese: '日本語',
        arabic: 'العربية',
      };

      const payload = await encryptPayloadForRxDB(data, {
        dek: testDek,
        keyId: testKeyId,
      });

      const result = await decryptPayloadFromRxDB<typeof data>(payload, {
        dek: testDek,
      });

      expect(result.data).toEqual(data);
    });

    it('handles large data', async () => {
      // Create ~1MB of data
      const largeArray = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        data: 'x'.repeat(100),
      }));

      const payload = await encryptPayloadForRxDB(largeArray, {
        dek: testDek,
        keyId: testKeyId,
      });

      const result = await decryptPayloadFromRxDB<typeof largeArray>(payload, {
        dek: testDek,
      });

      expect(result.data).toEqual(largeArray);
    });

    it('handles special number values', async () => {
      const data = {
        integer: 42,
        float: 3.14159,
        negative: -273.15,
        zero: 0,
        largeInt: Number.MAX_SAFE_INTEGER,
      };

      const payload = await encryptPayloadForRxDB(data, {
        dek: testDek,
        keyId: testKeyId,
      });

      const result = await decryptPayloadFromRxDB<typeof data>(payload, {
        dek: testDek,
      });

      expect(result.data).toEqual(data);
    });

    it('rejects unsupported algorithm on decrypt', async () => {
      const payload = await encryptPayloadForRxDB({ test: 'data' }, {
        dek: testDek,
        keyId: testKeyId,
      });

      // Manually change algorithm to unsupported one
      const tamperedPayload = { ...payload, alg: 'AES-128-CBC' as const };

      await expect(
        // @ts-expect-error - intentionally passing wrong alg type
        decryptPayloadFromRxDB(tamperedPayload, { dek: testDek })
      ).rejects.toThrow(PayloadValidationError);
    });
  });
});
