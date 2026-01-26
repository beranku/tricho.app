// Envelope encryption module for TrichoApp
// Implements per-document and per-photo encryption using HKDF-derived keys
// Reference: spec.md - Envelope Encryption Pattern

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import {
  KEY_LENGTH,
  IV_LENGTH,
  SALT_LENGTH,
  type DataEncryptionKey,
} from './keys';

/**
 * HKDF info strings for envelope encryption
 * These ensure keys derived for different purposes are cryptographically independent
 */
export const ENVELOPE_HKDF_INFO = {
  DOCUMENT: 'tricho:envelope:doc:v1',
  PHOTO: 'tricho:envelope:photo:v1',
} as const;

/**
 * Authentication tag length for AES-GCM
 * 16 bytes (128 bits) is the maximum and recommended size
 */
export const AUTH_TAG_LENGTH = 16;

/**
 * Photo variants supported by the encryption system
 * Each variant gets its own derived key for cryptographic separation
 */
export type PhotoVariant = 'original' | 'thumbnail' | 'preview';

/**
 * Encrypted envelope structure
 * Contains all data needed to decrypt the payload
 */
export interface EncryptedEnvelope {
  /** 12-byte initialization vector (unique per encryption) */
  iv: Uint8Array;
  /** AES-GCM ciphertext with authentication tag appended */
  ciphertext: Uint8Array;
  /** Key derivation salt (enables re-derivation of per-item key) */
  salt: Uint8Array;
}

/**
 * Encrypted document with type safety for the decrypted payload
 */
export interface EncryptedDocument<T = unknown> {
  envelope: EncryptedEnvelope;
  /** Type hint for decryption (not encrypted, used for deserialization) */
  _type?: string;
}

/**
 * Encrypted photo blob structure
 */
export interface EncryptedPhoto {
  envelope: EncryptedEnvelope;
  /** Photo variant (original, thumbnail, preview) */
  variant: PhotoVariant;
  /** MIME type of the original photo */
  mimeType: string;
  /** Original file size before encryption (for validation) */
  originalSize: number;
}

/**
 * Derives a per-document encryption key from the DEK using HKDF.
 * Each document gets a unique key derived from:
 * - The master DEK as input key material
 * - A random salt (stored with the encrypted document)
 * - The document ID as context info
 *
 * This provides cryptographic separation between documents - compromising
 * one document's key doesn't reveal other documents' keys.
 *
 * @param dek - The Data Encryption Key (32 bytes)
 * @param documentId - Unique identifier for the document
 * @param salt - Random salt for this document (32 bytes)
 * @returns Promise resolving to a CryptoKey for AES-GCM
 * @throws Error if inputs are invalid
 */
