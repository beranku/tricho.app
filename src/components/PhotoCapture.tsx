/**
 * Photo Capture Component
 *
 * Provides UI for capturing photos from camera or importing from file.
 * Integrates with the photo pipeline to process, encrypt, and queue uploads.
 *
 * Features:
 * - Camera capture with live preview
 * - File import from gallery
 * - Photo preview before saving
 * - Progress indication during processing
 * - Body region selection
 * - Caption and notes input
 * - Error handling with retry
 *
 * @module components/PhotoCapture
 *
 * @example
 * ```tsx
 * import { PhotoCaptureModal } from '@/components/PhotoCapture';
 *
 * function CustomerPhotos({ customerId }) {
 *   const [showCapture, setShowCapture] = useState(false);
 *
 *   return (
 *     <>
 *       <button onClick={() => setShowCapture(true)}>Add Photo</button>
 *       <PhotoCaptureModal
 *         isOpen={showCapture}
 *         onClose={() => setShowCapture(false)}
 *         customerId={customerId}
 *         onPhotoSaved={(result) => console.log('Saved:', result.photoId)}
 *       />
 *     </>
 *   );
 * }
 * ```
 */

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  type ChangeEvent,
} from 'react';
import type { BodyRegion } from '../db/schemas/photo-meta';
import type {
  ProcessPhotoResult,
  PipelineProgress,
} from '../photos/pipeline';
import { usePhotoCapture as usePhotoCaptureHook } from '../photos/hooks';

// ============================================================================
// Types
// ============================================================================

/**
 * Props for PhotoCapture component
 */
export interface PhotoCaptureProps {
  /** Customer ID for the photo */
  customerId: string;
  /** Visit ID (optional) */
  visitId?: string;
  /** Callback when photo is saved successfully */
  onPhotoSaved?: (result: ProcessPhotoResult) => void;
  /** Callback when capture is cancelled */
  onCancel?: () => void;
  /** Custom class name */
  className?: string;
}

/**
 * Props for PhotoCaptureModal
 */
export interface PhotoCaptureModalProps extends PhotoCaptureProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
}

/**
 * Capture mode
 */
type CaptureMode = 'select' | 'camera' | 'preview' | 'processing' | 'complete' | 'error';

/**
 * Selected photo preview data
 */
interface PhotoPreview {
  url: string;
  file?: File;
  width: number;
  height: number;
  source: 'camera' | 'file';
}

// ============================================================================
// Icons
// ============================================================================

function CameraIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function ImageIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function FlipCameraIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
      <path d="M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
      <circle cx="12" cy="12" r="3" />
      <path d="m18 22-3-3 3-3" />
      <path d="m6 2 3 3-3 3" />
    </svg>
  );
}

function CloseIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CheckIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function RetryIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function LoadingSpinner({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="photo-capture-spinner"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

// ============================================================================
// Body Region Options
// ============================================================================

const BODY_REGION_OPTIONS: { value: BodyRegion; label: string }[] = [
  { value: 'crown', label: 'Crown (Top)' },
  { value: 'front', label: 'Front (Hairline)' },
  { value: 'back', label: 'Back (Nape)' },
  { value: 'left_side', label: 'Left Side' },
  { value: 'right_side', label: 'Right Side' },
  { value: 'part_line', label: 'Part Line' },
  { value: 'full_head', label: 'Full Head' },
  { value: 'close_up', label: 'Close-up Detail' },
  { value: 'other', label: 'Other' },
];

// ============================================================================
// Main Component
// ============================================================================

/**
 * Photo capture component with camera and file import support.
 */
export function PhotoCapture({
  customerId,
  visitId,
  onPhotoSaved,
  onCancel,
  className = '',
}: PhotoCaptureProps) {
  // Photo capture hook handles encryption and upload
  const {
    processFile,
    isProcessing,
    progress,
    error: hookError,
    clearError,
    isReady,
  } = usePhotoCaptureHook({
    customerId,
    visitId,
    onPhotoProcessed: (result) => {
      setResult(result);
      setMode('complete');
      onPhotoSaved?.(result);
    },
    onError: (err) => {
      setError(err);
      setMode('error');
    },
  });

  // State
  const [mode, setMode] = useState<CaptureMode>('select');
  const [preview, setPreview] = useState<PhotoPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProcessPhotoResult | null>(null);

  // Form state
  const [bodyRegion, setBodyRegion] = useState<BodyRegion>('other');
  const [caption, setCaption] = useState('');
  const [notes, setNotes] = useState('');

  // Camera state
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ========================================================================
  // Camera Management
  // ========================================================================

  const startCamera = useCallback(async () => {
    setCameraError(null);

    try {
      // Stop existing stream
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      setStream(newStream);

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        await videoRef.current.play();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to access camera';
      setCameraError(message);
    }
  }, [facingMode, stream]);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stream]);

  const flipCamera = useCallback(() => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  }, []);

  // Restart camera when facing mode changes
  useEffect(() => {
    if (mode === 'camera' && stream) {
      startCamera();
    }
  }, [facingMode]);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stream]);

  // ========================================================================
  // Photo Capture
  // ========================================================================

  const captureFromCamera = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;

    // Set canvas size to video dimensions
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw video frame to canvas
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.drawImage(video, 0, 0);

    // Convert to blob URL for preview
    canvas.toBlob(
      (blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          setPreview({
            url,
            width: canvas.width,
            height: canvas.height,
            source: 'camera',
          });
          setMode('preview');
          stopCamera();
        }
      },
      'image/jpeg',
      0.9
    );
  }, [stopCamera]);

  const handleFileSelect = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    // Create preview URL
    const url = URL.createObjectURL(file);

    // Load image to get dimensions
    const img = new Image();
    img.onload = () => {
      setPreview({
        url,
        file,
        width: img.naturalWidth,
        height: img.naturalHeight,
        source: 'file',
      });
      setMode('preview');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError('Failed to load image file');
    };
    img.src = url;

    // Reset input for re-selection
    event.target.value = '';
  }, []);

  // ========================================================================
  // Photo Processing
  // ========================================================================

  const processPhoto = useCallback(async () => {
    if (!preview) {
      return;
    }

    if (!isReady) {
      setError('Encryption not available. Please log in again.');
      setMode('error');
      return;
    }

    setMode('processing');
    setError(null);
    clearError();

    try {
      // Get the file to process
      let file: File;
      if (preview.source === 'file' && preview.file) {
        file = preview.file;
      } else {
        // For camera captures, create a File from the blob URL
        const response = await fetch(preview.url);
        const blob = await response.blob();
        file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' });
      }

      // Process using the hook - callbacks handle success/error modes
      await processFile(file, {
        bodyRegion,
        caption: caption.trim() || undefined,
        notes: notes.trim() || undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to process photo';
      setError(message);
      setMode('error');
    }
  }, [preview, isReady, processFile, bodyRegion, caption, notes, clearError]);

  // ========================================================================
  // Mode Handlers
  // ========================================================================

  const enterCameraMode = useCallback(() => {
    setMode('camera');
    startCamera();
  }, [startCamera]);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const resetCapture = useCallback(() => {
    // Cleanup preview URL
    if (preview?.url) {
      URL.revokeObjectURL(preview.url);
    }

    setMode('select');
    setPreview(null);
    setError(null);
    setResult(null);
    setCaption('');
    setNotes('');
    setBodyRegion('other');
    clearError();
  }, [preview, clearError]);

  const handleCancel = useCallback(() => {
    stopCamera();
    resetCapture();
    onCancel?.();
  }, [stopCamera, resetCapture, onCancel]);

  const retryProcess = useCallback(() => {
    setError(null);
    setMode('preview');
  }, []);

  // ========================================================================
  // Render
  // ========================================================================

  const containerClasses = [
    'photo-capture',
    `photo-capture--${mode}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={containerClasses}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelect}
        className="photo-capture-file-input"
        aria-hidden="true"
      />

      {/* Hidden canvas for camera capture */}
      <canvas ref={canvasRef} className="photo-capture-canvas" aria-hidden="true" />

      {/* Mode: Select source */}
      {mode === 'select' && (
        <div className="photo-capture-select">
          <h3 className="photo-capture-title">Add Photo</h3>
          <div className="photo-capture-options">
            <button
              type="button"
              className="photo-capture-option"
              onClick={enterCameraMode}
            >
              <CameraIcon size={32} />
              <span>Take Photo</span>
            </button>
            <button
              type="button"
              className="photo-capture-option"
              onClick={openFilePicker}
            >
              <ImageIcon size={32} />
              <span>Choose from Gallery</span>
            </button>
          </div>
          <button
            type="button"
            className="photo-capture-cancel-button"
            onClick={handleCancel}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Mode: Camera */}
      {mode === 'camera' && (
        <div className="photo-capture-camera">
          <div className="photo-capture-camera-header">
            <button
              type="button"
              className="photo-capture-icon-button"
              onClick={handleCancel}
              aria-label="Close camera"
            >
              <CloseIcon size={24} />
            </button>
            <span className="photo-capture-camera-title">Take Photo</span>
            <button
              type="button"
              className="photo-capture-icon-button"
              onClick={flipCamera}
              aria-label="Flip camera"
            >
              <FlipCameraIcon size={24} />
            </button>
          </div>

          <div className="photo-capture-camera-view">
            {cameraError ? (
              <div className="photo-capture-camera-error">
                <p>{cameraError}</p>
                <button type="button" onClick={startCamera}>
                  <RetryIcon size={20} />
                  <span>Retry</span>
                </button>
              </div>
            ) : (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="photo-capture-video"
              />
            )}
          </div>

          <div className="photo-capture-camera-controls">
            <button
              type="button"
              className="photo-capture-shutter"
              onClick={captureFromCamera}
              disabled={!!cameraError}
              aria-label="Capture photo"
            >
              <span className="photo-capture-shutter-inner" />
            </button>
          </div>
        </div>
      )}

      {/* Mode: Preview */}
      {mode === 'preview' && preview && (
        <div className="photo-capture-preview">
          <div className="photo-capture-preview-header">
            <button
              type="button"
              className="photo-capture-icon-button"
              onClick={resetCapture}
              aria-label="Retake photo"
            >
              <CloseIcon size={24} />
            </button>
            <span className="photo-capture-preview-title">Preview</span>
            <button
              type="button"
              className="photo-capture-icon-button photo-capture-icon-button--primary"
              onClick={processPhoto}
              aria-label="Save photo"
            >
              <CheckIcon size={24} />
            </button>
          </div>

          <div className="photo-capture-preview-image">
            <img src={preview.url} alt="Photo preview" />
          </div>

          <div className="photo-capture-preview-form">
            <div className="photo-capture-form-group">
              <label htmlFor="photo-body-region">Body Region</label>
              <select
                id="photo-body-region"
                value={bodyRegion}
                onChange={(e) => setBodyRegion(e.target.value as BodyRegion)}
              >
                {BODY_REGION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="photo-capture-form-group">
              <label htmlFor="photo-caption">Caption (optional)</label>
              <input
                id="photo-caption"
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Brief description..."
                maxLength={200}
              />
            </div>

            <div className="photo-capture-form-group">
              <label htmlFor="photo-notes">Notes (optional)</label>
              <textarea
                id="photo-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional observations..."
                rows={3}
                maxLength={2000}
              />
            </div>
          </div>

          <div className="photo-capture-preview-actions">
            <button
              type="button"
              className="photo-capture-button photo-capture-button--secondary"
              onClick={resetCapture}
            >
              Retake
            </button>
            <button
              type="button"
              className="photo-capture-button photo-capture-button--primary"
              onClick={processPhoto}
            >
              Save Photo
            </button>
          </div>
        </div>
      )}

      {/* Mode: Processing */}
      {mode === 'processing' && (
        <div className="photo-capture-processing">
          <div className="photo-capture-processing-content">
            <LoadingSpinner size={48} />
            <h3 className="photo-capture-processing-title">Processing Photo</h3>
            {progress && (
              <>
                <p className="photo-capture-processing-message">{progress.message}</p>
                <div className="photo-capture-progress-bar">
                  <div
                    className="photo-capture-progress-fill"
                    style={{ width: `${progress.percentage}%` }}
                  />
                </div>
                <span className="photo-capture-progress-text">
                  {progress.percentage}%
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Mode: Complete */}
      {mode === 'complete' && (
        <div className="photo-capture-complete">
          <div className="photo-capture-complete-content">
            <div className="photo-capture-complete-icon">
              <CheckIcon size={48} />
            </div>
            <h3 className="photo-capture-complete-title">Photo Saved!</h3>
            <p className="photo-capture-complete-message">
              Your photo has been encrypted and queued for upload.
            </p>
            <div className="photo-capture-complete-actions">
              <button
                type="button"
                className="photo-capture-button photo-capture-button--secondary"
                onClick={resetCapture}
              >
                Take Another
              </button>
              <button
                type="button"
                className="photo-capture-button photo-capture-button--primary"
                onClick={handleCancel}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mode: Error */}
      {mode === 'error' && (
        <div className="photo-capture-error">
          <div className="photo-capture-error-content">
            <div className="photo-capture-error-icon">
              <CloseIcon size={48} />
            </div>
            <h3 className="photo-capture-error-title">Processing Failed</h3>
            <p className="photo-capture-error-message">{error}</p>
            <div className="photo-capture-error-actions">
              <button
                type="button"
                className="photo-capture-button photo-capture-button--secondary"
                onClick={handleCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="photo-capture-button photo-capture-button--primary"
                onClick={retryProcess}
              >
                <RetryIcon size={20} />
                <span>Retry</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Modal Component
// ============================================================================

/**
 * Photo capture modal for use in dialogs.
 */
export function PhotoCaptureModal({
  isOpen,
  onClose,
  ...props
}: PhotoCaptureModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="photo-capture-modal-overlay" role="dialog" aria-modal="true">
      <div className="photo-capture-modal">
        <PhotoCapture
          {...props}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export default PhotoCapture;
