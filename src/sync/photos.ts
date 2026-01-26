/**
 * Photo Sync Module
 *
 * Handles upload and download of encrypted photo blobs to/from object storage.
 * Uses presigned URLs for secure, direct client-to-storage transfers.
 *
 * The photo sync module:
 * - Requests presigned URLs from the auth service for upload/download
 * - Uploads encrypted blobs directly to object storage (S3-compatible)
 * - Downloads encrypted blobs and decrypts them for display
 * - Updates photo metadata upload status in RxDB
 * - Works separately from JSON document sync (photos are large binary blobs)
 *
 * @module sync/photos
 *
 * @example
 * ```typescript
 * import { uploadPhoto, downloadPhoto, getUploadQueue } from '@/sync/photos';
 *
 * // Upload an encrypted photo
 * const result = await uploadPhoto({
 *   photoId: 'photo_123',
 *   storageKey: 'user_abc/photo_123/original.enc',
 *   encryptedData: encryptedBytes,
 *   mimeType: 'image/jpeg',
 *   authToken: 'jwt_token',
 * });
 *
 * // Download and decrypt a photo
 * const blob = await downloadPhoto({
 *   photoId: 'photo_123',
 *   storageKey: 'user_abc/photo_123/original.enc',
 *   dek: dataEncryptionKey,
 *   authToken: 'jwt_token',
 * });
 * ```
 */

import { getEnv, getAuthUrl, getObjectStorageUrl } from '../config/env';
import { decryptPhotoBlob } from '../photos/encrypt';
import type { DataEncryptionKey } from '../crypto/keys';
import type { PhotoVariant, PhotoUploadStatus } from '../db/schemas/photo-meta';

// ============================================================================
// Types
// ============================================================================

/**
 * Presigned URL response from the auth service
 */
export interface PresignedUrl {
  /** The presigned URL for upload or download */
  url: string;
  /** URL expiration timestamp (Unix ms) */
  expiresAt: number;
  /** HTTP method to use (PUT for upload, GET for download) */
  method: 'PUT' | 'GET';
  /** Required headers for the request */
  headers?: Record<string, string>;
}

/**
 * Options for requesting a presigned upload URL
 */
export interface PresignedUploadOptions {
  /** Storage key/path for the file */
  storageKey: string;
  /** Content type of the file */
  contentType: string;
  /** File size in bytes (for validation) */
  contentLength: number;
  /** Auth token for the request */
  authToken: string;
}

/**
 * Options for requesting a presigned download URL
 */
export interface PresignedDownloadOptions {
  /** Storage key/path for the file */
  storageKey: string;
  /** Auth token for the request */
  authToken: string;
}

/**
 * Options for uploading a photo
 */
export interface PhotoUploadOptions {
  /** Unique photo identifier */
  photoId: string;
  /** Photo variant (original, thumbnail, preview) */
  variant: PhotoVariant;
  /** Storage key/path for the encrypted blob */
  storageKey: string;
  /** Encrypted photo data to upload */
  encryptedData: Uint8Array;
  /** Content type (typically application/octet-stream for encrypted data) */
  contentType?: string;
  /** Auth token for the request */
  authToken: string;
  /** Optional abort signal for cancellation */
  signal?: AbortSignal;
  /** Optional progress callback */
  onProgress?: (progress: UploadProgress) => void;
}

/**
 * Result of a photo upload operation
 */
export interface PhotoUploadResult {
  /** Whether the upload succeeded */
  success: boolean;
  /** Photo ID */
  photoId: string;
  /** Photo variant */
  variant: PhotoVariant;
  /** Storage key used */
  storageKey: string;
  /** Upload timestamp */
  uploadedAt: number;
  /** Error message if failed */
  error?: string;
  /** Error code if failed */
  errorCode?: PhotoSyncErrorCode;
}

/**
 * Upload progress information
 */
export interface UploadProgress {
  /** Photo ID being uploaded */
  photoId: string;
  /** Photo variant */
  variant: PhotoVariant;
  /** Bytes uploaded so far */
  loaded: number;
  /** Total bytes to upload */
  total: number;
  /** Progress percentage (0-100) */
  percentage: number;
}