export async function deriveDocumentKey(
  dek: DataEncryptionKey,
  documentId: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  validateDek(dek);
  validateSalt(salt);

  if (!documentId || typeof documentId !== 'string') {
    throw new Error('Invalid document ID: must be a non-empty string');
  }

  // Combine base info with document ID for domain separation
  const info = `${ENVELOPE_HKDF_INFO.DOCUMENT}:${documentId}`;

  // Derive 32 bytes for AES-256
  const keyBytes = hkdf(sha256, dek, salt, info, KEY_LENGTH);

  // Import as CryptoKey for AES-GCM operations
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Derives a per-photo encryption key from the DEK using HKDF.
 * Similar to document keys but includes variant for cryptographic separation
 * between different versions of the same photo.
 *
 * @param dek - The Data Encryption Key (32 bytes)
 * @param photoId - Unique identifier for the photo
 * @param variant - Photo variant (original, thumbnail, preview)
 * @param salt - Random salt for this photo (32 bytes)
 * @returns Promise resolving to a CryptoKey for AES-GCM
 * @throws Error if inputs are invalid
 */
export async function derivePhotoKey(
  dek: DataEncryptionKey,
  photoId: string,
  variant: PhotoVariant,
  salt: Uint8Array
): Promise<CryptoKey> {
  validateDek(dek);
  validateSalt(salt);

  if (!photoId || typeof photoId !== 'string') {
    throw new Error('Invalid photo ID: must be a non-empty string');
  }

  const validVariants: PhotoVariant[] = ['original', 'thumbnail', 'preview'];
  if (!validVariants.includes(variant)) {
    throw new Error(`Invalid variant: must be one of ${validVariants.join(', ')}`);
  }

  // Include variant in info for cryptographic separation between versions
  const info = `${ENVELOPE_HKDF_INFO.PHOTO}:${photoId}:${variant}`;

  // Derive 32 bytes for AES-256
  const keyBytes = hkdf(sha256, dek, salt, info, KEY_LENGTH);

  // Import as CryptoKey for AES-GCM operations
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Generates a random salt for envelope encryption.
 * Each encrypted item should have its own unique salt.
 *
 * @returns 32 bytes of cryptographically random data
 * @throws Error if Web Crypto API is not available
 */
export function generateEnvelopeSalt(): Uint8Array {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('Web Crypto API not available');
  }

  const salt = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(salt);
  return salt;
}

/**
 * Encrypts a JSON document payload using envelope encryption.
 * The document is serialized to JSON, encrypted with a derived key,
 * and wrapped in an envelope containing all decryption metadata.
 *
 * @param dek - The Data Encryption Key
 * @param documentId - Unique document identifier
 * @param payload - The document payload to encrypt (will be JSON serialized)
 * @returns Promise resolving to EncryptedDocument
 * @throws Error if encryption fails
 */
export async function encryptDocument<T>(
  dek: DataEncryptionKey,
  documentId: string,
  payload: T
): Promise<EncryptedDocument<T>> {
  // Generate fresh salt for this document
  const salt = generateEnvelopeSalt();

  // Derive per-document key
  const key = await deriveDocumentKey(dek, documentId, salt);

  // Serialize payload to JSON, then encode as UTF-8 bytes
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));

  // Encrypt the payload
  const envelope = await encryptPayload(key, plaintext, salt);

  return { envelope };
}

/**
 * Decrypts an encrypted document and deserializes the JSON payload.
 *
 * @param dek - The Data Encryption Key
 * @param documentId - Unique document identifier (must match encryption)
 * @param encryptedDoc - The encrypted document envelope
 * @returns Promise resolving to the decrypted and parsed payload
 * @throws Error if decryption or parsing fails
 */
export async function decryptDocument<T>(
  dek: DataEncryptionKey,
  documentId: string,
  encryptedDoc: EncryptedDocument<T>
): Promise<T> {
  // Re-derive the per-document key using stored salt
  const key = await deriveDocumentKey(dek, documentId, encryptedDoc.envelope.salt);

  // Decrypt the payload
  const plaintext = await decryptPayload(key, encryptedDoc.envelope);

  // Parse JSON from decrypted bytes
  const json = new TextDecoder().decode(plaintext);
  return JSON.parse(json) as T;
}

/**
 * Encrypts a photo blob using envelope encryption.
 * Photos are encrypted as raw bytes without JSON serialization.
 *
 * @param dek - The Data Encryption Key
 * @param photoId - Unique photo identifier
 * @param variant - Photo variant (original, thumbnail, preview)
 * @param photoData - The photo blob as ArrayBuffer or Uint8Array
 * @param mimeType - MIME type of the photo (e.g., 'image/jpeg')
 * @returns Promise resolving to EncryptedPhoto
 * @throws Error if encryption fails
 */
export async function encryptPhoto(
  dek: DataEncryptionKey,
  photoId: string,
  variant: PhotoVariant,
  photoData: ArrayBuffer | Uint8Array,
  mimeType: string
): Promise<EncryptedPhoto> {
  // Generate fresh salt for this photo
  const salt = generateEnvelopeSalt();

  // Derive per-photo key (includes variant for separation)
  const key = await derivePhotoKey(dek, photoId, variant, salt);

  // Ensure we have Uint8Array
  const plaintext =
    photoData instanceof Uint8Array
      ? photoData
      : new Uint8Array(photoData);

  // Store original size for validation during decryption
  const originalSize = plaintext.length;

  // Encrypt the photo data
  const envelope = await encryptPayload(key, plaintext, salt);

  return {
    envelope,
    variant,
    mimeType,
    originalSize,
  };
}

/**
 * Decrypts an encrypted photo blob.
 *
 * @param dek - The Data Encryption Key
 * @param photoId - Unique photo identifier (must match encryption)
 * @param encryptedPhoto - The encrypted photo envelope
 * @returns Promise resolving to the decrypted photo as Uint8Array
 * @throws Error if decryption fails or size validation fails
 */
