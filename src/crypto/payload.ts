/**
 * Encrypted payload module for RxDB documents
 *
 * This module provides application-level encryption for RxDB document payloads.
 * Documents are encrypted before storing in RxDB and decrypted when read.
 *
 * Encrypted document structure:
 * ```
 * {
 *   id: string;           // Clear - primary key
 *   type: string;         // Clear - for filtering
 *   updatedAt: number;    // Clear - for sorting/sync
 *   deleted: boolean;     // Clear - soft delete flag
 *   payload: {            // Encrypted object
 *     v: number;          // Schema version
 *     alg: string;        // Algorithm (AES-256-GCM)
 *     kid: string;        // Key ID (DEK identifier)
 *     iv: string;         // Base64url IV
 *     ct: string;         // Base64url ciphertext
 *     aad?: string;       // Additional authenticated data (if used)
 *   }
 * }
 * ```
 *
 * Security considerations:
 * - Payloads are encrypted with AES-256-GCM using the DEK
 * - Each encryption uses a fresh random IV
 * - Document ID can be included as AAD for binding
 * - Server only sees ciphertext (zero-knowledge)
 */

import {
  AES_GCM_CONFIG,
  envelopeEncrypt,
  envelopeDecrypt,
  encodeUtf8,
  decodeUtf8,
  encodeBase64url,
  decodeBase64url,
} from './envelope';

/** Current payload schema version */
export const PAYLOAD_SCHEMA_VERSION = 1;

/**
 * Encrypted payload structure stored in RxDB documents
 */
export interface EncryptedPayload {
  /** Schema version for future compatibility */
  v: number;
  /** Algorithm identifier */
  alg: 'AES-256-GCM';
  /** Key identifier (vault ID or DEK fingerprint) */
  kid: string;
  /** Initialization vector (Base64url encoded) */
  iv: string;
  /** Ciphertext (Base64url encoded) */
  ct: string;
  /** Additional authenticated data (Base64url encoded, optional) */
  aad?: string;
}

/**
 * Options for payload encryption
 */
export interface PayloadEncryptOptions {
  /** Data encryption key (CryptoKey with 'encrypt' usage) */
  dek: CryptoKey;
  /** Key identifier (typically vault ID) */
  keyId: string;
  /** Optional document ID to bind as AAD */
  documentId?: string;
  /** Optional additional context for AAD */
  context?: string;
}

/**
 * Options for payload decryption
 */
export interface PayloadDecryptOptions {
  /** Data encryption key (CryptoKey with 'decrypt' usage) */
  dek: CryptoKey;
  /** Expected key identifier (for validation) */
  expectedKeyId?: string;
  /** Document ID used as AAD during encryption */
  documentId?: string;
  /** Additional context used as AAD during encryption */
  context?: string;
}

/**
 * Result of payload decryption
 */
export interface DecryptedPayload<T = unknown> {
  /** Decrypted data */
  data: T;
  /** Key ID from the encrypted payload */
  keyId: string;
  /** Schema version of the payload */
  version: number;
}

/**
 * Error thrown when payload validation fails
 */
export class PayloadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadValidationError';
  }
}

/**
 * Error thrown when payload decryption fails
 */
export class PayloadDecryptionError extends Error {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'PayloadDecryptionError';
  }
}

/**
 * Encrypts a document payload for storage in RxDB
 *
 * The payload is serialized to JSON, encoded as UTF-8, and encrypted with AES-256-GCM.
 * An optional AAD can be constructed from the document ID and context to bind the
 * ciphertext to specific metadata.
 *
 * @param data - Data to encrypt (must be JSON-serializable)
 * @param options - Encryption options including DEK and key ID
 * @returns Promise resolving to EncryptedPayload
 * @throws Error if encryption fails
 */
export async function encryptPayloadForRxDB<T>(
  data: T,
  options: PayloadEncryptOptions
): Promise<EncryptedPayload> {
  const { dek, keyId, documentId, context } = options;

  // Serialize data to JSON
  const jsonStr = JSON.stringify(data);
  const plaintext = encodeUtf8(jsonStr);

  // Build AAD from document ID and context if provided
  const aad = buildAad(documentId, context);

  // Encrypt the payload
  const { ct, iv } = await envelopeEncrypt(dek, plaintext, aad);

  // Construct the encrypted payload
  const payload: EncryptedPayload = {
    v: PAYLOAD_SCHEMA_VERSION,
    alg: AES_GCM_CONFIG.algId,
    kid: keyId,
    iv,
    ct,
  };

  // Include AAD reference if used (so decryption knows to reconstruct it)
  if (aad) {
    payload.aad = encodeBase64url(aad);
  }

  return payload;
}

