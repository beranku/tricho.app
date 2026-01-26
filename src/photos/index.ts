/**
 * Photo Module Index
 *
 * Exports all photo-related functionality:
 * - Capture and compression
 * - Encryption and decryption
 * - Pipeline orchestration
 * - React hooks
 *
 * @module photos
 *
 * @example
 * ```typescript
 * // Full pipeline for processing photos
 * import { processPhotoFromFile, usePhotoCapture } from '@/photos';
 *
 * // Direct capture and encryption
 * import {
 *   captureFromVideo,
 *   generateVariants,
 *   encryptCapturedPhoto,
 * } from '@/photos';
 *
 * // In React components
 * import { usePhotoCapture, usePhotoUploadStatus } from '@/photos';
 * ```
 */

// ============================================================================
// Capture Module
// ============================================================================

export {
  // Main capture functions
  captureFromVideo,
  importFromFile,
  importFromBlob,
  generateVariants,
  compressToVariant,
  // Helpers
  generatePhotoId,
  photoToArrayBuffer,
  photoToUint8Array,
  createBlobFromData,
  createPhotoUrl,
  revokePhotoUrl,
  isValidImage,
  getImageDimensions,
  // Constants
  VARIANT_PRESETS,
  // Error class
  PhotoCaptureError,
  // Types
  type PhotoVariant,
  type CompressionOptions,
  type CapturedPhoto,
  type PhotoVariants,
  type PhotoCaptureErrorCode,
} from './capture';

// ============================================================================
// Encryption Module
// ============================================================================

export {
  // Encryption functions
  encryptCapturedPhoto,
  encryptPhotoBlob,
  decryptPhotoBlob,
  decryptPhotoData,
  // Metadata helpers
  createEncryptedPhotoMetadata,
  generateStorageKey,
  extractEncryptedMetadata,
  // Error class
  PhotoEncryptionError,
  // Types
  type EncryptedPhotoBlob,
  type EncryptedPhotoVariants,
  type EncryptedPhotoMetadata,
  type PhotoEncryptionErrorCode,
} from './encrypt';

// ============================================================================
// Pipeline Module
// ============================================================================

export {
  // Main pipeline functions
  processPhotoFromFile,
  processPhotoFromCamera,
  // Status management
  updatePhotoUploadStatus,
  subscribeToPhotoUploadEvents,
  // Batch operations
  retryFailedUploadsForCustomer,
  getPendingUploadCount,
  deletePhoto,
  // Helpers
  getBasePhotoId,
  // Error class
  PhotoPipelineError,
  // Types
  type ProcessPhotoOptions,
  type ProcessPhotoResult,
  type PipelineProgress,
  type PipelineStage,
} from './pipeline';

// ============================================================================
// React Hooks
// ============================================================================

export {
  // Main hooks
  usePhotoCapture,
  usePhotoUploadStatus,
  usePendingUploadCount,
  // DEK management (internal, but exported for auth integration)
  setCurrentDek,
  getCurrentDek,
  // Types
  type UsePhotoCaptureOptions,
  type UsePhotoCaptureReturn,
  type PhotoMetadata,
  type PhotoUploadStatus,
} from './hooks';
