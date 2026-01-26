/**
 * Photo Pipeline Module
 *
 * Orchestrates the complete photo flow:
 * 1. Capture/import photo from camera or file
 * 2. Compress and generate variants (original, thumbnail, preview)
 * 3. Encrypt each variant using envelope encryption
 * 4. Queue upload to object storage
 * 5. Save metadata document to RxDB
 * 6. Update metadata on upload completion
 *
 * This module ties together all photo-related modules and provides
 * a simple API for the UI to use.
 *
 * @module photos/pipeline
 *
 * @example
 * ```typescript
 * import { processPhotoFromFile, processPhotoFromCamera } from '@/photos/pipeline';
 *
 * // From file picker
 * const result = await processPhotoFromFile(file, {
 *   customerId: 'customer_123',
 *   visitId: 'visit_456',
 *   dek: dataEncryptionKey,
 *   userId: 'user_789',
 *   authToken: 'jwt_token',
 * });
 *
 * // From camera
 * const result = await processPhotoFromCamera(videoElement, {
 *   customerId: 'customer_123',
 *   dek: dataEncryptionKey,
 *   userId: 'user_789',
 *   authToken: 'jwt_token',
 * });
 * ```
 */

import type { DataEncryptionKey } from '../crypto/keys';
import type { PhotoMetaDocType, BodyRegion, CreatePhotoMetaInput } from '../db/schemas/photo-meta';
import type { CapturedPhoto, PhotoVariants, PhotoVariant } from './capture';
import type { EncryptedPhotoBlob } from './encrypt';
import type { QueuedUploadItem } from '../sync/photos';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for processing a photo
 */
export interface ProcessPhotoOptions {
  /** Customer ID the photo belongs to */
  customerId: string;
  /** Visit ID (optional) */
  visitId?: string;
  /** Data encryption key for envelope encryption */
  dek: DataEncryptionKey;
  /** User ID for storage key generation */
  userId: string;
  /** Auth token for upload requests */
  authToken: string;
  /** Body region shown in photo */
  bodyRegion?: BodyRegion;
  /** Caption for the photo */
  caption?: string;
  /** Notes about the photo */
  notes?: string;
  /** Tags for categorization */
  tags?: string[];
  /** Treatment context */
  treatmentContext?: string;
  /** Progress callback */
  onProgress?: (progress: PipelineProgress) => void;
}

/**
 * Progress information for the photo pipeline
 */
export interface PipelineProgress {
  /** Current stage of the pipeline */
  stage: PipelineStage;
  /** Overall progress percentage (0-100) */
  percentage: number;
  /** Current variant being processed (if applicable) */
  variant?: PhotoVariant;
  /** Detailed message */
  message: string;
}

/**
 * Pipeline processing stages
 */
export type PipelineStage =
  | 'capturing'
  | 'compressing'
  | 'encrypting'
  | 'saving_metadata'
  | 'queueing_upload'
  | 'complete'
  | 'error';

/**
 * Result of processing a photo through the pipeline
 */
export interface ProcessPhotoResult {
  /** Whether processing succeeded */
  success: boolean;
  /** Generated photo ID (base ID without variant suffix) */
  photoId?: string;
  /** Created metadata documents for each variant */
  metadata?: {
    original?: PhotoMetaDocType;
    thumbnail?: PhotoMetaDocType;
    preview?: PhotoMetaDocType;
  };
  /** Queued upload items */
  queuedUploads?: QueuedUploadItem[];
  /** Error message if failed */
  error?: string;
  /** Error stage if failed */
  errorStage?: PipelineStage;
}

/**
 * Errors specific to the photo pipeline
 */