/**
 * Options for downloading a photo
 */
export interface PhotoDownloadOptions {
  /** Unique photo identifier */
  photoId: string;
  /** Storage key/path for the encrypted blob */
  storageKey: string;
  /** Data encryption key for decryption */
  dek: DataEncryptionKey;
  /** Auth token for the request */
  authToken: string;
  /** Optional abort signal for cancellation */
  signal?: AbortSignal;
  /** Optional progress callback */
  onProgress?: (progress: DownloadProgress) => void;
}

/**
 * Download progress information
 */
export interface DownloadProgress {
  /** Photo ID being downloaded */
  photoId: string;
  /** Bytes downloaded so far */
  loaded: number;
  /** Total bytes to download (may be 0 if unknown) */
  total: number;
  /** Progress percentage (0-100, or -1 if unknown) */
  percentage: number;
}

/**
 * Result of a photo download operation
 */
export interface PhotoDownloadResult {
  /** Whether the download succeeded */
  success: boolean;
  /** Photo ID */
  photoId: string;
  /** Decrypted photo blob (if successful) */
  blob?: Blob;
  /** Error message if failed */
  error?: string;
  /** Error code if failed */
  errorCode?: PhotoSyncErrorCode;
}

/**
 * Batch upload result for multiple photos
 */
export interface BatchUploadResult {
  /** Total photos attempted */
  total: number;
  /** Successfully uploaded count */
  successful: number;
  /** Failed upload count */
  failed: number;
  /** Individual results */
  results: PhotoUploadResult[];
}

/**
 * Photo sync event types
 */
export type PhotoSyncEventType =
  | 'upload-start'
  | 'upload-progress'
  | 'upload-complete'
  | 'upload-error'
  | 'download-start'
  | 'download-progress'
  | 'download-complete'
  | 'download-error';

/**
 * Photo sync event data
 */
export interface PhotoSyncEvent {
  type: PhotoSyncEventType;
  photoId: string;
  variant?: PhotoVariant;
  storageKey?: string;
  progress?: UploadProgress | DownloadProgress;
  result?: PhotoUploadResult | PhotoDownloadResult;
  error?: PhotoSyncError;
}

/**
 * Photo sync event listener
 */
export type PhotoSyncEventListener = (event: PhotoSyncEvent) => void;

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for photo sync operations
 */
export type PhotoSyncErrorCode =
  | 'PRESIGNED_URL_FAILED'
  | 'UPLOAD_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'DECRYPTION_FAILED'
  | 'NETWORK_ERROR'
  | 'AUTH_ERROR'
  | 'NOT_FOUND'
  | 'INVALID_DATA'
  | 'ABORTED'
  | 'TIMEOUT'
  | 'SERVER_ERROR'
  | 'STORAGE_ERROR';

/**
 * Error class for photo sync operations
 */
export class PhotoSyncError extends Error {
  constructor(
    message: string,
    public readonly code: PhotoSyncErrorCode,
    public readonly photoId?: string,
    public readonly cause?: Error,
    public readonly recoverable: boolean = true
  ) {
    super(message);
    this.name = 'PhotoSyncError';
  }
}

// ============================================================================
// Module State
// ============================================================================

/** Event listeners for photo sync events */
const eventListeners: Set<PhotoSyncEventListener> = new Set();

/** Cache for presigned URLs to avoid repeated requests */
const presignedUrlCache: Map<string, PresignedUrl> = new Map();

/** Cache expiry buffer (5 minutes before actual expiry) */
const CACHE_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// ============================================================================
// Event Handling
// ============================================================================

/**
 * Emits a photo sync event to all listeners
 */
function emitEvent(event: PhotoSyncEvent): void {
  for (const listener of eventListeners) {
    try {
      listener(event);
    } catch (error) {
      if (getEnv().debug) {
        console.warn('Photo sync event listener error:', error);
      }
    }
  }
}

