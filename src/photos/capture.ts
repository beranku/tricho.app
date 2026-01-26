// Photo capture and compression module for TrichoApp
// Handles photo capture from video streams and file imports
// Reference: spec.md - Photo Pipeline (capture -> compress -> encrypt -> sync)

import {
  getSettings,
  getJpegQuality,
  getMaxWidth,
  getMaxHeight,
  type AppSettings,
} from '../scripts/settings';

/**
 * Photo variant types matching the encryption module
 * Original: Full resolution compressed photo
 * Thumbnail: Small preview for lists (typically 200x200)
 * Preview: Medium resolution for detail views
 */
export type PhotoVariant = 'original' | 'thumbnail' | 'preview';

/**
 * Configuration for photo compression
 */
export interface CompressionOptions {
  /** Maximum width in pixels (default from settings) */
  maxWidth?: number;
  /** Maximum height in pixels (default from settings) */
  maxHeight?: number;
  /** JPEG quality 0-1 (default from settings) */
  quality?: number;
  /** Output MIME type (default: 'image/jpeg') */
  mimeType?: 'image/jpeg' | 'image/webp' | 'image/png';
}

/**
 * Result of a photo capture or import operation
 */
export interface CapturedPhoto {
  /** Unique identifier for the photo */
  id: string;
  /** The compressed photo blob */
  blob: Blob;
  /** Width of the resulting image */
  width: number;
  /** Height of the resulting image */
  height: number;
  /** Size in bytes */
  size: number;
  /** MIME type of the blob */
  mimeType: string;
  /** Timestamp when captured */
  capturedAt: number;
  /** Source of the photo */
  source: 'camera' | 'file';
  /** Original filename if from file import */
  originalFilename?: string;
  /** Original dimensions before compression */
  originalWidth?: number;
  /** Original dimensions before compression */
  originalHeight?: number;
}

/**
 * Result of generating photo variants
 */
export interface PhotoVariants {
  original: CapturedPhoto;
  thumbnail: CapturedPhoto;
  preview: CapturedPhoto;
}

/**
 * Preset compression configurations for different variants
 */
export const VARIANT_PRESETS: Record<PhotoVariant, CompressionOptions> = {
  original: {
    // Uses settings defaults
  },
  thumbnail: {
    maxWidth: 200,
    maxHeight: 200,
    quality: 0.7,
    mimeType: 'image/jpeg',
  },
  preview: {
    maxWidth: 800,
    maxHeight: 600,
    quality: 0.8,
    mimeType: 'image/jpeg',
  },
};

/**
 * Errors specific to photo capture operations
 */
export class PhotoCaptureError extends Error {
  constructor(
    message: string,
    public readonly code: PhotoCaptureErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'PhotoCaptureError';
  }
}

export type PhotoCaptureErrorCode =
  | 'VIDEO_NOT_READY'
  | 'CANVAS_ERROR'
  | 'BLOB_CREATION_FAILED'
  | 'FILE_READ_ERROR'
  | 'INVALID_IMAGE'
  | 'IMAGE_LOAD_ERROR'
  | 'COMPRESSION_ERROR';

/**
 * Generates a unique photo ID using timestamp and random bytes.
 * Format: photo_{timestamp}_{random}
 *
 * @returns Unique photo ID string
 */
export function generatePhotoId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.getRandomValues(new Uint8Array(6));
  const randomHex = Array.from(random)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `photo_${timestamp}_${randomHex}`;
}

/**
 * Captures a photo from a video element and compresses it.
 * Uses an offscreen canvas to draw the video frame and convert to blob.
 *
 * @param video - HTMLVideoElement with active video stream
 * @param options - Optional compression settings
 * @returns Promise resolving to CapturedPhoto
 * @throws PhotoCaptureError if capture fails
 *
 * @example
 * ```typescript
 * const photo = await captureFromVideo(videoElement);
 * // photo.blob contains the compressed JPEG
 * ```
 */