export class PhotoPipelineError extends Error {
  constructor(
    message: string,
    public readonly stage: PipelineStage,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'PhotoPipelineError';
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Reports progress to the callback if provided
 */
function reportProgress(
  callback: ((progress: PipelineProgress) => void) | undefined,
  stage: PipelineStage,
  percentage: number,
  message: string,
  variant?: PhotoVariant
): void {
  if (callback) {
    callback({ stage, percentage, message, variant });
  }
}

/**
 * Gets the base photo ID from a variant ID
 * E.g., "photo_abc123_original" -> "photo_abc123"
 */
export function getBasePhotoId(variantId: string): string {
  const suffixes = ['_original', '_thumbnail', '_preview'];
  for (const suffix of suffixes) {
    if (variantId.endsWith(suffix)) {
      return variantId.slice(0, -suffix.length);
    }
  }
  return variantId;
}

/**
 * Computes SHA-256 hash of photo data for deduplication
 */
async function computeContentHash(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  // Convert to base64
  let binary = '';
  for (let i = 0; i < hashArray.length; i++) {
    binary += String.fromCharCode(hashArray[i]);
  }
  return btoa(binary);
}

// ============================================================================
// Main Pipeline Functions
// ============================================================================

/**
 * Processes a photo from a File input through the complete pipeline.
 *
 * @param file - File object from file picker or drag-drop
 * @param options - Processing options
 * @returns Promise resolving to processing result
 *
 * @example
 * ```typescript
 * const input = document.querySelector('input[type="file"]');
 * const file = input.files[0];
 *
 * const result = await processPhotoFromFile(file, {
 *   customerId: 'cust_123',
 *   dek: dataEncryptionKey,
 *   userId: 'user_456',
 *   authToken: token,
 *   bodyRegion: 'crown',
 *   caption: 'Initial assessment',
 *   onProgress: (p) => console.log(p.message),
 * });
 *
 * if (result.success) {
 *   console.log('Photo processed:', result.photoId);
 * }
 * ```
 */
export async function processPhotoFromFile(
  file: File,
  options: ProcessPhotoOptions
): Promise<ProcessPhotoResult> {
  try {
    // Import capture module
    const { generateVariants } = await import('./capture');

    // Stage 1: Capture/import
    reportProgress(options.onProgress, 'capturing', 5, 'Loading image...');

    // Stage 2: Generate variants
    reportProgress(options.onProgress, 'compressing', 10, 'Compressing image variants...');
    const variants = await generateVariants(file);

    // Continue with common pipeline
    return await processCapturedVariants(variants, {
      ...options,
      originalFilename: file.name,
    });
  } catch (error) {
    const stage: PipelineStage = 'capturing';
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to process file',
      errorStage: stage,
    };
  }
}

/**
 * Processes a photo from a video element (camera capture) through the complete pipeline.
 *
 * @param video - HTMLVideoElement with active camera stream
 * @param options - Processing options
 * @returns Promise resolving to processing result
 *
 * @example
 * ```typescript
 * const video = document.querySelector('video');
 *
 * const result = await processPhotoFromCamera(video, {
 *   customerId: 'cust_123',
 *   dek: dataEncryptionKey,
 *   userId: 'user_456',
 *   authToken: token,
 *   bodyRegion: 'front',
 *   onProgress: (p) => updateUI(p.percentage),
 * });
 * ```
 */
export async function processPhotoFromCamera(
  video: HTMLVideoElement,
  options: ProcessPhotoOptions
): Promise<ProcessPhotoResult> {
  try {
    // Import capture module
    const { generateVariants } = await import('./capture');

    // Stage 1: Capture
    reportProgress(options.onProgress, 'capturing', 5, 'Capturing photo...');

    // Stage 2: Generate variants
    reportProgress(options.onProgress, 'compressing', 10, 'Compressing image variants...');
    const variants = await generateVariants(video);

    // Continue with common pipeline
    return await processCapturedVariants(variants, options);
  } catch (error) {
    const stage: PipelineStage = 'capturing';
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to capture photo',
      errorStage: stage,
    };
  }
}

/**
 * Processes already-captured photo variants through encryption, upload queuing, and metadata saving.
 * This is the common pipeline used by both file import and camera capture.
 */