export async function decryptPhoto(
  dek: DataEncryptionKey,
  photoId: string,
  encryptedPhoto: EncryptedPhoto
): Promise<Uint8Array> {
  // Re-derive the per-photo key using stored salt and variant
  const key = await derivePhotoKey(
    dek,
    photoId,
    encryptedPhoto.variant,
    encryptedPhoto.envelope.salt
  );

  // Decrypt the photo data
  const plaintext = await decryptPayload(key, encryptedPhoto.envelope);

  // Validate size matches original (integrity check)
  if (plaintext.length !== encryptedPhoto.originalSize) {
    throw new Error(
      'Decrypted photo size mismatch: data may be corrupted'
    );
  }

  return plaintext;
}

/**
 * Low-level encryption function using AES-GCM.
 * Generates a fresh IV and encrypts the plaintext.
 *
 * @param key - CryptoKey for AES-GCM encryption
 * @param plaintext - Data to encrypt
 * @param salt - Salt used for key derivation (stored in envelope)
 * @returns Promise resolving to EncryptedEnvelope
 */
async function encryptPayload(
  key: CryptoKey,
  plaintext: Uint8Array,
  salt: Uint8Array
): Promise<EncryptedEnvelope> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto API not available');
  }

  // Generate fresh IV for each encryption
  // Critical: IV must NEVER be reused with the same key
  const iv = new Uint8Array(IV_LENGTH);
  crypto.getRandomValues(iv);

  // Encrypt with AES-GCM
  // The returned ciphertext includes the authentication tag
  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      tagLength: AUTH_TAG_LENGTH * 8, // in bits
    },
    key,
    plaintext
  );

  return {
    iv,
    ciphertext: new Uint8Array(ciphertextBuffer),
    salt,
  };
}

/**
 * Low-level decryption function using AES-GCM.
 * Verifies the authentication tag and decrypts the ciphertext.
 *
 * @param key - CryptoKey for AES-GCM decryption
 * @param envelope - The encrypted envelope containing IV and ciphertext
 * @returns Promise resolving to decrypted plaintext
 * @throws Error if authentication fails or decryption fails
 */
async function decryptPayload(
  key: CryptoKey,
  envelope: EncryptedEnvelope
): Promise<Uint8Array> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto API not available');
  }

  validateEnvelope(envelope);

  try {
    // Decrypt with AES-GCM
    // This automatically verifies the authentication tag
    const plaintextBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: envelope.iv,
        tagLength: AUTH_TAG_LENGTH * 8, // in bits
      },
      key,
      envelope.ciphertext
    );

    return new Uint8Array(plaintextBuffer);
  } catch (error) {
    // AES-GCM decryption failures indicate tampering or wrong key
    // Don't expose underlying error to avoid information leakage
    throw new Error(
      'Decryption failed: authentication failed (wrong key or tampered data)'
    );
  }
}

/**
 * Serializes an EncryptedEnvelope to bytes for storage.
 * Format: [salt (32 bytes)] [iv (12 bytes)] [ciphertext (variable)]
 *
 * @param envelope - The envelope to serialize
 * @returns Serialized bytes
 */
export function serializeEnvelope(envelope: EncryptedEnvelope): Uint8Array {
  validateEnvelope(envelope);

  const totalLength =
    SALT_LENGTH + IV_LENGTH + envelope.ciphertext.length;
  const result = new Uint8Array(totalLength);

  let offset = 0;
  result.set(envelope.salt, offset);
  offset += SALT_LENGTH;

  result.set(envelope.iv, offset);
  offset += IV_LENGTH;

  result.set(envelope.ciphertext, offset);

  return result;
}

/**
 * Deserializes bytes back to an EncryptedEnvelope.
 *
 * @param data - Serialized envelope bytes
 * @returns EncryptedEnvelope structure
 * @throws Error if data is too short or invalid
 */
export function deserializeEnvelope(data: Uint8Array): EncryptedEnvelope {
  // Minimum size: 32 bytes salt + 12 bytes IV + 1 byte data + 16 bytes auth tag
  const minSize = SALT_LENGTH + IV_LENGTH + 1 + AUTH_TAG_LENGTH;

  if (!(data instanceof Uint8Array) || data.length < minSize) {
    throw new Error(
      `Invalid envelope data: expected at least ${minSize} bytes, got ${data?.length ?? 0}`
    );
  }

  let offset = 0;

  const salt = data.slice(offset, offset + SALT_LENGTH);
  offset += SALT_LENGTH;

  const iv = data.slice(offset, offset + IV_LENGTH);
  offset += IV_LENGTH;

  const ciphertext = data.slice(offset);

  return { salt, iv, ciphertext };
}