export async function captureFromVideo(
  video: HTMLVideoElement,
  options: CompressionOptions = {}
): Promise<CapturedPhoto> {
  // Validate video is ready
  if (!video.videoWidth || !video.videoHeight) {
    throw new PhotoCaptureError(
      'Video is not ready: no dimensions available',
      'VIDEO_NOT_READY'
    );
  }

  const srcWidth = video.videoWidth;
  const srcHeight = video.videoHeight;

  // Calculate target dimensions
  const { targetWidth, targetHeight } = calculateTargetDimensions(
    srcWidth,
    srcHeight,
    options
  );

  // Create canvas and draw video frame
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new PhotoCaptureError(
      'Failed to get canvas 2d context',
      'CANVAS_ERROR'
    );
  }

  // Draw video frame to canvas with scaling
  ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

  // Convert to blob
  const mimeType = options.mimeType ?? 'image/jpeg';
  const quality = options.quality ?? getJpegQuality();

  const blob = await canvasToBlob(canvas, mimeType, quality);

  return {
    id: generatePhotoId(),
    blob,
    width: targetWidth,
    height: targetHeight,
    size: blob.size,
    mimeType,
    capturedAt: Date.now(),
    source: 'camera',
    originalWidth: srcWidth,
    originalHeight: srcHeight,
  };
}

/**
 * Imports and compresses a photo from a File object.
 * Handles various image formats and applies compression.
 *
 * @param file - File object (typically from <input type="file">)
 * @param options - Optional compression settings
 * @returns Promise resolving to CapturedPhoto
 * @throws PhotoCaptureError if import fails
 *
 * @example
 * ```typescript
 * const input = document.querySelector('input[type="file"]');
 * const file = input.files[0];
 * const photo = await importFromFile(file);
 * ```
 */
export async function importFromFile(
  file: File,
  options: CompressionOptions = {}
): Promise<CapturedPhoto> {
  // Validate file is an image
  if (!file.type.startsWith('image/')) {
    throw new PhotoCaptureError(
      `Invalid file type: ${file.type}. Expected an image.`,
      'INVALID_IMAGE'
    );
  }

  // Read file as data URL
  const dataUrl = await readFileAsDataUrl(file);

  // Load image to get dimensions
  const img = await loadImage(dataUrl);

  const srcWidth = img.naturalWidth;
  const srcHeight = img.naturalHeight;

  // Calculate target dimensions
  const { targetWidth, targetHeight } = calculateTargetDimensions(
    srcWidth,
    srcHeight,
    options
  );

  // Create canvas and draw image
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new PhotoCaptureError(
      'Failed to get canvas 2d context',
      'CANVAS_ERROR'
    );
  }

  // Draw image to canvas with scaling
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  // Convert to blob
  const mimeType = options.mimeType ?? 'image/jpeg';
  const quality = options.quality ?? getJpegQuality();

  const blob = await canvasToBlob(canvas, mimeType, quality);

  return {
    id: generatePhotoId(),
    blob,
    width: targetWidth,
    height: targetHeight,
    size: blob.size,
    mimeType,
    capturedAt: Date.now(),
    source: 'file',
    originalFilename: file.name,
    originalWidth: srcWidth,
    originalHeight: srcHeight,
  };
}

/**
 * Imports and compresses a photo from a Blob or ArrayBuffer.
 * Useful for processing photos from other sources (clipboard, fetch, etc).
 *
 * @param data - Blob or ArrayBuffer containing image data
 * @param mimeType - MIME type of the source image
 * @param options - Optional compression settings
 * @returns Promise resolving to CapturedPhoto
 * @throws PhotoCaptureError if import fails
 */
