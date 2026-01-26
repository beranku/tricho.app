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

// ============================================================================
// Offline Photo Queue Types
// ============================================================================

/**
 * Status of a queued upload item
 */
export type QueueItemStatus = 'pending' | 'uploading' | 'retrying' | 'failed' | 'completed';

/**
 * A single item in the offline upload queue
 */
export interface QueuedUploadItem {
  /** Unique queue item ID */
  id: string;
  /** Photo ID */
  photoId: string;
  /** Photo variant */
  variant: PhotoVariant;
  /** Storage key for the upload */
  storageKey: string;
  /** Encrypted data to upload (stored as base64 for IndexedDB) */
  encryptedDataBase64: string;
  /** Content type */
  contentType: string;
  /** Auth token for the upload */
  authToken: string;
  /** Current status */
  status: QueueItemStatus;
  /** Number of retry attempts */
  retryCount: number;
  /** Maximum retry attempts before permanent failure */
  maxRetries: number;
  /** Timestamp when next retry should occur (Unix ms) */
  nextRetryAt: number | null;
  /** Timestamp when item was added to queue */
  createdAt: number;
  /** Timestamp of last update */
  updatedAt: number;
  /** Last error message if failed */
  lastError?: string;
  /** Last error code if failed */
  lastErrorCode?: PhotoSyncErrorCode;
  /** Priority (lower = higher priority) */
  priority: number;
}

/**
 * Options for adding an item to the upload queue
 */
export interface QueueUploadOptions {
  /** Photo ID */
  photoId: string;
  /** Photo variant */
  variant: PhotoVariant;
  /** Storage key */
  storageKey: string;
  /** Encrypted data to upload */
  encryptedData: Uint8Array;
  /** Content type */
  contentType?: string;
  /** Auth token */
  authToken: string;
  /** Maximum retry attempts (default: 5) */
  maxRetries?: number;
  /** Priority (default: 10, lower = higher priority) */
  priority?: number;
}

/**
 * Queue statistics
 */
export interface QueueStats {
  /** Total items in queue */
  total: number;
  /** Pending items (not yet attempted) */
  pending: number;
  /** Currently uploading */
  uploading: number;
  /** Waiting for retry */
  retrying: number;
  /** Permanently failed */
  failed: number;
  /** Successfully completed */
  completed: number;
  /** Oldest item timestamp */
  oldestItemAt: number | null;
  /** Newest item timestamp */
  newestItemAt: number | null;
}

/**
 * Queue event types
 */
export type QueueEventType =
  | 'item-added'
  | 'item-updated'
  | 'item-completed'
  | 'item-failed'
  | 'item-removed'
  | 'queue-processing-started'
  | 'queue-processing-stopped'
  | 'queue-cleared'
  | 'online-status-changed';

/**
 * Queue event data
 */
export interface QueueEvent {
  type: QueueEventType;
  item?: QueuedUploadItem;
  stats: QueueStats;
  isOnline: boolean;
  isProcessing: boolean;
}

/**
 * Queue event listener
 */
export type QueueEventListener = (event: QueueEvent) => void;

/**
 * Queue configuration options
 */
export interface QueueConfig {
  /** Maximum concurrent uploads (default: 2) */
  concurrency?: number;
  /** Base retry delay in ms (default: 1000) */
  baseRetryDelay?: number;
  /** Maximum retry delay in ms (default: 60000 = 1 minute) */
  maxRetryDelay?: number;
  /** Retry backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Auto-start processing when online (default: true) */
  autoProcess?: boolean;
  /** Process queue when visibility changes to visible (default: true) */
  processOnForeground?: boolean;
}

// ============================================================================
// Queue Module State
// ============================================================================

/** IndexedDB database name for queue storage */
const QUEUE_DB_NAME = 'tricho-photo-queue';
const QUEUE_DB_VERSION = 1;
const QUEUE_STORE_NAME = 'upload-queue';

/** Queue event listeners */
const queueEventListeners: Set<QueueEventListener> = new Set();

/** Cached database promise */
let queueDbPromise: Promise<IDBDatabase | null> | null = null;

/** Current queue state */
let isQueueProcessing = false;
let isQueueOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

