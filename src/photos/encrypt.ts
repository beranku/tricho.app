// Photo encryption module for TrichoApp
// Encrypts photo blobs before upload to object storage
// Reference: spec.md - Photo Pipeline (capture -> compress -> encrypt -> sync)

import {
  encryptPhoto,
  decryptPhoto,
  serializeEncryptedPhoto,
  deserializeEncryptedPhoto,
  type EncryptedPhoto,
  type PhotoVariant,
} from '../crypto/envelope';
import { type DataEncryptionKey } from '../crypto/keys';
import { type CapturedPhoto } from './capture';

/**
 * Result of encrypting a photo blob for upload
 * Contains all data needed to upload and later decrypt the photo
 */
export interface EncryptedPhotoBlob {
  /** Unique photo identifier */
  photoId: string;
  /** Photo variant (original, thumbnail, preview) */
  variant: PhotoVariant;
  /** Encrypted photo data ready for upload */
  encryptedData: Uint8Array;
  /** MIME type of the original photo */
  mimeType: string;
  /** Original size before encryption (for validation) */
  originalSize: number;
  /** Timestamp when encrypted */
  encryptedAt: number;
}

/**
 * Result of encrypting all variants of a photo
 * Used when uploading a complete photo with all variants
 */
export interface EncryptedPhotoVariants {
  original: EncryptedPhotoBlob;
  thumbnail: EncryptedPhotoBlob;
  preview: EncryptedPhotoBlob;
}

/**
 * Metadata stored alongside encrypted photo in database
 * This is stored unencrypted for querying purposes
 */
export interface EncryptedPhotoMetadata {
  /** Unique photo identifier */
  photoId: string;
  /** Photo variant */
  variant: PhotoVariant;
  /** Storage key/path for the encrypted blob */
  storageKey: string;
  /** Original MIME type */
  mimeType: string;
  /** Original dimensions */
  width: number;
  height: number;
  /** Original file size (unencrypted) */
  originalSize: number;
  /** Encrypted blob size */
  encryptedSize: number;
  /** When the photo was captured */
  capturedAt: number;
  /** When the photo was encrypted */
  encryptedAt: number;
  /** Upload status */
  uploadStatus: 'pending' | 'uploading' | 'uploaded' | 'failed';
  /** Last upload attempt timestamp */
  lastUploadAttempt?: number;
  /** Upload error message if failed */
  uploadError?: string;
}

/**
 * Errors specific to photo encryption operations
 */
export class PhotoEncryptionError extends Error {
  constructor(
    message: string,
    public readonly code: PhotoEncryptionErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'PhotoEncryptionError';
  }
}

export type PhotoEncryptionErrorCode =
  | 'ENCRYPTION_FAILED'
  | 'DECRYPTION_FAILED'
  | 'INVALID_BLOB'
  | 'INVALID_ENCRYPTED_DATA'
  | 'SIZE_MISMATCH'
  | 'BLOB_READ_ERROR';

/**
 * Encrypts a captured photo for upload.
 * Converts the photo blob to encrypted bytes that can be stored in object storage.
 *
 * @param dek - Data Encryption Key for envelope encryption
 * @param photo - CapturedPhoto from the capture module
 * @param variant - Photo variant (original, thumbnail, preview)
 * @returns Promise resolving to EncryptedPhotoBlob ready for upload
 * @throws PhotoEncryptionError if encryption fails
 *
 * @example
 * ```typescript
 * const captured = await captureFromVideo(videoElement);
 * const encrypted = await encryptCapturedPhoto(dek, captured, 'original');
 * // encrypted.encryptedData is ready for upload to object storage
 * ```
 */