export async function importFromBlob(
  data: Blob | ArrayBuffer,
  mimeType: string,
  options: CompressionOptions = {}
): Promise<CapturedPhoto> {
  // Convert to Blob if ArrayBuffer
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });

  // Create object URL for loading
  const objectUrl = URL.createObjectURL(blob);

  try {
    // Load image to get dimensions
    const img = await loadImage(objectUrl);

    const srcWidth = img.naturalWidth;
    const srcHeight = img.naturalHeight;

    // Calculate target dimensions
    const { targetWidth, targetHeight } = calculateTargetDimensions(
      srcWidth,
      srcHeight,
      options
    );

    // Create canvas and draw image
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new PhotoCaptureError(
        'Failed to get canvas 2d context',
        'CANVAS_ERROR'
      );
    }

    // Draw image to canvas with scaling
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    // Convert to blob
    const outputMimeType = options.mimeType ?? 'image/jpeg';
    const quality = options.quality ?? getJpegQuality();

    const resultBlob = await canvasToBlob(canvas, outputMimeType, quality);

    return {
      id: generatePhotoId(),
      blob: resultBlob,
      width: targetWidth,
      height: targetHeight,
      size: resultBlob.size,
      mimeType: outputMimeType,
      capturedAt: Date.now(),
      source: 'file',
      originalWidth: srcWidth,
      originalHeight: srcHeight,
    };
  } finally {
    // Clean up object URL
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Generates all photo variants (original, thumbnail, preview) from a source image.
 * The original uses settings-based compression, while thumbnail and preview
 * use preset sizes optimized for their use cases.
 *
 * @param source - HTMLVideoElement or File to generate variants from
 * @returns Promise resolving to all three photo variants
 * @throws PhotoCaptureError if generation fails
 *
 * @example
 * ```typescript
 * const variants = await generateVariants(videoElement);
 * // variants.original - full resolution
 * // variants.thumbnail - 200x200 for lists
 * // variants.preview - 800x600 for detail view
 * ```
 */
export async function generateVariants(
  source: HTMLVideoElement | File
): Promise<PhotoVariants> {
  // Generate base photo ID for all variants
  const baseId = generatePhotoId();
  const timestamp = Date.now();

  // Determine source type and get base data
  let img: HTMLImageElement | HTMLVideoElement;
  let srcWidth: number;
  let srcHeight: number;
  let captureSource: 'camera' | 'file';
  let originalFilename: string | undefined;

  if (source instanceof HTMLVideoElement) {
    if (!source.videoWidth || !source.videoHeight) {
      throw new PhotoCaptureError(
        'Video is not ready: no dimensions available',
        'VIDEO_NOT_READY'
      );
    }
    img = source;
    srcWidth = source.videoWidth;
    srcHeight = source.videoHeight;
    captureSource = 'camera';
  } else {
    // Load image from file
    const dataUrl = await readFileAsDataUrl(source);
    const loadedImg = await loadImage(dataUrl);
    img = loadedImg;
    srcWidth = loadedImg.naturalWidth;
    srcHeight = loadedImg.naturalHeight;
    captureSource = 'file';
    originalFilename = source.name;
  }

  // Generate each variant
  const variantTypes: PhotoVariant[] = ['original', 'thumbnail', 'preview'];
  const results: Partial<PhotoVariants> = {};

  for (const variantType of variantTypes) {
    const preset = VARIANT_PRESETS[variantType];

    // Merge preset with settings for original variant
    const options: CompressionOptions =
      variantType === 'original'
        ? {
            maxWidth: getMaxWidth(),
            maxHeight: getMaxHeight(),
            quality: getJpegQuality(),
            mimeType: 'image/jpeg',
            ...preset,
          }
        : preset;

    const { targetWidth, targetHeight } = calculateTargetDimensions(
      srcWidth,
      srcHeight,
      options
    );

    // Create canvas and draw
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new PhotoCaptureError(
        'Failed to get canvas 2d context',
        'CANVAS_ERROR'
      );
    }

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const mimeType = options.mimeType ?? 'image/jpeg';
    const quality = options.quality ?? getJpegQuality();

    const blob = await canvasToBlob(canvas, mimeType, quality);

    results[variantType] = {
      id: `${baseId}_${variantType}`,
      blob,
      width: targetWidth,
      height: targetHeight,
      size: blob.size,
      mimeType,
      capturedAt: timestamp,
      source: captureSource,
      originalFilename,
      originalWidth: srcWidth,
      originalHeight: srcHeight,
    };
  }

  return results as PhotoVariants;
}

/**
 * Compresses an existing photo blob to a specific variant size.
 * Useful for generating variants from an already captured photo.
 *
 * @param blob - Source photo blob
 * @param variant - Target variant type
 * @param existingId - Optional existing photo ID to derive variant ID from
 * @returns Promise resolving to CapturedPhoto
 */
export async function compressToVariant(
  blob: Blob,
  variant: PhotoVariant,
  existingId?: string
): Promise<CapturedPhoto> {
  const options = VARIANT_PRESETS[variant];
  const photo = await importFromBlob(blob, blob.type, options);

  // Override ID if provided
  if (existingId) {
    photo.id = `${existingId}_${variant}`;
  }

  return photo;
}