/** Queue configuration */
let queueConfig: Required<QueueConfig> = {
  concurrency: 2,
  baseRetryDelay: 1000,
  maxRetryDelay: 60000,
  backoffMultiplier: 2,
  autoProcess: true,
  processOnForeground: true,
};

/** Active upload abort controllers */
const activeUploads: Map<string, AbortController> = new Map();

/** Processing interval reference */
let processingInterval: ReturnType<typeof setInterval> | null = null;

/** Network event handlers */
let queueOnlineHandler: (() => void) | null = null;
let queueOfflineHandler: (() => void) | null = null;
let queueVisibilityHandler: (() => void) | null = null;

// ============================================================================
// Queue IndexedDB Operations
// ============================================================================

/**
 * Opens the queue IndexedDB database
 */
function openQueueDb(): Promise<IDBDatabase | null> {
  if (queueDbPromise) {
    return queueDbPromise;
  }

  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }

  queueDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(QUEUE_DB_NAME, QUEUE_DB_VERSION);

    request.onerror = () => {
      queueDbPromise = null;
      reject(request.error);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(QUEUE_STORE_NAME)) {
        const store = db.createObjectStore(QUEUE_STORE_NAME, { keyPath: 'id' });
        // Create indexes for efficient queries
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('priority', 'priority', { unique: false });
        store.createIndex('nextRetryAt', 'nextRetryAt', { unique: false });
        store.createIndex('photoId', 'photoId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };
  });

  return queueDbPromise;
}

/**
 * Saves a queue item to IndexedDB
 */
async function saveQueueItem(item: QueuedUploadItem): Promise<void> {
  const db = await openQueueDb();
  if (!db) {
    throw new PhotoSyncError('IndexedDB not available', 'STORAGE_ERROR');
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE_NAME);
    const req = store.put(item);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(new PhotoSyncError('Failed to save queue item', 'STORAGE_ERROR', item.photoId, req.error));
  });
}

/**
 * Gets a queue item by ID
 */
async function getQueueItem(id: string): Promise<QueuedUploadItem | null> {
  const db = await openQueueDb();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE_NAME, 'readonly');
    const store = tx.objectStore(QUEUE_STORE_NAME);
    const req = store.get(id);

    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Gets all queue items
 */