/**
 * Serializes an EncryptedPhoto for storage.
 * Includes metadata alongside the encrypted envelope.
 *
 * @param photo - The encrypted photo to serialize
 * @returns Serialized bytes with metadata header
 */
export function serializeEncryptedPhoto(photo: EncryptedPhoto): Uint8Array {
  // Create metadata header as JSON
  const metadata = JSON.stringify({
    variant: photo.variant,
    mimeType: photo.mimeType,
    originalSize: photo.originalSize,
  });
  const metadataBytes = new TextEncoder().encode(metadata);

  // Serialize envelope
  const envelopeBytes = serializeEnvelope(photo.envelope);

  // Format: [metadata length (4 bytes)] [metadata] [envelope]
  const totalLength = 4 + metadataBytes.length + envelopeBytes.length;
  const result = new Uint8Array(totalLength);

  // Write metadata length as 32-bit big-endian
  const view = new DataView(result.buffer);
  view.setUint32(0, metadataBytes.length, false);

  // Write metadata
  result.set(metadataBytes, 4);

  // Write envelope
  result.set(envelopeBytes, 4 + metadataBytes.length);

  return result;
}

/**
 * Deserializes bytes back to an EncryptedPhoto.
 *
 * @param data - Serialized encrypted photo bytes
 * @returns EncryptedPhoto structure
 * @throws Error if data is invalid
 */
export function deserializeEncryptedPhoto(data: Uint8Array): EncryptedPhoto {
  if (!(data instanceof Uint8Array) || data.length < 5) {
    throw new Error('Invalid encrypted photo data: too short');
  }

  // Read metadata length
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const metadataLength = view.getUint32(0, false);

  if (data.length < 4 + metadataLength) {
    throw new Error('Invalid encrypted photo data: metadata truncated');
  }

  // Parse metadata
  const metadataBytes = data.slice(4, 4 + metadataLength);
  const metadataJson = new TextDecoder().decode(metadataBytes);
  const metadata = JSON.parse(metadataJson) as {
    variant: PhotoVariant;
    mimeType: string;
    originalSize: number;
  };

  // Deserialize envelope
  const envelopeBytes = data.slice(4 + metadataLength);
  const envelope = deserializeEnvelope(envelopeBytes);

  return {
    envelope,
    variant: metadata.variant,
    mimeType: metadata.mimeType,
    originalSize: metadata.originalSize,
  };
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validates that a DEK is valid
 */
function validateDek(dek: DataEncryptionKey): void {
  if (!(dek instanceof Uint8Array) || dek.length !== KEY_LENGTH) {
    throw new Error(`Invalid DEK: must be a ${KEY_LENGTH}-byte Uint8Array`);
  }
}

/**
 * Validates that a salt is valid
 */
function validateSalt(salt: Uint8Array): void {
  if (!(salt instanceof Uint8Array) || salt.length !== SALT_LENGTH) {
    throw new Error(`Invalid salt: must be a ${SALT_LENGTH}-byte Uint8Array`);
  }
}

/**
 * Validates an encrypted envelope structure
 */
function validateEnvelope(envelope: EncryptedEnvelope): void {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Invalid envelope: must be an object');
  }

  if (!(envelope.iv instanceof Uint8Array) || envelope.iv.length !== IV_LENGTH) {
    throw new Error(`Invalid envelope IV: must be a ${IV_LENGTH}-byte Uint8Array`);
  }

  if (!(envelope.salt instanceof Uint8Array) || envelope.salt.length !== SALT_LENGTH) {
    throw new Error(`Invalid envelope salt: must be a ${SALT_LENGTH}-byte Uint8Array`);
  }

  // Minimum ciphertext: 1 byte data + 16 bytes auth tag
  if (!(envelope.ciphertext instanceof Uint8Array) || envelope.ciphertext.length < AUTH_TAG_LENGTH + 1) {
    throw new Error('Invalid envelope ciphertext: too short');
  }
}