/**
 * Converts a CapturedPhoto blob to ArrayBuffer for encryption.
 * The encryption module expects ArrayBuffer input.
 *
 * @param photo - CapturedPhoto to convert
 * @returns Promise resolving to ArrayBuffer of the photo data
 */
export async function photoToArrayBuffer(
  photo: CapturedPhoto
): Promise<ArrayBuffer> {
  return photo.blob.arrayBuffer();
}

/**
 * Converts a CapturedPhoto blob to Uint8Array for encryption.
 *
 * @param photo - CapturedPhoto to convert
 * @returns Promise resolving to Uint8Array of the photo data
 */
export async function photoToUint8Array(
  photo: CapturedPhoto
): Promise<Uint8Array> {
  const buffer = await photo.blob.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Creates a Blob from decrypted photo data.
 *
 * @param data - Decrypted photo data
 * @param mimeType - MIME type for the blob
 * @returns Blob containing the photo data
 */
export function createBlobFromData(
  data: ArrayBuffer | Uint8Array,
  mimeType: string
): Blob {
  return new Blob([data], { type: mimeType });
}

/**
 * Creates an object URL for displaying a photo.
 * Remember to call URL.revokeObjectURL when done.
 *
 * @param photo - CapturedPhoto or Blob to create URL for
 * @returns Object URL string
 */
export function createPhotoUrl(photo: CapturedPhoto | Blob): string {
  const blob = photo instanceof Blob ? photo : photo.blob;
  return URL.createObjectURL(blob);
}

/**
 * Revokes an object URL created by createPhotoUrl.
 * Call this when the URL is no longer needed to free memory.
 *
 * @param url - Object URL to revoke
 */
export function revokePhotoUrl(url: string): void {
  URL.revokeObjectURL(url);
}

/**
 * Validates that a blob is a valid image by attempting to load it.
 *
 * @param blob - Blob to validate
 * @returns Promise resolving to true if valid image
 */
export async function isValidImage(blob: Blob): Promise<boolean> {
  if (!blob.type.startsWith('image/')) {
    return false;
  }

  const url = URL.createObjectURL(blob);
  try {
    await loadImage(url);
    return true;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Gets the dimensions of an image blob without full decode.
 *
 * @param blob - Image blob
 * @returns Promise resolving to width and height
 */
export async function getImageDimensions(
  blob: Blob
): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

/**
 * Calculates target dimensions maintaining aspect ratio
 */
function calculateTargetDimensions(
  srcWidth: number,
  srcHeight: number,
  options: CompressionOptions
): { targetWidth: number; targetHeight: number } {
  const maxWidth = options.maxWidth ?? getMaxWidth();
  const maxHeight = options.maxHeight ?? getMaxHeight();

  let targetWidth = srcWidth;
  let targetHeight = srcHeight;

  // Scale down if exceeds max dimensions (maintain aspect ratio)
  if (srcWidth > maxWidth || srcHeight > maxHeight) {
    const scale = Math.min(maxWidth / srcWidth, maxHeight / srcHeight);
    targetWidth = Math.round(srcWidth * scale);
    targetHeight = Math.round(srcHeight * scale);
  }

  return { targetWidth, targetHeight };
}

/**
 * Converts canvas to blob with specified format and quality
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(
            new PhotoCaptureError(
              'Failed to create blob from canvas',
              'BLOB_CREATION_FAILED'
            )
          );
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

/**
 * Reads a file as data URL
 */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(
          new PhotoCaptureError(
            'FileReader did not return string',
            'FILE_READ_ERROR'
          )
        );
      }
    };

    reader.onerror = () => {
      reject(
        new PhotoCaptureError(
          `Failed to read file: ${reader.error?.message ?? 'Unknown error'}`,
          'FILE_READ_ERROR',
          reader.error ?? undefined
        )
      );
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Loads an image from URL/data URL
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      resolve(img);
    };

    img.onerror = () => {
      reject(
        new PhotoCaptureError(
          'Failed to load image',
          'IMAGE_LOAD_ERROR'
        )
      );
    };

    img.src = src;
  });
}