async function processCapturedVariants(
  variants: PhotoVariants,
  options: ProcessPhotoOptions & { originalFilename?: string }
): Promise<ProcessPhotoResult> {
  const { onProgress } = options;

  // Extract base photo ID from the original variant
  const basePhotoId = getBasePhotoId(variants.original.id);

  try {
    // Import required modules
    const { encryptCapturedPhoto, createEncryptedPhotoMetadata, generateStorageKey } = await import('./encrypt');
    const { queuePhotoUpload, initPhotoQueue } = await import('../sync/photos');
    const { getDatabase } = await import('../db/index');
    const { getPhotosCollection, createPhotoMetaDocument } = await import('../db/schemas');
    const { base64urlEncode } = await import('../crypto/utils');

    // Initialize photo queue (idempotent)
    initPhotoQueue({ autoProcess: true, processOnForeground: true });

    // Prepare results
    const metadata: ProcessPhotoResult['metadata'] = {};
    const queuedUploads: QueuedUploadItem[] = [];
    const variantTypes: PhotoVariant[] = ['original', 'thumbnail', 'preview'];

    // Process each variant
    let progressBase = 15;
    const progressPerVariant = 25;

    for (const variantType of variantTypes) {
      const capturedPhoto = variants[variantType];
      const progressOffset = variantTypes.indexOf(variantType) * progressPerVariant;

      // Stage 3: Encrypt
      reportProgress(
        onProgress,
        'encrypting',
        progressBase + progressOffset,
        `Encrypting ${variantType}...`,
        variantType
      );

      const encryptedBlob = await encryptCapturedPhoto(
        options.dek,
        capturedPhoto,
        variantType
      );

      // Generate storage key
      const storageKey = generateStorageKey(options.userId, basePhotoId, variantType);

      // Convert photo data to Uint8Array for hashing
      const photoData = await capturedPhoto.blob.arrayBuffer();
      const photoBytes = new Uint8Array(photoData);
      const contentHash = variantType === 'original' ? await computeContentHash(photoBytes) : undefined;

      // Stage 4: Create and save metadata
      reportProgress(
        onProgress,
        'saving_metadata',
        progressBase + progressOffset + 10,
        `Saving ${variantType} metadata...`,
        variantType
      );

      // Extract encryption IV and salt from encrypted data for metadata
      // The encrypted structure includes these for decryption
      const encryptionIv = base64urlEncode(encryptedBlob.encryptedData.slice(0, 12));
      const encryptionSalt = base64urlEncode(encryptedBlob.encryptedData.slice(12, 44));

      // Create metadata input
      const metadataInput: CreatePhotoMetaInput = {
        customerId: options.customerId,
        visitId: options.visitId,
        variant: variantType,
        uploadStatus: 'pending',
        capturedAt: capturedPhoto.capturedAt,
        storageKey,
        mimeType: capturedPhoto.mimeType,
        sizeBytes: capturedPhoto.size,
        width: capturedPhoto.width,
        height: capturedPhoto.height,
        encryptionIv,
        encryptionSalt,
        contentHash,
        // Encrypted fields (only for original)
        ...(variantType === 'original' && {
          caption: options.caption,
          notes: options.notes,
          bodyRegion: options.bodyRegion,
          tags: options.tags,
          originalFilename: options.originalFilename,
          treatmentContext: options.treatmentContext,
        }),
      };

      // Create document
      const metadataDoc = createPhotoMetaDocument(metadataInput);
      // Override the generated ID to use our base photo ID with variant
      metadataDoc.id = `${basePhotoId}_${variantType}`;

      // Save to RxDB
      const db = getDatabase();
      if (db) {
        const collection = getPhotosCollection(db);
        await collection.insert(metadataDoc);
      }

      metadata[variantType] = metadataDoc;

      // Stage 5: Queue upload
      reportProgress(
        onProgress,
        'queueing_upload',
        progressBase + progressOffset + 20,
        `Queuing ${variantType} for upload...`,
        variantType
      );

      const queuedItem = await queuePhotoUpload({
        photoId: metadataDoc.id,
        variant: variantType,
        storageKey,
        encryptedData: encryptedBlob.encryptedData,
        contentType: 'application/octet-stream',
        authToken: options.authToken,
        // Higher priority for thumbnails (shown first in UI)
        priority: variantType === 'thumbnail' ? 1 : variantType === 'preview' ? 5 : 10,
      });

      queuedUploads.push(queuedItem);
    }

    // Complete
    reportProgress(onProgress, 'complete', 100, 'Photo processed successfully!');

    return {
      success: true,
      photoId: basePhotoId,
      metadata,
      queuedUploads,
    };
  } catch (error) {
    let stage: PipelineStage = 'encrypting';

    if (error instanceof PhotoPipelineError) {
      stage = error.stage;
    }

    return {
      success: false,
      photoId: basePhotoId,
      error: error instanceof Error ? error.message : 'Pipeline processing failed',
      errorStage: stage,
    };
  }
}

/**
 * Updates photo metadata upload status when an upload completes.
 * Call this when receiving upload completion events from the queue.
 *
 * @param photoId - Photo variant ID (e.g., "photo_abc_original")
 * @param success - Whether upload succeeded
 * @param errorMessage - Error message if failed
 */
