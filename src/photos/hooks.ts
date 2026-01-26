/**
 * React Hooks for Photo Operations
 *
 * Provides convenient hooks for photo capture, processing, and display
 * within React components.
 *
 * @module photos/hooks
 *
 * @example
 * ```tsx
 * import { usePhotoCapture, usePhotoUploadStatus } from '@/photos/hooks';
 *
 * function PhotoButton({ customerId }) {
 *   const { processFile, isProcessing, progress, error } = usePhotoCapture({
 *     customerId,
 *   });
 *
 *   const handleFileSelect = async (e) => {
 *     const file = e.target.files[0];
 *     const result = await processFile(file);
 *     if (result.success) {
 *       console.log('Photo processed:', result.photoId);
 *     }
 *   };
 *
 *   return (
 *     <>
 *       <input type="file" onChange={handleFileSelect} disabled={isProcessing} />
 *       {progress && <p>{progress.message} ({progress.percentage}%)</p>}
 *       {error && <p>Error: {error}</p>}
 *     </>
 *   );
 * }
 * ```
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import type {
  ProcessPhotoOptions,
  ProcessPhotoResult,
  PipelineProgress,
} from './pipeline';
import type { BodyRegion } from '../db/schemas/photo-meta';
import type { DataEncryptionKey } from '../crypto/keys';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for usePhotoCapture hook
 */
export interface UsePhotoCaptureOptions {
  /** Customer ID for photos */
  customerId: string;
  /** Visit ID (optional) */
  visitId?: string;
  /** Body region for photos */
  bodyRegion?: BodyRegion;
  /** Caption for photos */
  caption?: string;
  /** Notes for photos */
  notes?: string;
  /** Callback on photo processed successfully */
  onPhotoProcessed?: (result: ProcessPhotoResult) => void;
  /** Callback on processing error */
  onError?: (error: string) => void;
}

/**
 * Return type for usePhotoCapture hook
 */
export interface UsePhotoCaptureReturn {
  /** Process a file through the photo pipeline */
  processFile: (file: File, metadata?: PhotoMetadata) => Promise<ProcessPhotoResult>;
  /** Process a video element (camera capture) through the photo pipeline */
  processVideo: (video: HTMLVideoElement, metadata?: PhotoMetadata) => Promise<ProcessPhotoResult>;
  /** Whether currently processing */
  isProcessing: boolean;
  /** Current progress */
  progress: PipelineProgress | null;
  /** Last error message */
  error: string | null;
  /** Clear error state */
  clearError: () => void;
  /** Whether DEK is available for encryption */
  isReady: boolean;
}

/**
 * Additional metadata for a photo
 */
export interface PhotoMetadata {
  bodyRegion?: BodyRegion;
  caption?: string;
  notes?: string;
  tags?: string[];
  treatmentContext?: string;
}

/**
 * Upload status for a photo
 */
export interface PhotoUploadStatus {
  photoId: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  progress?: number;
  error?: string;
}

// ============================================================================
// DEK Management (deprecated - use getDek() from useAuth() instead)
// ============================================================================

/**
 * @deprecated Use getDek() from useAuth() instead.
 * This function is kept for backward compatibility but is a no-op.
 */
export function setCurrentDek(_dek: DataEncryptionKey | null): void {
  // No-op - DEK is managed in AuthContext
}

/**
 * @deprecated Use getDek() from useAuth() instead.
 * This function always returns null.
 */
export function getCurrentDek(): DataEncryptionKey | null {
  return null;
}

// ============================================================================
// Main Hook
// ============================================================================

/**
 * Hook for processing photos through the capture pipeline.
 *
 * Handles:
 * - File and camera capture processing
 * - Progress tracking
 * - Error handling
 * - DEK availability checking
 *
 * @param options - Hook configuration
 * @returns Photo capture utilities
 *
 * @example
 * ```tsx
 * const { processFile, isProcessing, progress } = usePhotoCapture({
 *   customerId: 'cust_123',
 *   visitId: 'visit_456',
 *   onPhotoProcessed: (result) => toast.success('Photo saved!'),
 * });
 * ```
 */