async function getAllQueueItems(): Promise<QueuedUploadItem[]> {
  const db = await openQueueDb();
  if (!db) return [];

  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE_NAME, 'readonly');
    const store = tx.objectStore(QUEUE_STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Deletes a queue item
 */
async function deleteQueueItem(id: string): Promise<void> {
  const db = await openQueueDb();
  if (!db) return;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE_NAME);
    const req = store.delete(id);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Clears all items from the queue
 */
async function clearAllQueueItems(): Promise<void> {
  const db = await openQueueDb();
  if (!db) return;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(QUEUE_STORE_NAME);
    const req = store.clear();

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ============================================================================
// Queue Statistics and Helpers
// ============================================================================

/**
 * Calculates queue statistics from items
 */
function calculateQueueStats(items: QueuedUploadItem[]): QueueStats {
  const stats: QueueStats = {
    total: items.length,
    pending: 0,
    uploading: 0,
    retrying: 0,
    failed: 0,
    completed: 0,
    oldestItemAt: null,
    newestItemAt: null,
  };

  for (const item of items) {
    switch (item.status) {
      case 'pending':
        stats.pending++;
        break;
      case 'uploading':
        stats.uploading++;
        break;
      case 'retrying':
        stats.retrying++;
        break;
      case 'failed':
        stats.failed++;
        break;
      case 'completed':
        stats.completed++;
        break;
    }

    if (stats.oldestItemAt === null || item.createdAt < stats.oldestItemAt) {
      stats.oldestItemAt = item.createdAt;
    }
    if (stats.newestItemAt === null || item.createdAt > stats.newestItemAt) {
      stats.newestItemAt = item.createdAt;
    }
  }

  return stats;
}

/**
 * Generates a unique queue item ID
 */
function generateQueueItemId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `q_${crypto.randomUUID()}`;
  }
  return `q_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Calculates the next retry delay using exponential backoff
 */
function calculateRetryDelay(retryCount: number): number {
  const delay = queueConfig.baseRetryDelay * Math.pow(queueConfig.backoffMultiplier, retryCount);
  // Add jitter (±10%)
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, queueConfig.maxRetryDelay);
}

/**
 * Converts Uint8Array to base64 string for IndexedDB storage
 */
function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = '';
  const len = data.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

/**
 * Converts base64 string back to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ============================================================================
// Queue Event Handling
// ============================================================================

/**
 * Emits a queue event to all listeners
 */
async function emitQueueEvent(
  type: QueueEventType,
  item?: QueuedUploadItem
): Promise<void> {
  const items = await getAllQueueItems();
  const stats = calculateQueueStats(items);

  const event: QueueEvent = {
    type,
    item,
    stats,
    isOnline: isQueueOnline,
    isProcessing: isQueueProcessing,
  };

  for (const listener of queueEventListeners) {
    try {
      listener(event);
    } catch (error) {
      if (getEnv().debug) {
        console.warn('Queue event listener error:', error);
      }
    }
  }
}

/**
 * Subscribes to queue events
 *
 * @param listener - Event listener function
 * @returns Unsubscribe function
 *
 * @example
 * ```typescript
 * const unsubscribe = subscribeQueueEvents((event) => {
 *   console.log(`Queue event: ${event.type}, pending: ${event.stats.pending}`);
 * });
 * ```
 */
export function subscribeQueueEvents(listener: QueueEventListener): () => void {
  queueEventListeners.add(listener);
  return () => {
    queueEventListeners.delete(listener);
  };
}

// ============================================================================
// Queue Operations
// ============================================================================

/**
 * Initializes the offline photo queue with configuration.
 * Sets up network listeners and starts auto-processing if enabled.
 *
 * @param config - Queue configuration options
 *
 * @example
 * ```typescript
 * initPhotoQueue({
 *   concurrency: 3,
 *   autoProcess: true,
 *   processOnForeground: true,
 * });
 * ```
 */
export function initPhotoQueue(config: QueueConfig = {}): void {
  // Merge config with defaults
  queueConfig = {
    concurrency: config.concurrency ?? 2,
    baseRetryDelay: config.baseRetryDelay ?? 1000,
    maxRetryDelay: config.maxRetryDelay ?? 60000,
    backoffMultiplier: config.backoffMultiplier ?? 2,
    autoProcess: config.autoProcess ?? true,
    processOnForeground: config.processOnForeground ?? true,
  };

  // Set up network listeners
  setupQueueNetworkListeners();

  // Set up visibility listener for foreground processing
  if (queueConfig.processOnForeground) {
    setupQueueVisibilityListener();
  }

  // Start processing interval (checks every 5 seconds for items ready to retry)
  if (processingInterval) {
    clearInterval(processingInterval);
  }
  processingInterval = setInterval(() => {
    if (isQueueOnline && queueConfig.autoProcess && !isQueueProcessing) {
      processQueue().catch(() => {
        // Errors are handled inside processQueue
      });
    }
  }, 5000);

  // Initial processing if online
  if (isQueueOnline && queueConfig.autoProcess) {
    processQueue().catch(() => {
      // Errors are handled inside processQueue
    });
  }
}

/**
 * Sets up network event listeners for the queue
 */
function setupQueueNetworkListeners(): void {
  if (typeof window === 'undefined') {
    return;
  }

  // Clean up existing listeners
  cleanupQueueNetworkListeners();

  queueOnlineHandler = () => {
    isQueueOnline = true;
    emitQueueEvent('online-status-changed');

    // Auto-process when coming online
    if (queueConfig.autoProcess && !isQueueProcessing) {
      processQueue().catch(() => {
        // Errors are handled inside processQueue
      });
    }
  };

  queueOfflineHandler = () => {
    isQueueOnline = false;
    emitQueueEvent('online-status-changed');

    // Cancel active uploads when going offline
    for (const [, controller] of activeUploads) {
      controller.abort();
    }
    activeUploads.clear();
  };

  window.addEventListener('online', queueOnlineHandler);
  window.addEventListener('offline', queueOfflineHandler);
}

/**
 * Sets up visibility change listener for foreground processing
 */
function setupQueueVisibilityListener(): void {
  if (typeof document === 'undefined') {
    return;
  }

  if (queueVisibilityHandler) {
    document.removeEventListener('visibilitychange', queueVisibilityHandler);
  }

  queueVisibilityHandler = () => {
    if (document.visibilityState === 'visible' && isQueueOnline && !isQueueProcessing) {
      processQueue().catch(() => {
        // Errors are handled inside processQueue
      });
    }
  };

  document.addEventListener('visibilitychange', queueVisibilityHandler);
}

/**
 * Cleans up queue network listeners
 */
function cleanupQueueNetworkListeners(): void {
  if (typeof window !== 'undefined') {
    if (queueOnlineHandler) {
      window.removeEventListener('online', queueOnlineHandler);
      queueOnlineHandler = null;
    }
    if (queueOfflineHandler) {
      window.removeEventListener('offline', queueOfflineHandler);
      queueOfflineHandler = null;
    }
  }

  if (typeof document !== 'undefined' && queueVisibilityHandler) {
    document.removeEventListener('visibilitychange', queueVisibilityHandler);
    queueVisibilityHandler = null;
  }
}

/**
 * Adds a photo upload to the offline queue.
 * The upload will be attempted immediately if online, or queued for later if offline.
 *
 * @param options - Queue upload options
 * @returns Promise resolving to the queued item
 *
 * @example
 * ```typescript
 * const queuedItem = await queuePhotoUpload({
 *   photoId: 'photo_123',
 *   variant: 'original',
 *   storageKey: 'user_abc/photo_123/original.enc',
 *   encryptedData: encryptedBytes,
 *   authToken: 'jwt_token',
 * });
 * ```
 */
export async function queuePhotoUpload(options: QueueUploadOptions): Promise<QueuedUploadItem> {
  const now = Date.now();

  const item: QueuedUploadItem = {
    id: generateQueueItemId(),
    photoId: options.photoId,
    variant: options.variant,
    storageKey: options.storageKey,
    encryptedDataBase64: uint8ArrayToBase64(options.encryptedData),
    contentType: options.contentType ?? 'application/octet-stream',
    authToken: options.authToken,
    status: 'pending',
    retryCount: 0,
    maxRetries: options.maxRetries ?? 5,
    nextRetryAt: null,
    createdAt: now,
    updatedAt: now,
    priority: options.priority ?? 10,
  };

  // Save to IndexedDB
  await saveQueueItem(item);

  // Emit event
  await emitQueueEvent('item-added', item);

  // Trigger processing if online and auto-process enabled
  if (isQueueOnline && queueConfig.autoProcess && !isQueueProcessing) {
    // Use setTimeout to avoid blocking
    setTimeout(() => {
      processQueue().catch(() => {
        // Errors are handled inside processQueue
      });
    }, 0);
  }

  return item;
}

/**
 * Gets the current state of the upload queue.
 *
 * @returns Promise resolving to queue statistics
 */
export async function getQueueStats(): Promise<QueueStats> {
  const items = await getAllQueueItems();
  return calculateQueueStats(items);
}

/**
 * Gets all items currently in the queue.
 *
 * @returns Promise resolving to array of queued items
 */
export async function getQueuedItems(): Promise<QueuedUploadItem[]> {
  return getAllQueueItems();
}

/**
 * Gets queued items for a specific photo.
 *
 * @param photoId - Photo ID to filter by
 * @returns Promise resolving to array of queued items for the photo
 */
export async function getQueuedItemsForPhoto(photoId: string): Promise<QueuedUploadItem[]> {
  const items = await getAllQueueItems();
  return items.filter((item) => item.photoId === photoId);
}

/**
 * Removes a specific item from the queue.
 * Will abort the upload if currently in progress.
 *
 * @param itemId - Queue item ID to remove
 */
export async function removeFromQueue(itemId: string): Promise<void> {
  // Abort if currently uploading
  const controller = activeUploads.get(itemId);
  if (controller) {
    controller.abort();
    activeUploads.delete(itemId);
  }

  const item = await getQueueItem(itemId);
  await deleteQueueItem(itemId);
  await emitQueueEvent('item-removed', item ?? undefined);
}

/**
 * Removes all items for a specific photo from the queue.
 *
 * @param photoId - Photo ID to remove items for
 */
export async function removePhotoFromQueue(photoId: string): Promise<void> {
  const items = await getQueuedItemsForPhoto(photoId);
  for (const item of items) {
    await removeFromQueue(item.id);
  }
}

/**
 * Clears all items from the queue.
 * Will abort any active uploads.
 */
export async function clearQueue(): Promise<void> {
  // Abort all active uploads
  for (const [, controller] of activeUploads) {
    controller.abort();
  }
  activeUploads.clear();

  await clearAllQueueItems();
  await emitQueueEvent('queue-cleared');
}

/**
 * Retries a failed queue item immediately.
 *
 * @param itemId - Queue item ID to retry
 */
export async function retryQueueItem(itemId: string): Promise<void> {
  const item = await getQueueItem(itemId);
  if (!item) {
    throw new PhotoSyncError('Queue item not found', 'NOT_FOUND');
  }

  if (item.status !== 'failed' && item.status !== 'retrying') {
    throw new PhotoSyncError('Item is not in a retryable state', 'INVALID_DATA');
  }

  // Reset for retry
  item.status = 'pending';
  item.nextRetryAt = null;
  item.retryCount = 0;
  item.updatedAt = Date.now();

  await saveQueueItem(item);
  await emitQueueEvent('item-updated', item);

  // Trigger processing
  if (isQueueOnline && !isQueueProcessing) {
    processQueue().catch(() => {
      // Errors are handled inside processQueue
    });
  }
}

/**
 * Retries all failed items in the queue.
 */
export async function retryAllFailed(): Promise<void> {
  const items = await getAllQueueItems();
  const failedItems = items.filter((item) => item.status === 'failed');

  for (const item of failedItems) {
    item.status = 'pending';
    item.nextRetryAt = null;
    item.retryCount = 0;
    item.updatedAt = Date.now();
    await saveQueueItem(item);
  }

  if (failedItems.length > 0 && isQueueOnline && !isQueueProcessing) {
    processQueue().catch(() => {
      // Errors are handled inside processQueue
    });
  }
}

// ============================================================================
// Queue Processing
// ============================================================================

/**
 * Processes the upload queue.
 * Uploads items concurrently with the configured concurrency limit.
 * Handles retries with exponential backoff.
 */
export async function processQueue(): Promise<void> {
  if (!isQueueOnline) {
    return;
  }

  if (isQueueProcessing) {
    return;
  }

  isQueueProcessing = true;
  await emitQueueEvent('queue-processing-started');

  try {
    while (isQueueOnline) {
      // Get items ready to process
      const items = await getItemsReadyToProcess();

      if (items.length === 0) {
        break;
      }

      // Process in batches according to concurrency
      const batch = items.slice(0, queueConfig.concurrency);
      await Promise.all(batch.map((item) => processQueueItem(item)));
    }
  } finally {
    isQueueProcessing = false;
    await emitQueueEvent('queue-processing-stopped');
  }
}

/**
 * Gets items that are ready to be processed
 */
async function getItemsReadyToProcess(): Promise<QueuedUploadItem[]> {
  const items = await getAllQueueItems();
  const now = Date.now();

  return items
    .filter((item) => {
      // Skip completed or currently uploading
      if (item.status === 'completed' || item.status === 'uploading') {
        return false;
      }

      // Skip permanently failed
      if (item.status === 'failed') {
        return false;
      }

      // Check if retry time has passed
      if (item.status === 'retrying' && item.nextRetryAt && item.nextRetryAt > now) {
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      // Sort by priority first, then by creation time
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.createdAt - b.createdAt;
    });
}

/**
 * Processes a single queue item
 */
async function processQueueItem(item: QueuedUploadItem): Promise<void> {
  // Update status to uploading
  item.status = 'uploading';
  item.updatedAt = Date.now();
  await saveQueueItem(item);
  await emitQueueEvent('item-updated', item);

  // Create abort controller
  const controller = new AbortController();
  activeUploads.set(item.id, controller);

  try {
    // Convert base64 back to Uint8Array
    const encryptedData = base64ToUint8Array(item.encryptedDataBase64);

    // Attempt upload
    const result = await uploadPhoto({
      photoId: item.photoId,
      variant: item.variant,
      storageKey: item.storageKey,
      encryptedData,
      contentType: item.contentType,
      authToken: item.authToken,
      signal: controller.signal,
    });

    if (result.success) {
      // Upload succeeded - mark as completed
      item.status = 'completed';
      item.updatedAt = Date.now();
      await saveQueueItem(item);
      await emitQueueEvent('item-completed', item);

      // Remove completed item from queue after a short delay
      setTimeout(async () => {
        try {
          await deleteQueueItem(item.id);
        } catch {
          // Ignore cleanup errors
        }
      }, 1000);
    } else {
      // Upload failed
      await handleUploadFailure(item, result.error, result.errorCode);
    }
  } catch (error) {
    // Handle unexpected errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode: PhotoSyncErrorCode = error instanceof PhotoSyncError
      ? error.code
      : 'UPLOAD_FAILED';
    await handleUploadFailure(item, errorMessage, errorCode);
  } finally {
    activeUploads.delete(item.id);
  }
}

/**
 * Handles an upload failure with retry logic
 */
async function handleUploadFailure(
  item: QueuedUploadItem,
  errorMessage?: string,
  errorCode?: PhotoSyncErrorCode
): Promise<void> {
  item.retryCount++;
  item.lastError = errorMessage;
  item.lastErrorCode = errorCode;
  item.updatedAt = Date.now();

  // Determine if we should retry
  const isRetryable = isRetryableError(errorCode);
  const hasRetriesLeft = item.retryCount < item.maxRetries;

  if (isRetryable && hasRetriesLeft) {
    // Schedule retry with exponential backoff
    const retryDelay = calculateRetryDelay(item.retryCount);
    item.status = 'retrying';
    item.nextRetryAt = Date.now() + retryDelay;
    await saveQueueItem(item);
    await emitQueueEvent('item-updated', item);
  } else {
    // Mark as permanently failed
    item.status = 'failed';
    item.nextRetryAt = null;
    await saveQueueItem(item);
    await emitQueueEvent('item-failed', item);
  }
}

/**
 * Determines if an error is retryable
 */
function isRetryableError(errorCode?: PhotoSyncErrorCode): boolean {
  if (!errorCode) {
    return true; // Default to retryable
  }

  const nonRetryableErrors: PhotoSyncErrorCode[] = [
    'AUTH_ERROR',
    'INVALID_DATA',
    'NOT_FOUND',
    'ABORTED',
  ];

  return !nonRetryableErrors.includes(errorCode);
}

/**
 * Checks if the queue is currently processing
 */
export function isQueueActive(): boolean {
  return isQueueProcessing;
}

/**
 * Checks if the device is currently online (from queue's perspective)
 */
export function isQueueOnlineStatus(): boolean {
  return isQueueOnline;
}

/**
 * Stops queue processing and cleanup.
 * Call this when the user logs out.
 */
export function destroyPhotoQueue(): void {
  // Stop processing interval
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
  }

  // Cleanup network listeners
  cleanupQueueNetworkListeners();

  // Abort all active uploads
  for (const [, controller] of activeUploads) {
    controller.abort();
  }
  activeUploads.clear();

  // Reset state
  isQueueProcessing = false;
  queueEventListeners.clear();
  queueDbPromise = null;
}

// ============================================================================
// Queue Testing Exports
// ============================================================================

/**
 * Resets queue module state (for testing only)
 * @internal
 */
export function _resetPhotoQueueState(): void {
  destroyPhotoQueue();
  isQueueOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  queueConfig = {
    concurrency: 2,
    baseRetryDelay: 1000,
    maxRetryDelay: 60000,
    backoffMultiplier: 2,
    autoProcess: true,
    processOnForeground: true,
  };
}

/**
 * Gets the queue configuration (for testing only)
 * @internal
 */
export function _getQueueConfig(): Required<QueueConfig> {
  return { ...queueConfig };
}

/**
 * Sets queue online status (for testing only)
 * @internal
 */
export function _setQueueOnline(online: boolean): void {
  isQueueOnline = online;
}