export async function updatePhotoUploadStatus(
  photoId: string,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  const { getDatabase } = await import('../db/index');
  const { getPhotosCollection } = await import('../db/schemas');

  const db = getDatabase();
  if (!db) {
    return;
  }

  const collection = getPhotosCollection(db);
  const doc = await collection.findOne(photoId).exec();

  if (!doc) {
    return;
  }

  await doc.update({
    $set: {
      uploadStatus: success ? 'uploaded' : 'failed',
      updatedAt: Date.now(),
    },
  });
}

/**
 * Subscribes to photo upload events and updates metadata accordingly.
 * Call this when the app initializes to keep metadata in sync with uploads.
 *
 * @returns Unsubscribe function
 */
export function subscribeToPhotoUploadEvents(): () => void {
  let unsubscribe: (() => void) | null = null;

  // Dynamically import to avoid SSR issues
  import('../sync/photos').then(({ subscribeQueueEvents }) => {
    unsubscribe = subscribeQueueEvents((event) => {
      if (event.type === 'item-completed' && event.item) {
        updatePhotoUploadStatus(event.item.photoId, true);
      } else if (event.type === 'item-failed' && event.item) {
        updatePhotoUploadStatus(event.item.photoId, false, event.item.lastError);
      }
    });
  });

  return () => {
    if (unsubscribe) {
      unsubscribe();
    }
  };
}

/**
 * Retries failed photo uploads for a customer.
 * Use this to give users a "Retry All" option.
 *
 * @param customerId - Customer ID to retry uploads for
 */
export async function retryFailedUploadsForCustomer(customerId: string): Promise<void> {
  const { getDatabase } = await import('../db/index');
  const { getPhotosCollection } = await import('../db/schemas');
  const { retryQueueItem, getQueuedItemsForPhoto } = await import('../sync/photos');

  const db = getDatabase();
  if (!db) {
    return;
  }

  // Find all failed photos for this customer
  const collection = getPhotosCollection(db);
  const failedPhotos = await collection
    .find({
      selector: {
        customerId,
        uploadStatus: 'failed',
        deleted: false,
      },
    })
    .exec();

  // Retry each failed upload
  for (const photo of failedPhotos) {
    const queuedItems = await getQueuedItemsForPhoto(photo.id);
    for (const item of queuedItems) {
      if (item.status === 'failed') {
        await retryQueueItem(item.id);
      }
    }
  }
}

/**
 * Gets the count of pending uploads for a customer.
 *
 * @param customerId - Customer ID
 * @returns Number of photos pending upload
 */
export async function getPendingUploadCount(customerId: string): Promise<number> {
  const { getDatabase } = await import('../db/index');
  const { getPhotosCollection } = await import('../db/schemas');

  const db = getDatabase();
  if (!db) {
    return 0;
  }

  const collection = getPhotosCollection(db);
  const pendingPhotos = await collection
    .find({
      selector: {
        customerId,
        uploadStatus: { $in: ['pending', 'uploading'] },
        deleted: false,
      },
    })
    .exec();

  return pendingPhotos.length;
}

/**
 * Deletes a photo and all its variants.
 * Soft deletes the metadata and removes from upload queue.
 *
 * @param basePhotoId - Base photo ID (without variant suffix)
 */
export async function deletePhoto(basePhotoId: string): Promise<void> {
  const { getDatabase } = await import('../db/index');
  const { getPhotosCollection } = await import('../db/schemas');
  const { removePhotoFromQueue } = await import('../sync/photos');

  const db = getDatabase();
  if (!db) {
    return;
  }

  const collection = getPhotosCollection(db);
  const variantTypes: PhotoVariant[] = ['original', 'thumbnail', 'preview'];

  for (const variant of variantTypes) {
    const photoId = `${basePhotoId}_${variant}`;

    // Remove from upload queue
    await removePhotoFromQueue(photoId);

    // Soft delete metadata
    const doc = await collection.findOne(photoId).exec();
    if (doc) {
      await doc.update({
        $set: {
          deleted: true,
          updatedAt: Date.now(),
        },
      });
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

export type {
  CapturedPhoto,
  PhotoVariants,
  PhotoVariant,
  EncryptedPhotoBlob,
};