export function usePhotoCapture(options: UsePhotoCaptureOptions): UsePhotoCaptureReturn {
  const { user, getDek, isDatabaseReady } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Track if mounted to prevent state updates after unmount
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // DEK is available when user is authenticated and database is ready
  const isReady = user !== null && isDatabaseReady && getDek() !== null;

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const processFile = useCallback(
    async (file: File, metadata?: PhotoMetadata): Promise<ProcessPhotoResult> => {
      if (!user) {
        const errorMsg = 'Not authenticated';
        setError(errorMsg);
        options.onError?.(errorMsg);
        return { success: false, error: errorMsg };
      }

      setIsProcessing(true);
      setProgress(null);
      setError(null);

      try {
        // Get DEK from auth context
        const dek = getDek();
        if (!dek) {
          throw new Error('Encryption key not available. Please log in again.');
        }

        // Get auth token from stored credentials
        const { loadStoredCredentials } = await import('../auth/prf');
        const storedCreds = loadStoredCredentials();
        const authToken = storedCreds?.lastUnlock?.authResult?.accessToken || '';

        // Import and run pipeline
        const { processPhotoFromFile } = await import('./pipeline');

        const processOptions: ProcessPhotoOptions = {
          customerId: options.customerId,
          visitId: options.visitId,
          dek,
          userId: user.userId,
          authToken,
          bodyRegion: metadata?.bodyRegion || options.bodyRegion,
          caption: metadata?.caption || options.caption,
          notes: metadata?.notes || options.notes,
          tags: metadata?.tags,
          treatmentContext: metadata?.treatmentContext,
          onProgress: (p) => {
            if (mountedRef.current) {
              setProgress(p);
            }
          },
        };

        const result = await processPhotoFromFile(file, processOptions);

        if (mountedRef.current) {
          if (result.success) {
            options.onPhotoProcessed?.(result);
          } else {
            const errorMsg = result.error || 'Processing failed';
            setError(errorMsg);
            options.onError?.(errorMsg);
          }
        }

        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to process photo';
        if (mountedRef.current) {
          setError(errorMsg);
        }
        options.onError?.(errorMsg);
        return { success: false, error: errorMsg };
      } finally {
        if (mountedRef.current) {
          setIsProcessing(false);
        }
      }
    },
    [user, getDek, options]
  );

  const processVideo = useCallback(
    async (video: HTMLVideoElement, metadata?: PhotoMetadata): Promise<ProcessPhotoResult> => {
      if (!user) {
        const errorMsg = 'Not authenticated';
        setError(errorMsg);
        options.onError?.(errorMsg);
        return { success: false, error: errorMsg };
      }

      setIsProcessing(true);
      setProgress(null);
      setError(null);

      try {
        // Get DEK from auth context
        const dek = getDek();
        if (!dek) {
          throw new Error('Encryption key not available. Please log in again.');
        }

        // Get auth token from stored credentials
        const { loadStoredCredentials } = await import('../auth/prf');
        const storedCreds = loadStoredCredentials();
        const authToken = storedCreds?.lastUnlock?.authResult?.accessToken || '';

        // Import and run pipeline
        const { processPhotoFromCamera } = await import('./pipeline');

        const processOptions: ProcessPhotoOptions = {
          customerId: options.customerId,
          visitId: options.visitId,
          dek,
          userId: user.userId,
          authToken,
          bodyRegion: metadata?.bodyRegion || options.bodyRegion,
          caption: metadata?.caption || options.caption,
          notes: metadata?.notes || options.notes,
          tags: metadata?.tags,
          treatmentContext: metadata?.treatmentContext,
          onProgress: (p) => {
            if (mountedRef.current) {
              setProgress(p);
            }
          },
        };

        const result = await processPhotoFromCamera(video, processOptions);

        if (mountedRef.current) {
          if (result.success) {
            options.onPhotoProcessed?.(result);
          } else {
            const errorMsg = result.error || 'Processing failed';
            setError(errorMsg);
            options.onError?.(errorMsg);
          }
        }

        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to capture photo';
        if (mountedRef.current) {
          setError(errorMsg);
        }
        options.onError?.(errorMsg);
        return { success: false, error: errorMsg };
      } finally {
        if (mountedRef.current) {
          setIsProcessing(false);
        }
      }
    },
    [user, getDek, options]
  );

  return {
    processFile,
    processVideo,
    isProcessing,
    progress,
    error,
    clearError,
    isReady,
  };
}

// ============================================================================
// Upload Status Hook
// ============================================================================

/**
 * Hook for tracking photo upload status.
 *
 * @param photoId - Photo ID to track (without variant suffix)
 * @returns Upload status information
 *
 * @example
 * ```tsx
 * const status = usePhotoUploadStatus('photo_abc123');
 *
 * if (status.status === 'uploading') {
 *   return <ProgressBar value={status.progress} />;
 * }
 * ```
 */
export function usePhotoUploadStatus(photoId: string | undefined): PhotoUploadStatus | null {
  const [status, setStatus] = useState<PhotoUploadStatus | null>(null);

  useEffect(() => {
    if (!photoId) {
      setStatus(null);
      return;
    }

    let unsubscribe: (() => void) | null = null;

    // Subscribe to queue events
    import('../sync/photos').then(({ subscribeQueueEvents, getQueuedItemsForPhoto }) => {
      // Get initial status
      getQueuedItemsForPhoto(photoId).then((items) => {
        if (items.length > 0) {
          const item = items[0];
          setStatus({
            photoId,
            status: item.status === 'completed' ? 'uploaded' : item.status,
            error: item.lastError,
          });
        }
      });

      // Subscribe to updates
      unsubscribe = subscribeQueueEvents((event) => {
        if (event.item?.photoId.startsWith(photoId)) {
          setStatus({
            photoId,
            status:
              event.type === 'item-completed' ? 'uploaded' :
              event.type === 'item-failed' ? 'failed' :
              event.type === 'item-progress' ? 'uploading' :
              'pending',
            progress: event.progress,
            error: event.item.lastError,
          });
        }
      });
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [photoId]);

  return status;
}

// ============================================================================
// Pending Uploads Hook
// ============================================================================

/**
 * Hook for getting count of pending uploads.
 *
 * @param customerId - Customer ID to filter by (optional)
 * @returns Count of pending uploads
 */
export function usePendingUploadCount(customerId?: string): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    const updateCount = async () => {
      try {
        if (customerId) {
          const { getPendingUploadCount } = await import('./pipeline');
          const c = await getPendingUploadCount(customerId);
          if (mounted) {
            setCount(c);
          }
        } else {
          const { getQueueStats } = await import('../sync/photos');
          const stats = await getQueueStats();
          if (mounted) {
            setCount(stats.pending + stats.uploading + stats.retrying);
          }
        }
      } catch {
        // Ignore errors
      }
    };

    updateCount();

    // Subscribe to queue events for updates
    let unsubscribe: (() => void) | null = null;
    import('../sync/photos').then(({ subscribeQueueEvents }) => {
      unsubscribe = subscribeQueueEvents(() => {
        updateCount();
      });
    });

    return () => {
      mounted = false;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [customerId]);

  return count;
}

// ============================================================================
// Exports
// ============================================================================

export type {
  ProcessPhotoOptions,
  ProcessPhotoResult,
  PipelineProgress,
};