/**
 * Subscribes to photo sync events
 *
 * @param listener - Event listener function
 * @returns Unsubscribe function
 *
 * @example
 * ```typescript
 * const unsubscribe = subscribePhotoSyncEvents((event) => {
 *   if (event.type === 'upload-progress') {
 *     console.log(`Upload ${event.progress?.percentage}% complete`);
 *   }
 * });
 * ```
 */
export function subscribePhotoSyncEvents(listener: PhotoSyncEventListener): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

// ============================================================================
// Presigned URL Management
// ============================================================================

/**
 * Gets a cached presigned URL if still valid, or null if expired/missing
 */
function getCachedPresignedUrl(cacheKey: string): PresignedUrl | null {
  const cached = presignedUrlCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  // Check if URL is about to expire
  const now = Date.now();
  if (cached.expiresAt - CACHE_EXPIRY_BUFFER_MS <= now) {
    presignedUrlCache.delete(cacheKey);
    return null;
  }

  return cached;
}

/**
 * Caches a presigned URL
 */
function cachePresignedUrl(cacheKey: string, url: PresignedUrl): void {
  presignedUrlCache.set(cacheKey, url);
}

/**
 * Clears the presigned URL cache
 */
export function clearPresignedUrlCache(): void {
  presignedUrlCache.clear();
}

/**
 * Requests a presigned URL for uploading a photo.
 *
 * @param options - Upload URL request options
 * @returns Promise resolving to presigned URL
 * @throws {PhotoSyncError} If the request fails
 *
 * @example
 * ```typescript
 * const presignedUrl = await getPresignedUploadUrl({
 *   storageKey: 'user_123/photo_abc/original.enc',
 *   contentType: 'application/octet-stream',
 *   contentLength: encryptedData.length,
 *   authToken: token,
 * });
 * ```
 */
export async function getPresignedUploadUrl(
  options: PresignedUploadOptions
): Promise<PresignedUrl> {
  const cacheKey = `upload:${options.storageKey}`;

  // Check cache first
  const cached = getCachedPresignedUrl(cacheKey);
  if (cached) {
    return cached;
  }

  // Request new presigned URL from auth service
  const endpoint = getAuthUrl('/api/storage/presign/upload');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${options.authToken}`,
      },
      body: JSON.stringify({
        key: options.storageKey,
        contentType: options.contentType,
        contentLength: options.contentLength,
      }),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new PhotoSyncError(
          'Authentication failed when requesting upload URL',
          'AUTH_ERROR',
          undefined,
          undefined,
          true
        );
      }

      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new PhotoSyncError(
        `Failed to get presigned upload URL: ${response.status} ${errorBody}`,
        'PRESIGNED_URL_FAILED',
        undefined,
        undefined,
        response.status >= 500
      );
    }

    const data = await response.json() as {
      url: string;
      expiresAt?: number;
      expiresIn?: number;
      headers?: Record<string, string>;
    };

    const presignedUrl: PresignedUrl = {
      url: data.url,
      expiresAt: data.expiresAt ?? (Date.now() + (data.expiresIn ?? 900) * 1000),
      method: 'PUT',
      headers: data.headers,
    };

    // Cache the URL
    cachePresignedUrl(cacheKey, presignedUrl);

    return presignedUrl;
  } catch (error) {
    if (error instanceof PhotoSyncError) {
      throw error;
    }

    throw new PhotoSyncError(
      `Network error requesting upload URL: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'NETWORK_ERROR',
      undefined,
      error instanceof Error ? error : undefined,
      true
    );
  }
}

/**
 * Requests a presigned URL for downloading a photo.
 *
 * @param options - Download URL request options
 * @returns Promise resolving to presigned URL
 * @throws {PhotoSyncError} If the request fails
 *
 * @example
 * ```typescript
 * const presignedUrl = await getPresignedDownloadUrl({
 *   storageKey: 'user_123/photo_abc/original.enc',
 *   authToken: token,
 * });
 * ```
 */