/**
 * Decrypts an encrypted payload from RxDB
 *
 * The payload is validated, decrypted with AES-256-GCM, and deserialized from JSON.
 * If AAD was used during encryption, it must be reconstructed using the same
 * document ID and context.
 *
 * @param payload - Encrypted payload from RxDB document
 * @param options - Decryption options including DEK
 * @returns Promise resolving to DecryptedPayload with data and metadata
 * @throws PayloadValidationError if payload format is invalid
 * @throws PayloadDecryptionError if decryption fails
 */
export async function decryptPayloadFromRxDB<T = unknown>(
  payload: EncryptedPayload,
  options: PayloadDecryptOptions
): Promise<DecryptedPayload<T>> {
  const { dek, expectedKeyId, documentId, context } = options;

  // Validate payload structure
  validatePayloadStructure(payload);

  // Validate key ID if expected one is provided
  if (expectedKeyId && payload.kid !== expectedKeyId) {
    throw new PayloadValidationError(
      `Key ID mismatch: expected ${expectedKeyId}, got ${payload.kid}`
    );
  }

  // Validate algorithm
  if (payload.alg !== AES_GCM_CONFIG.algId) {
    throw new PayloadValidationError(
      `Unsupported algorithm: ${payload.alg}. Expected ${AES_GCM_CONFIG.algId}`
    );
  }

  // Reconstruct AAD if it was used
  let aad: Uint8Array | undefined;
  if (payload.aad) {
    // If payload has AAD reference, reconstruct from document ID and context
    aad = buildAad(documentId, context);

    // Verify the reconstructed AAD matches what was stored
    const storedAad = decodeBase64url(payload.aad);
    if (aad && !uint8ArrayEquals(aad, storedAad)) {
      throw new PayloadValidationError(
        'AAD mismatch: reconstructed AAD does not match stored AAD'
      );
    }
    aad = storedAad;
  }

  try {
    // Decrypt the ciphertext
    const plaintext = await envelopeDecrypt(dek, payload.ct, payload.iv, aad);

    // Decode UTF-8 and parse JSON
    const jsonStr = decodeUtf8(plaintext);
    const data = JSON.parse(jsonStr) as T;

    return {
      data,
      keyId: payload.kid,
      version: payload.v,
    };
  } catch (error) {
    if (error instanceof PayloadValidationError) {
      throw error;
    }
    throw new PayloadDecryptionError(
      'Failed to decrypt payload',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Validates that an object is a valid EncryptedPayload structure
 *
 * @param payload - Object to validate
 * @throws PayloadValidationError if validation fails
 */
export function validatePayloadStructure(payload: unknown): asserts payload is EncryptedPayload {
  if (!payload || typeof payload !== 'object') {
    throw new PayloadValidationError('Payload must be an object');
  }

  const p = payload as Record<string, unknown>;

  // Validate version
  if (typeof p.v !== 'number' || p.v < 1) {
    throw new PayloadValidationError('Payload must have a valid version (v >= 1)');
  }

  // Validate algorithm
  if (typeof p.alg !== 'string' || p.alg.length === 0) {
    throw new PayloadValidationError('Payload must have an algorithm (alg)');
  }

  // Validate key ID
  if (typeof p.kid !== 'string' || p.kid.length === 0) {
    throw new PayloadValidationError('Payload must have a key ID (kid)');
  }

  // Validate IV
  if (typeof p.iv !== 'string' || p.iv.length === 0) {
    throw new PayloadValidationError('Payload must have an IV (iv)');
  }

  // Validate ciphertext
  if (typeof p.ct !== 'string' || p.ct.length === 0) {
    throw new PayloadValidationError('Payload must have ciphertext (ct)');
  }

  // Validate AAD if present
  if (p.aad !== undefined && typeof p.aad !== 'string') {
    throw new PayloadValidationError('Payload AAD must be a string if present');
  }
}

/**
 * Checks if an object looks like an encrypted payload
 *
 * This is a quick check without full validation, useful for determining
 * if a document needs decryption.
 *
 * @param obj - Object to check
 * @returns true if object has encrypted payload structure
 */
export function isEncryptedPayload(obj: unknown): obj is EncryptedPayload {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  const p = obj as Record<string, unknown>;
  return (
    typeof p.v === 'number' &&
    typeof p.alg === 'string' &&
    typeof p.kid === 'string' &&
    typeof p.iv === 'string' &&
    typeof p.ct === 'string'
  );
}

/**
 * Builds Additional Authenticated Data (AAD) from document ID and context
 *
 * AAD provides cryptographic binding between the ciphertext and metadata.
 * It's included in the GCM authentication but not encrypted.
 *
 * Format: "docId|context" encoded as UTF-8
 *
 * @param documentId - Document identifier
 * @param context - Additional context string
 * @returns AAD as Uint8Array, or undefined if neither provided
 */
function buildAad(documentId?: string, context?: string): Uint8Array | undefined {
  const parts: string[] = [];

  if (documentId) {
    parts.push(documentId);
  }

  if (context) {
    parts.push(context);
  }

  if (parts.length === 0) {
    return undefined;
  }

  return encodeUtf8(parts.join('|'));
}

/**
 * Compares two Uint8Arrays for equality
 *
 * @param a - First array
 * @param b - Second array
 * @returns true if arrays are equal
 */
function uint8ArrayEquals(a: Uint8Array, b: Uint8Array): boolean {
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

/**
 * Creates an encrypted document structure from plaintext data
 *
 * This is a convenience function that creates a full document structure
 * with clear metadata and encrypted payload.
 *
 * @param id - Document ID
 * @param type - Document type for filtering
 * @param data - Plaintext data to encrypt
 * @param options - Encryption options
 * @returns Promise resolving to document with encrypted payload
 */
export async function createEncryptedDocument<T>(
  id: string,
  type: string,
  data: T,
  options: Omit<PayloadEncryptOptions, 'documentId'>
): Promise<EncryptedDocument<never>> {
  const payload = await encryptPayloadForRxDB(data, {
    ...options,
    documentId: id,
  });

  return {
    id,
    type,
    updatedAt: Date.now(),
    deleted: false,
    payload,
  };
}

/**
 * Decrypts the payload of an encrypted document
 *
 * @param doc - Encrypted document
 * @param options - Decryption options
 * @returns Promise resolving to plaintext document
 */
export async function decryptDocument<T>(
  doc: EncryptedDocument<never>,
  options: Omit<PayloadDecryptOptions, 'documentId'>
): Promise<PlaintextDocument<T>> {
  const { data } = await decryptPayloadFromRxDB<T>(doc.payload, {
    ...options,
    documentId: doc.id,
  });

  return {
    id: doc.id,
    type: doc.type,
    updatedAt: doc.updatedAt,
    deleted: doc.deleted,
    data,
  };
}

/**
 * Encrypted document structure stored in RxDB
 */
export interface EncryptedDocument<T = never> {
  /** Document ID (clear) */
  id: string;
  /** Document type (clear) */
  type: string;
  /** Last update timestamp (clear) */
  updatedAt: number;
  /** Soft delete flag (clear) */
  deleted: boolean;
  /** Encrypted payload */
  payload: [T] extends [never] ? EncryptedPayload : T;
}

/**
 * Plaintext document structure after decryption
 */
export interface PlaintextDocument<T> {
  /** Document ID */
  id: string;
  /** Document type */
  type: string;
  /** Last update timestamp */
  updatedAt: number;
  /** Soft delete flag */
  deleted: boolean;
  /** Decrypted data */
  data: T;
}

/**
 * Extracts the key ID from an encrypted payload without decrypting
 *
 * Useful for determining which key is needed to decrypt a document.
 *
 * @param payload - Encrypted payload
 * @returns Key ID string
 * @throws PayloadValidationError if payload is invalid
 */
export function getPayloadKeyId(payload: unknown): string {
  validatePayloadStructure(payload);
  return payload.kid;
}

/**
 * Extracts the schema version from an encrypted payload without decrypting
 *
 * @param payload - Encrypted payload
 * @returns Schema version number
 * @throws PayloadValidationError if payload is invalid
 */
export function getPayloadVersion(payload: unknown): number {
  validatePayloadStructure(payload);
  return payload.v;
}

/**
 * Re-encrypts a payload with a new DEK
 *
 * Used during key rotation to re-encrypt existing documents with a new key.
 *
 * @param payload - Existing encrypted payload
 * @param oldDek - Current DEK for decryption
 * @param newDek - New DEK for re-encryption
 * @param newKeyId - New key ID for the re-encrypted payload
 * @param documentId - Optional document ID for AAD
 * @param context - Optional context for AAD
 * @returns Promise resolving to re-encrypted payload
 */
export async function reencryptPayload(
  payload: EncryptedPayload,
  oldDek: CryptoKey,
  newDek: CryptoKey,
  newKeyId: string,
  documentId?: string,
  context?: string
): Promise<EncryptedPayload> {
  // Decrypt with old key
  const { data } = await decryptPayloadFromRxDB(payload, {
    dek: oldDek,
    documentId,
    context,
  });

  // Re-encrypt with new key
  return encryptPayloadForRxDB(data, {
    dek: newDek,
    keyId: newKeyId,
    documentId,
    context,
  });
}