export async function encryptCapturedPhoto(
  dek: DataEncryptionKey,
  photo: CapturedPhoto,
  variant: PhotoVariant
): Promise<EncryptedPhotoBlob> {
  // Convert blob to Uint8Array
  const photoData = await blobToUint8Array(photo.blob);

  try {
    // Use envelope encryption for the photo data
    const encryptedPhoto = await encryptPhoto(
      dek,
      photo.id,
      variant,
      photoData,
      photo.mimeType
    );

    // Serialize for storage/upload
    const encryptedData = serializeEncryptedPhoto(encryptedPhoto);

    return {
      photoId: photo.id,
      variant,
      encryptedData,
      mimeType: photo.mimeType,
      originalSize: photo.size,
      encryptedAt: Date.now(),
    };
  } catch (error) {
    throw new PhotoEncryptionError(
      `Failed to encrypt photo ${photo.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'ENCRYPTION_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Encrypts a raw Blob for upload.
 * Use this when you have a Blob that's not from the capture module.
 *
 * @param dek - Data Encryption Key for envelope encryption
 * @param photoId - Unique identifier for the photo
 * @param blob - Photo blob to encrypt
 * @param variant - Photo variant (original, thumbnail, preview)
 * @returns Promise resolving to EncryptedPhotoBlob ready for upload
 * @throws PhotoEncryptionError if encryption fails
 *
 * @example
 * ```typescript
 * const blob = await fetch('/photo.jpg').then(r => r.blob());
 * const encrypted = await encryptPhotoBlob(dek, 'photo_123', blob, 'original');
 * ```
 */
export async function encryptPhotoBlob(
  dek: DataEncryptionKey,
  photoId: string,
  blob: Blob,
  variant: PhotoVariant
): Promise<EncryptedPhotoBlob> {
  // Validate blob
  if (!blob || blob.size === 0) {
    throw new PhotoEncryptionError(
      'Invalid blob: blob is empty or undefined',
      'INVALID_BLOB'
    );
  }

  // Convert blob to Uint8Array
  const photoData = await blobToUint8Array(blob);
  const mimeType = blob.type || 'application/octet-stream';

  try {
    // Use envelope encryption for the photo data
    const encryptedPhoto = await encryptPhoto(
      dek,
      photoId,
      variant,
      photoData,
      mimeType
    );

    // Serialize for storage/upload
    const encryptedData = serializeEncryptedPhoto(encryptedPhoto);

    return {
      photoId,
      variant,
      encryptedData,
      mimeType,
      originalSize: blob.size,
      encryptedAt: Date.now(),
    };
  } catch (error) {
    throw new PhotoEncryptionError(
      `Failed to encrypt photo ${photoId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'ENCRYPTION_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Decrypts an encrypted photo blob back to its original form.
 * Use this after downloading encrypted data from object storage.
 *
 * @param dek - Data Encryption Key (must match key used for encryption)
 * @param photoId - Unique photo identifier (must match encryption)
 * @param encryptedData - Encrypted bytes from storage
 * @returns Promise resolving to decrypted Blob
 * @throws PhotoEncryptionError if decryption fails
 *
 * @example
 * ```typescript
 * const encryptedData = await downloadFromStorage(storageKey);
 * const blob = await decryptPhotoBlob(dek, 'photo_123', encryptedData);
 * const objectUrl = URL.createObjectURL(blob);
 * ```
 */
export async function decryptPhotoBlob(
  dek: DataEncryptionKey,
  photoId: string,
  encryptedData: Uint8Array
): Promise<Blob> {
  // Validate encrypted data
  if (!encryptedData || encryptedData.length === 0) {
    throw new PhotoEncryptionError(
      'Invalid encrypted data: data is empty or undefined',
      'INVALID_ENCRYPTED_DATA'
    );
  }

  try {
    // Deserialize the encrypted photo structure
    const encryptedPhoto = deserializeEncryptedPhoto(encryptedData);

    // Decrypt using envelope encryption
    const decryptedData = await decryptPhoto(dek, photoId, encryptedPhoto);

    // Validate size matches
    if (decryptedData.length !== encryptedPhoto.originalSize) {
      throw new PhotoEncryptionError(
        `Decrypted size mismatch: expected ${encryptedPhoto.originalSize}, got ${decryptedData.length}`,
        'SIZE_MISMATCH'
      );
    }

    // Create blob with original MIME type
    // Use slice to ensure we get a proper ArrayBuffer (not SharedArrayBuffer)
    const arrayBuffer = decryptedData.buffer.slice(
      decryptedData.byteOffset,
      decryptedData.byteOffset + decryptedData.byteLength
    ) as ArrayBuffer;
    return new Blob([arrayBuffer], { type: encryptedPhoto.mimeType });
  } catch (error) {
    if (error instanceof PhotoEncryptionError) {
      throw error;
    }
    throw new PhotoEncryptionError(
      `Failed to decrypt photo ${photoId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'DECRYPTION_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Decrypts an encrypted photo blob and returns the raw Uint8Array.
 * Use this when you need the raw bytes instead of a Blob.
 *
 * @param dek - Data Encryption Key
 * @param photoId - Unique photo identifier
 * @param encryptedData - Encrypted bytes from storage
 * @returns Promise resolving to decrypted bytes and metadata
 * @throws PhotoEncryptionError if decryption fails
 */
export async function decryptPhotoData(
  dek: DataEncryptionKey,
  photoId: string,
  encryptedData: Uint8Array
): Promise<{ data: Uint8Array; mimeType: string; variant: PhotoVariant }> {
  // Validate encrypted data
  if (!encryptedData || encryptedData.length === 0) {
    throw new PhotoEncryptionError(
      'Invalid encrypted data: data is empty or undefined',
      'INVALID_ENCRYPTED_DATA'
    );
  }

  try {
    // Deserialize the encrypted photo structure
    const encryptedPhoto = deserializeEncryptedPhoto(encryptedData);

    // Decrypt using envelope encryption
    const decryptedData = await decryptPhoto(dek, photoId, encryptedPhoto);

    return {
      data: decryptedData,
      mimeType: encryptedPhoto.mimeType,
      variant: encryptedPhoto.variant,
    };
  } catch (error) {
    if (error instanceof PhotoEncryptionError) {
      throw error;
    }
    throw new PhotoEncryptionError(
      `Failed to decrypt photo ${photoId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'DECRYPTION_FAILED',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Creates metadata for an encrypted photo.
 * Use this to create the database record that references the encrypted blob.
 *
 * @param photo - Source CapturedPhoto
 * @param encrypted - Encrypted photo blob result
 * @param storageKey - Storage path/key where encrypted blob will be stored
 * @returns EncryptedPhotoMetadata for database storage
 */
export function createEncryptedPhotoMetadata(
  photo: CapturedPhoto,
  encrypted: EncryptedPhotoBlob,
  storageKey: string
): EncryptedPhotoMetadata {
  return {
    photoId: encrypted.photoId,
    variant: encrypted.variant,
    storageKey,
    mimeType: encrypted.mimeType,
    width: photo.width,
    height: photo.height,
    originalSize: encrypted.originalSize,
    encryptedSize: encrypted.encryptedData.length,
    capturedAt: photo.capturedAt,
    encryptedAt: encrypted.encryptedAt,
    uploadStatus: 'pending',
  };
}

/**
 * Generates a storage key for an encrypted photo.
 * Format: {userId}/{photoId}/{variant}.enc
 *
 * @param userId - User identifier
 * @param photoId - Photo identifier
 * @param variant - Photo variant
 * @returns Storage key string
 */
export function generateStorageKey(
  userId: string,
  photoId: string,
  variant: PhotoVariant
): string {
  return `${userId}/${photoId}/${variant}.enc`;
}

/**
 * Extracts metadata from encrypted data without decrypting.
 * Useful for validating encrypted blobs or displaying upload status.
 *
 * @param encryptedData - Encrypted photo bytes
 * @returns Partial metadata extracted from the encrypted structure
 * @throws PhotoEncryptionError if data is invalid
 */
export function extractEncryptedMetadata(encryptedData: Uint8Array): {
  variant: PhotoVariant;
  mimeType: string;
  originalSize: number;
} {
  if (!encryptedData || encryptedData.length === 0) {
    throw new PhotoEncryptionError(
      'Invalid encrypted data: data is empty or undefined',
      'INVALID_ENCRYPTED_DATA'
    );
  }

  try {
    const encryptedPhoto = deserializeEncryptedPhoto(encryptedData);
    return {
      variant: encryptedPhoto.variant,
      mimeType: encryptedPhoto.mimeType,
      originalSize: encryptedPhoto.originalSize,
    };
  } catch (error) {
    throw new PhotoEncryptionError(
      `Failed to extract metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'INVALID_ENCRYPTED_DATA',
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Re-exports from envelope for convenience
 */
export type { EncryptedPhoto, PhotoVariant };

// ============================================================================
// Internal Helper Functions
// ============================================================================

/**
 * Converts a Blob to Uint8Array for encryption
 */
async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  try {
    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
  } catch (error) {
    throw new PhotoEncryptionError(
      `Failed to read blob: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'BLOB_READ_ERROR',
      error instanceof Error ? error : undefined
    );
  }
}