export async function getPresignedDownloadUrl(
  options: PresignedDownloadOptions
): Promise<PresignedUrl> {
  const cacheKey = `download:${options.storageKey}`;

  // Check cache first
  const cached = getCachedPresignedUrl(cacheKey);
  if (cached) {
    return cached;
  }

  // Request new presigned URL from auth service
  const endpoint = getAuthUrl('/api/storage/presign/download');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${options.authToken}`,
      },
      body: JSON.stringify({
        key: options.storageKey,
      }),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new PhotoSyncError(
          'Authentication failed when requesting download URL',
          'AUTH_ERROR',
          undefined,
          undefined,
          true
        );
      }

      if (response.status === 404) {
        throw new PhotoSyncError(
          `Photo not found: ${options.storageKey}`,
          'NOT_FOUND',
          undefined,
          undefined,
          false
        );
      }

      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new PhotoSyncError(
        `Failed to get presigned download URL: ${response.status} ${errorBody}`,
        'PRESIGNED_URL_FAILED',
        undefined,
        undefined,
        response.status >= 500
      );
    }

    const data = await response.json() as {
      url: string;
      expiresAt?: number;
      expiresIn?: number;
      headers?: Record<string, string>;
    };

    const presignedUrl: PresignedUrl = {
      url: data.url,
      expiresAt: data.expiresAt ?? (Date.now() + (data.expiresIn ?? 900) * 1000),
      method: 'GET',
      headers: data.headers,
    };

    // Cache the URL
    cachePresignedUrl(cacheKey, presignedUrl);

    return presignedUrl;
  } catch (error) {
    if (error instanceof PhotoSyncError) {
      throw error;
    }

    throw new PhotoSyncError(
      `Network error requesting download URL: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'NETWORK_ERROR',
      undefined,
      error instanceof Error ? error : undefined,
      true
    );
  }
}

// ============================================================================
// Upload Operations
// ============================================================================

/**
 * Uploads an encrypted photo blob to object storage.
 *
 * @param options - Upload options
 * @returns Promise resolving to upload result
 *
 * @example
 * ```typescript
 * const result = await uploadPhoto({
 *   photoId: 'photo_123',
 *   variant: 'original',
 *   storageKey: 'user_abc/photo_123/original.enc',
 *   encryptedData: encryptedBytes,
 *   authToken: 'jwt_token',
 * });
 *
 * if (result.success) {
 *   console.log('Uploaded at:', result.uploadedAt);
 * } else {
 *   console.error('Upload failed:', result.error);
 * }
 * ```
 */
