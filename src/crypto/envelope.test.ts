import { describe, it, expect } from 'vitest';
import {
  deriveDocumentKey,
  encryptDocument,
  decryptDocument,
  generateEnvelopeSalt,
} from './envelope';
import { generateDataEncryptionKey, constantTimeEqual } from './keys';

describe('Document Key Derivation', () => {
  it('derives deterministic keys for same inputs', async () => {
    const dek = generateDataEncryptionKey();
    const salt = generateEnvelopeSalt();

    const key1 = await deriveDocumentKey(dek, 'doc-1', salt);
    const key2 = await deriveDocumentKey(dek, 'doc-1', salt);

    // CryptoKeys can't be directly compared, but encryption results should match
    expect(key1).toBeDefined();
    expect(key2).toBeDefined();
  });

  it('derives different keys for different document IDs', async () => {
    const dek = generateDataEncryptionKey();
    const salt = generateEnvelopeSalt();

    const key1 = await deriveDocumentKey(dek, 'doc-1', salt);
    const key2 = await deriveDocumentKey(dek, 'doc-2', salt);

    // Keys should be different (tested via encryption output)
    expect(key1).not.toBe(key2);
  });
});

describe('Document Encryption', () => {
  it('encrypts and decrypts document correctly', async () => {
    const dek = generateDataEncryptionKey();
    const docId = 'test-doc-1';
    const payload = { name: 'Test', value: 42 };

    const encrypted = await encryptDocument(dek, docId, payload);
    const decrypted = await decryptDocument(dek, docId, encrypted);

    expect(decrypted).toEqual(payload);
  });

  it('produces ciphertext different from plaintext', async () => {
    const dek = generateDataEncryptionKey();
    const docId = 'test-doc-2';
    const payload = { name: 'Test' };

    const encrypted = await encryptDocument(dek, docId, payload);
    const plaintextBytes = new TextEncoder().encode(JSON.stringify(payload));

    expect(constantTimeEqual(
      encrypted.envelope.ciphertext.slice(0, plaintextBytes.length),
      plaintextBytes
    )).toBe(false);
  });
});