export async function uploadPhoto(options: PhotoUploadOptions): Promise<PhotoUploadResult> {
  const {
    photoId,
    variant,
    storageKey,
    encryptedData,
    contentType = 'application/octet-stream',
    authToken,
    signal,
    onProgress,
  } = options;

  // Emit start event
  emitEvent({
    type: 'upload-start',
    photoId,
    variant,
    storageKey,
  });

  try {
    // Check for abort before starting
    if (signal?.aborted) {
      throw new PhotoSyncError(
        'Upload aborted before start',
        'ABORTED',
        photoId,
        undefined,
        true
      );
    }

    // Get presigned upload URL
    const presignedUrl = await getPresignedUploadUrl({
      storageKey,
      contentType,
      contentLength: encryptedData.length,
      authToken,
    });

    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': String(encryptedData.length),
      ...(presignedUrl.headers ?? {}),
    };

    // Upload to object storage using XMLHttpRequest for progress tracking
    const uploadResult = await uploadWithProgress(
      presignedUrl.url,
      encryptedData,
      headers,
      signal,
      (loaded, total) => {
        const progress: UploadProgress = {
          photoId,
          variant,
          loaded,
          total,
          percentage: total > 0 ? Math.round((loaded / total) * 100) : 0,
        };

        onProgress?.(progress);

        emitEvent({
          type: 'upload-progress',
          photoId,
          variant,
          storageKey,
          progress,
        });
      }
    );

    if (!uploadResult.ok) {
      throw new PhotoSyncError(
        `Upload failed with status ${uploadResult.status}: ${uploadResult.statusText}`,
        uploadResult.status >= 500 ? 'SERVER_ERROR' : 'STORAGE_ERROR',
        photoId,
        undefined,
        uploadResult.status >= 500
      );
    }

    const result: PhotoUploadResult = {
      success: true,
      photoId,
      variant,
      storageKey,
      uploadedAt: Date.now(),
    };

    // Emit complete event
    emitEvent({
      type: 'upload-complete',
      photoId,
      variant,
      storageKey,
      result,
    });

    return result;
  } catch (error) {
    const syncError = error instanceof PhotoSyncError
      ? error
      : new PhotoSyncError(
          `Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'UPLOAD_FAILED',
          photoId,
          error instanceof Error ? error : undefined,
          true
        );

    const result: PhotoUploadResult = {
      success: false,
      photoId,
      variant,
      storageKey,
      uploadedAt: 0,
      error: syncError.message,
      errorCode: syncError.code,
    };

    // Emit error event
    emitEvent({
      type: 'upload-error',
      photoId,
      variant,
      storageKey,
      result,
      error: syncError,
    });

    return result;
  }
}

/**
 * Uploads data with progress tracking using XMLHttpRequest
 */
function uploadWithProgress(
  url: string,
  data: Uint8Array,
  headers: Record<string, string>,
  signal?: AbortSignal,
  onProgress?: (loaded: number, total: number) => void
): Promise<{ ok: boolean; status: number; statusText: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // Handle abort signal
    if (signal) {
      if (signal.aborted) {
        reject(new PhotoSyncError('Upload aborted', 'ABORTED'));
        return;
      }

      signal.addEventListener('abort', () => {
        xhr.abort();
      });
    }

    // Setup progress handler
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded, event.total);
      }
    });

    // Setup completion handler
    xhr.addEventListener('load', () => {
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        statusText: xhr.statusText,
      });
    });

    // Setup error handler
    xhr.addEventListener('error', () => {
      reject(new PhotoSyncError(
        'Network error during upload',
        'NETWORK_ERROR'
      ));
    });

    // Setup abort handler
    xhr.addEventListener('abort', () => {
      reject(new PhotoSyncError(
        'Upload aborted',
        'ABORTED'
      ));
    });

    // Setup timeout handler
    xhr.addEventListener('timeout', () => {
      reject(new PhotoSyncError(
        'Upload timed out',
        'TIMEOUT'
      ));
    });

    // Open and send request
    xhr.open('PUT', url);

    // Set headers
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }

    // Set timeout (5 minutes for large uploads)
    xhr.timeout = 5 * 60 * 1000;

    xhr.send(data);
  });
}

/**
 * Uploads multiple photos in batch.
 *
 * @param uploads - Array of upload options
 * @param options - Batch options
 * @returns Promise resolving to batch result
 *
 * @example
 * ```typescript
 * const results = await uploadPhotosBatch([
 *   { photoId: 'p1', variant: 'original', storageKey: '...', encryptedData: d1, authToken: t },
 *   { photoId: 'p1', variant: 'thumbnail', storageKey: '...', encryptedData: d2, authToken: t },
 * ], { concurrency: 2 });
 * ```
 */
export async function uploadPhotosBatch(
  uploads: PhotoUploadOptions[],
  options: { concurrency?: number } = {}
): Promise<BatchUploadResult> {
  const { concurrency = 3 } = options;
  const results: PhotoUploadResult[] = [];

  // Process uploads with limited concurrency
  const chunks = chunkArray(uploads, concurrency);

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(
      chunk.map((upload) => uploadPhoto(upload))
    );
    results.push(...chunkResults);
  }

  const successful = results.filter((r) => r.success).length;

  return {
    total: uploads.length,
    successful,
    failed: uploads.length - successful,
    results,
  };
}

// ============================================================================
// Download Operations
// ============================================================================

/**
 * Downloads and decrypts a photo from object storage.
 *
 * @param options - Download options
 * @returns Promise resolving to download result with decrypted blob
 *
 * @example
 * ```typescript
 * const result = await downloadPhoto({
 *   photoId: 'photo_123',
 *   storageKey: 'user_abc/photo_123/original.enc',
 *   dek: dataEncryptionKey,
 *   authToken: 'jwt_token',
 * });
 *
 * if (result.success && result.blob) {
 *   const url = URL.createObjectURL(result.blob);
 *   // Use url to display image
 * }
 * ```
 */
export async function downloadPhoto(options: PhotoDownloadOptions): Promise<PhotoDownloadResult> {
  const {
    photoId,
    storageKey,
    dek,
    authToken,
    signal,
    onProgress,
  } = options;

  // Emit start event
  emitEvent({
    type: 'download-start',
    photoId,
    storageKey,
  });

  try {
    // Check for abort before starting
    if (signal?.aborted) {
      throw new PhotoSyncError(
        'Download aborted before start',
        'ABORTED',
        photoId,
        undefined,
        true
      );
    }

    // Get presigned download URL
    const presignedUrl = await getPresignedDownloadUrl({
      storageKey,
      authToken,
    });

    // Download encrypted data with progress tracking
    const encryptedData = await downloadWithProgress(
      presignedUrl.url,
      presignedUrl.headers ?? {},
      signal,
      (loaded, total) => {
        const progress: DownloadProgress = {
          photoId,
          loaded,
          total,
          percentage: total > 0 ? Math.round((loaded / total) * 100) : -1,
        };

        onProgress?.(progress);

        emitEvent({
          type: 'download-progress',
          photoId,
          storageKey,
          progress,
        });
      }
    );

    // Decrypt the photo
    let blob: Blob;
    try {
      blob = await decryptPhotoBlob(dek, photoId, encryptedData);
    } catch (error) {
      throw new PhotoSyncError(
        `Failed to decrypt photo: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'DECRYPTION_FAILED',
        photoId,
        error instanceof Error ? error : undefined,
        false
      );
    }

    const result: PhotoDownloadResult = {
      success: true,
      photoId,
      blob,
    };

    // Emit complete event
    emitEvent({
      type: 'download-complete',
      photoId,
      storageKey,
      result,
    });

    return result;
  } catch (error) {
    const syncError = error instanceof PhotoSyncError
      ? error
      : new PhotoSyncError(
          `Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'DOWNLOAD_FAILED',
          photoId,
          error instanceof Error ? error : undefined,
          true
        );

    const result: PhotoDownloadResult = {
      success: false,
      photoId,
      error: syncError.message,
      errorCode: syncError.code,
    };

    // Emit error event
    emitEvent({
      type: 'download-error',
      photoId,
      storageKey,
      result,
      error: syncError,
    });

    return result;
  }
}

/**
 * Downloads data with progress tracking
 */
async function downloadWithProgress(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
  onProgress?: (loaded: number, total: number) => void
): Promise<Uint8Array> {
  const response = await fetch(url, {
    method: 'GET',
    headers,
    signal,
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new PhotoSyncError(
        'Photo not found in storage',
        'NOT_FOUND'
      );
    }
    throw new PhotoSyncError(
      `Download failed with status ${response.status}`,
      response.status >= 500 ? 'SERVER_ERROR' : 'STORAGE_ERROR'
    );
  }

  // Get content length for progress tracking
  const contentLength = parseInt(response.headers.get('Content-Length') ?? '0', 10);

  // If no streaming support or no content-length, just get the blob
  if (!response.body || contentLength === 0) {
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
  }

  // Stream the response with progress tracking
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedLength = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
    receivedLength += value.length;

    onProgress?.(receivedLength, contentLength);
  }

  // Concatenate chunks
  const result = new Uint8Array(receivedLength);
  let position = 0;
  for (const chunk of chunks) {
    result.set(chunk, position);
    position += chunk.length;
  }

  return result;
}

/**
 * Downloads raw encrypted data without decryption.
 * Use this when you need the encrypted blob for caching or transfer.
 *
 * @param options - Download options (without DEK)
 * @returns Promise resolving to encrypted Uint8Array
 */
export async function downloadEncryptedPhoto(
  options: Omit<PhotoDownloadOptions, 'dek'>
): Promise<{ data: Uint8Array; storageKey: string }> {
  const { storageKey, authToken, signal, onProgress, photoId } = options;

  // Get presigned download URL
  const presignedUrl = await getPresignedDownloadUrl({
    storageKey,
    authToken,
  });

  // Download encrypted data
  const encryptedData = await downloadWithProgress(
    presignedUrl.url,
    presignedUrl.headers ?? {},
    signal,
    (loaded, total) => {
      onProgress?.({
        photoId,
        loaded,
        total,
        percentage: total > 0 ? Math.round((loaded / total) * 100) : -1,
      });
    }
  );

  return { data: encryptedData, storageKey };
}

// ============================================================================
// Status Helpers
// ============================================================================

/**
 * Determines the new upload status based on upload result
 */
export function getUploadStatusFromResult(result: PhotoUploadResult): PhotoUploadStatus {
  if (result.success) {
    return 'uploaded';
  }

  // Determine if failure is retryable
  const retryableCodes: PhotoSyncErrorCode[] = [
    'NETWORK_ERROR',
    'TIMEOUT',
    'SERVER_ERROR',
    'PRESIGNED_URL_FAILED',
  ];

  if (result.errorCode && retryableCodes.includes(result.errorCode)) {
    return 'failed'; // Retryable failure
  }

  return 'failed'; // Non-retryable failure
}

/**
 * Checks if a photo needs to be uploaded (pending or previously failed)
 */
export function needsUpload(uploadStatus: PhotoUploadStatus): boolean {
  return uploadStatus === 'pending' || uploadStatus === 'failed';
}

/**
 * Checks if a photo is being uploaded
 */
export function isUploading(uploadStatus: PhotoUploadStatus): boolean {
  return uploadStatus === 'uploading';
}

/**
 * Checks if a photo was successfully uploaded
 */
export function isUploaded(uploadStatus: PhotoUploadStatus): boolean {
  return uploadStatus === 'uploaded';
}

// ============================================================================
// Direct Storage URL (for environments with direct access)
// ============================================================================

/**
 * Gets a direct object storage URL for a photo.
 * Use this only in trusted environments where direct access is allowed.
 *
 * @param storageKey - Storage key/path for the photo
 * @returns Full URL to the object in storage
 */
export function getDirectStorageUrl(storageKey: string): string {
  return getObjectStorageUrl(storageKey);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Splits an array into chunks of specified size
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Creates a storage key for a photo variant
 *
 * @param userId - User identifier
 * @param photoId - Photo identifier
 * @param variant - Photo variant (original, thumbnail, preview)
 * @returns Storage key in format: {userId}/{photoId}/{variant}.enc
 */
export function createStorageKey(
  userId: string,
  photoId: string,
  variant: PhotoVariant
): string {
  // Sanitize userId for URL/path safety
  const safeUserId = userId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return `${safeUserId}/${photoId}/${variant}.enc`;
}

/**
 * Parses a storage key into its components
 *
 * @param storageKey - Storage key to parse
 * @returns Parsed components or null if invalid
 */
export function parseStorageKey(storageKey: string): {
  userId: string;
  photoId: string;
  variant: PhotoVariant;
} | null {
  const match = storageKey.match(/^([^/]+)\/([^/]+)\/(original|thumbnail|preview)\.enc$/);
  if (!match) {
    return null;
  }

  return {
    userId: match[1],
    photoId: match[2],
    variant: match[3] as PhotoVariant,
  };
}

// ============================================================================
// Testing Exports
// ============================================================================

/**
 * Resets module state (for testing only)
 * @internal
 */
export function _resetPhotoSyncState(): void {
  eventListeners.clear();
  presignedUrlCache.clear();
}

/**
 * Gets the current presigned URL cache (for testing only)
 * @internal
 */
export function _getPresignedUrlCache(): Map<string, PresignedUrl> {
  return presignedUrlCache;
}
