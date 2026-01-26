// Thumbnail generation module for TrichoApp
// Provides specialized thumbnail creation with various crop modes and optimization
// Reference: spec.md - Photo Pipeline (capture -> compress -> encrypt -> sync)

import {
  type CapturedPhoto,
  type PhotoVariant,
  type CompressionOptions,
  generatePhotoId,
  createBlobFromData,
  PhotoCaptureError,
} from './capture';

/**
 * Thumbnail size presets for different use cases
 * All dimensions are maximum bounds - aspect ratio is preserved
 */
export interface ThumbnailPreset {
  /** Maximum width in pixels */
  width: number;
  /** Maximum height in pixels */
  height: number;
  /** JPEG quality (0-1) */
  quality: number;
  /** Human-readable name for the preset */
  name: string;
}

/**
 * Predefined thumbnail presets for common use cases
 */
export const THUMBNAIL_PRESETS: Record<string, ThumbnailPreset> = {
  /** Small square thumbnail for list views (200x200) */
  list: {
    width: 200,
    height: 200,
    quality: 0.7,
    name: 'List Thumbnail',
  },
  /** Small avatar-style thumbnail (80x80) */
  avatar: {
    width: 80,
    height: 80,
    quality: 0.65,
    name: 'Avatar',
  },
  /** Medium preview for detail panels (400x400) */
  preview: {
    width: 400,
    height: 400,
    quality: 0.8,
    name: 'Preview',
  },
  /** Large preview for galleries (600x600) */
  gallery: {
    width: 600,
    height: 600,
    quality: 0.85,
    name: 'Gallery',
  },
  /** Extra small for notifications/badges (48x48) */
  badge: {
    width: 48,
    height: 48,
    quality: 0.6,
    name: 'Badge',
  },
} as const;

/**
 * Crop mode for thumbnail generation
 * Determines how the source image is fit into the target dimensions
 */
export type ThumbnailCropMode =
  | 'fit'      // Fit entire image within bounds (may have letterboxing)
  | 'cover'    // Cover entire bounds (may crop edges)
  | 'fill'     // Stretch to fill (may distort)
  | 'contain'; // Same as fit, alias for CSS terminology

/**
 * Anchor position for cover crop mode
 * Determines which part of the image is prioritized when cropping
 */
export type CropAnchor =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

/**
 * Configuration for thumbnail generation
 */
export interface ThumbnailConfig {
  /** Target width in pixels */
  width: number;
  /** Target height in pixels */
  height: number;
  /** JPEG quality 0-1 (default: 0.7) */
  quality?: number;
  /** Crop mode (default: 'cover') */
  cropMode?: ThumbnailCropMode;
  /** Crop anchor for cover mode (default: 'center') */
  cropAnchor?: CropAnchor;
  /** Output MIME type (default: 'image/jpeg') */
  mimeType?: 'image/jpeg' | 'image/webp' | 'image/png';
  /** Background color for letterboxing in fit mode (default: transparent/white) */
  backgroundColor?: string;
}

/**
 * Result of a thumbnail generation operation
 */
export interface GeneratedThumbnail {
  /** Unique identifier for the thumbnail */
  id: string;
  /** The thumbnail blob */
  blob: Blob;
  /** Actual width of the thumbnail */
  width: number;
  /** Actual height of the thumbnail */
  height: number;
  /** Size in bytes */
  size: number;
  /** MIME type */
  mimeType: string;
  /** Timestamp when generated */
  generatedAt: number;
  /** Preset used (if any) */
  preset?: string;
  /** Crop mode used */
  cropMode: ThumbnailCropMode;
  /** Source photo ID if derived from CapturedPhoto */
  sourcePhotoId?: string;
}

/**
 * Options for batch thumbnail generation
 */
export interface BatchThumbnailOptions {
  /** Presets to generate for each source */
  presets: (keyof typeof THUMBNAIL_PRESETS | ThumbnailPreset)[];
  /** Crop mode for all thumbnails (default: 'cover') */
  cropMode?: ThumbnailCropMode;
  /** Crop anchor (default: 'center') */
  cropAnchor?: CropAnchor;
  /** Process in parallel (default: true, but limited for memory) */
  parallel?: boolean;
  /** Maximum concurrent generations (default: 3) */
  maxConcurrent?: number;
  /** Callback for progress reporting */
  onProgress?: (completed: number, total: number) => void;
}

/**
 * Result of batch thumbnail generation
 */
export interface BatchThumbnailResult {
  /** Source identifier */
  sourceId: string;
  /** Generated thumbnails by preset name */
  thumbnails: Map<string, GeneratedThumbnail>;
  /** Errors by preset name (if any failed) */
  errors: Map<string, Error>;
}

/**
 * Errors specific to thumbnail operations
 */
export class ThumbnailError extends Error {
  constructor(
    message: string,
    public readonly code: ThumbnailErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ThumbnailError';
  }
}

export type ThumbnailErrorCode =
  | 'INVALID_DIMENSIONS'
  | 'INVALID_SOURCE'
  | 'CANVAS_ERROR'
  | 'BLOB_CREATION_FAILED'
  | 'IMAGE_LOAD_ERROR'
  | 'MEMORY_ERROR'
  | 'INVALID_PRESET'
  | 'BATCH_PARTIAL_FAILURE';

/**
 * Generates a thumbnail from a Blob source
 * This is the primary thumbnail generation function
 *
 * @param source - Source image blob
 * @param config - Thumbnail configuration
 * @returns Promise resolving to GeneratedThumbnail
 * @throws ThumbnailError if generation fails
 *
 * @example
 * ```typescript
 * const thumbnail = await generateThumbnail(imageBlob, {
 *   width: 200,
 *   height: 200,
 *   cropMode: 'cover',
 * });
 * ```
 */
export async function generateThumbnail(
  source: Blob,
  config: ThumbnailConfig
): Promise<GeneratedThumbnail> {
  // Validate dimensions
  if (config.width <= 0 || config.height <= 0) {
    throw new ThumbnailError(
      `Invalid dimensions: ${config.width}x${config.height}`,
      'INVALID_DIMENSIONS'
    );
  }

  // Validate source
  if (!source || source.size === 0) {
    throw new ThumbnailError(
      'Invalid source: blob is empty or undefined',
      'INVALID_SOURCE'
    );
  }

  // Create object URL and load image
  const objectUrl = URL.createObjectURL(source);

  try {
    const img = await loadImage(objectUrl);
    return await generateThumbnailFromImage(img, config);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Generates a thumbnail from a CapturedPhoto
 * Convenience wrapper that extracts the blob from CapturedPhoto
 *
 * @param photo - CapturedPhoto from capture module
 * @param config - Thumbnail configuration
 * @returns Promise resolving to GeneratedThumbnail with source reference
 */
export async function generateThumbnailFromPhoto(
  photo: CapturedPhoto,
  config: ThumbnailConfig
): Promise<GeneratedThumbnail> {
  const thumbnail = await generateThumbnail(photo.blob, config);
  return {
    ...thumbnail,
    sourcePhotoId: photo.id,
  };
}

/**
 * Generates a thumbnail using a preset configuration
 *
 * @param source - Source image blob
 * @param presetName - Name of the preset from THUMBNAIL_PRESETS
 * @param cropMode - Optional crop mode override
 * @returns Promise resolving to GeneratedThumbnail with preset name
 * @throws ThumbnailError if preset is not found
 *
 * @example
 * ```typescript
 * const listThumb = await generateThumbnailFromPreset(imageBlob, 'list');
 * const avatarThumb = await generateThumbnailFromPreset(imageBlob, 'avatar');
 * ```
 */
export async function generateThumbnailFromPreset(
  source: Blob,
  presetName: keyof typeof THUMBNAIL_PRESETS,
  cropMode?: ThumbnailCropMode
): Promise<GeneratedThumbnail> {
  const preset = THUMBNAIL_PRESETS[presetName];
  if (!preset) {
    throw new ThumbnailError(
      `Unknown preset: ${presetName}. Available: ${Object.keys(THUMBNAIL_PRESETS).join(', ')}`,
      'INVALID_PRESET'
    );
  }

  const thumbnail = await generateThumbnail(source, {
    width: preset.width,
    height: preset.height,
    quality: preset.quality,
    cropMode: cropMode ?? 'cover',
  });

  return {
    ...thumbnail,
    preset: presetName,
  };
}

/**
 * Generates multiple thumbnails from a single source in batch
 * Memory-efficient by loading source image once
 *
 * @param source - Source image blob
 * @param options - Batch generation options
 * @returns Promise resolving to BatchThumbnailResult
 *
 * @example
 * ```typescript
 * const result = await generateThumbnailBatch(imageBlob, {
 *   presets: ['list', 'preview', 'avatar'],
 *   onProgress: (done, total) => console.log(`${done}/${total}`),
 * });
 * ```
 */
export async function generateThumbnailBatch(
  source: Blob,
  options: BatchThumbnailOptions
): Promise<BatchThumbnailResult> {
  const sourceId = generatePhotoId();
  const thumbnails = new Map<string, GeneratedThumbnail>();
  const errors = new Map<string, Error>();

  if (!source || source.size === 0) {
    errors.set('_source', new ThumbnailError(
      'Invalid source: blob is empty or undefined',
      'INVALID_SOURCE'
    ));
    return { sourceId, thumbnails, errors };
  }

  // Load image once
  const objectUrl = URL.createObjectURL(source);
  let img: HTMLImageElement;

  try {
    img = await loadImage(objectUrl);
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    errors.set('_source', error instanceof Error ? error : new ThumbnailError(
      'Failed to load source image',
      'IMAGE_LOAD_ERROR'
    ));
    return { sourceId, thumbnails, errors };
  }

  try {
    const total = options.presets.length;
    let completed = 0;

    const cropMode = options.cropMode ?? 'cover';
    const cropAnchor = options.cropAnchor ?? 'center';

    // Process presets
    for (const presetInput of options.presets) {
      let presetName: string;
      let preset: ThumbnailPreset;

      if (typeof presetInput === 'string') {
        presetName = presetInput;
        const foundPreset = THUMBNAIL_PRESETS[presetInput as keyof typeof THUMBNAIL_PRESETS];
        if (!foundPreset) {
          errors.set(presetName, new ThumbnailError(
            `Unknown preset: ${presetName}`,
            'INVALID_PRESET'
          ));
          completed++;
          options.onProgress?.(completed, total);
          continue;
        }
        preset = foundPreset;
      } else {
        presetName = presetInput.name || 'custom';
        preset = presetInput;
      }

      try {
        const thumbnail = await generateThumbnailFromImage(img, {
          width: preset.width,
          height: preset.height,
          quality: preset.quality,
          cropMode,
          cropAnchor,
        });

        thumbnails.set(presetName, {
          ...thumbnail,
          preset: presetName,
        });
      } catch (error) {
        errors.set(presetName, error instanceof Error ? error : new ThumbnailError(
          `Failed to generate ${presetName} thumbnail`,
          'CANVAS_ERROR'
        ));
      }

      completed++;
      options.onProgress?.(completed, total);
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  return { sourceId, thumbnails, errors };
}

/**
 * Generates thumbnails for multiple sources concurrently
 * Useful for processing multiple photos at once
 *
 * @param sources - Array of source blobs with identifiers
 * @param config - Thumbnail configuration to apply to all
 * @param maxConcurrent - Maximum concurrent operations (default: 3)
 * @returns Promise resolving to array of results
 */
export async function generateThumbnailsParallel(
  sources: Array<{ id: string; blob: Blob }>,
  config: ThumbnailConfig,
  maxConcurrent: number = 3
): Promise<Array<{ id: string; thumbnail?: GeneratedThumbnail; error?: Error }>> {
  const results: Array<{ id: string; thumbnail?: GeneratedThumbnail; error?: Error }> = [];

  // Process in chunks to limit memory usage
  for (let i = 0; i < sources.length; i += maxConcurrent) {
    const chunk = sources.slice(i, i + maxConcurrent);
    const chunkResults = await Promise.all(
      chunk.map(async ({ id, blob }) => {
        try {
          const thumbnail = await generateThumbnail(blob, config);
          return { id, thumbnail };
        } catch (error) {
          return { id, error: error instanceof Error ? error : new Error(String(error)) };
        }
      })
    );
    results.push(...chunkResults);
  }

  return results;
}

/**
 * Estimates the memory needed to generate a thumbnail
 * Useful for checking available memory before batch operations
 *
 * @param sourceWidth - Source image width
 * @param sourceHeight - Source image height
 * @param targetWidth - Target thumbnail width
 * @param targetHeight - Target thumbnail height
 * @returns Estimated bytes needed
 */
export function estimateThumbnailMemory(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): number {
  // Source image in memory (RGBA = 4 bytes per pixel)
  const sourceBytes = sourceWidth * sourceHeight * 4;
  // Target canvas (RGBA = 4 bytes per pixel)
  const targetBytes = targetWidth * targetHeight * 4;
  // Add overhead for intermediate buffers (~20%)
  return Math.round((sourceBytes + targetBytes) * 1.2);
}

/**
 * Validates thumbnail dimensions are within safe limits
 *
 * @param width - Target width
 * @param height - Target height
 * @returns true if dimensions are valid
 */
export function isValidThumbnailSize(width: number, height: number): boolean {
  // Minimum 1x1, maximum 4096x4096 (reasonable for thumbnails)
  return (
    width >= 1 &&
    width <= 4096 &&
    height >= 1 &&
    height <= 4096 &&
    Number.isInteger(width) &&
    Number.isInteger(height)
  );
}

/**
 * Calculates the optimal thumbnail dimensions for a given aspect ratio
 * Ensures the thumbnail fits within bounds while maintaining aspect ratio
 *
 * @param sourceWidth - Source image width
 * @param sourceHeight - Source image height
 * @param maxWidth - Maximum target width
 * @param maxHeight - Maximum target height
 * @param cropMode - Crop mode to use
 * @returns Calculated dimensions
 */
export function calculateThumbnailDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
  cropMode: ThumbnailCropMode = 'fit'
): { width: number; height: number; scale: number } {
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = maxWidth / maxHeight;

  let width: number;
  let height: number;
  let scale: number;

  switch (cropMode) {
    case 'fill':
      // Stretch to exact dimensions
      width = maxWidth;
      height = maxHeight;
      scale = Math.max(maxWidth / sourceWidth, maxHeight / sourceHeight);
      break;

    case 'cover':
      // Scale to cover, will crop edges
      if (sourceAspect > targetAspect) {
        // Source is wider - scale by height
        height = maxHeight;
        width = Math.round(sourceWidth * (maxHeight / sourceHeight));
        scale = maxHeight / sourceHeight;
      } else {
        // Source is taller - scale by width
        width = maxWidth;
        height = Math.round(sourceHeight * (maxWidth / sourceWidth));
        scale = maxWidth / sourceWidth;
      }
      break;

    case 'fit':
    case 'contain':
    default:
      // Scale to fit within bounds
      if (sourceAspect > targetAspect) {
        // Source is wider - fit by width
        width = maxWidth;
        height = Math.round(maxWidth / sourceAspect);
        scale = maxWidth / sourceWidth;
      } else {
        // Source is taller - fit by height
        height = maxHeight;
        width = Math.round(maxHeight * sourceAspect);
        scale = maxHeight / sourceHeight;
      }
      break;
  }

  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    scale,
  };
}

/**
 * Gets the crop region for cover mode based on anchor position
 *
 * @param sourceWidth - Source image width
 * @param sourceHeight - Source image height
 * @param targetWidth - Target crop width
 * @param targetHeight - Target crop height
 * @param anchor - Anchor position
 * @returns Crop region coordinates
 */
export function getCropRegion(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  anchor: CropAnchor
): { sx: number; sy: number; sw: number; sh: number } {
  // Calculate the region to extract from source to achieve cover
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetWidth / targetHeight;

  let sw: number;
  let sh: number;
  let sx: number;
  let sy: number;

  if (sourceAspect > targetAspect) {
    // Source is wider - crop horizontally
    sh = sourceHeight;
    sw = Math.round(sourceHeight * targetAspect);
    sy = 0;

    // Position based on anchor
    switch (anchor) {
      case 'left':
      case 'top-left':
      case 'bottom-left':
        sx = 0;
        break;
      case 'right':
      case 'top-right':
      case 'bottom-right':
        sx = sourceWidth - sw;
        break;
      default: // center
        sx = Math.round((sourceWidth - sw) / 2);
    }
  } else {
    // Source is taller - crop vertically
    sw = sourceWidth;
    sh = Math.round(sourceWidth / targetAspect);
    sx = 0;

    // Position based on anchor
    switch (anchor) {
      case 'top':
      case 'top-left':
      case 'top-right':
        sy = 0;
        break;
      case 'bottom':
      case 'bottom-left':
      case 'bottom-right':
        sy = sourceHeight - sh;
        break;
      default: // center
        sy = Math.round((sourceHeight - sh) / 2);
    }
  }

  return { sx, sy, sw, sh };
}

/**
 * Creates a data URL from a thumbnail for immediate use
 * Note: For large thumbnails, prefer using object URLs
 *
 * @param thumbnail - Generated thumbnail
 * @returns Promise resolving to data URL string
 */
export async function thumbnailToDataUrl(thumbnail: GeneratedThumbnail): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new ThumbnailError('Failed to convert to data URL', 'BLOB_CREATION_FAILED'));
      }
    };
    reader.onerror = () => reject(new ThumbnailError(
      'FileReader error',
      'BLOB_CREATION_FAILED',
      reader.error ?? undefined
    ));
    reader.readAsDataURL(thumbnail.blob);
  });
}

/**
 * Creates an object URL for a thumbnail
 * Remember to revoke with URL.revokeObjectURL when done
 *
 * @param thumbnail - Generated thumbnail
 * @returns Object URL string
 */
export function thumbnailToObjectUrl(thumbnail: GeneratedThumbnail): string {
  return URL.createObjectURL(thumbnail.blob);
}

/**
 * Converts a thumbnail blob to Uint8Array for encryption
 *
 * @param thumbnail - Generated thumbnail
 * @returns Promise resolving to Uint8Array
 */
export async function thumbnailToUint8Array(thumbnail: GeneratedThumbnail): Promise<Uint8Array> {
  const buffer = await thumbnail.blob.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Creates a thumbnail from raw Uint8Array data (e.g., after decryption)
 *
 * @param data - Raw image data
 * @param mimeType - MIME type of the image
 * @param metadata - Optional metadata to preserve
 * @returns GeneratedThumbnail
 */
export function createThumbnailFromData(
  data: Uint8Array | ArrayBuffer,
  mimeType: string,
  metadata?: Partial<GeneratedThumbnail>
): GeneratedThumbnail {
  const blob = createBlobFromData(data, mimeType);
  return {
    id: metadata?.id ?? generatePhotoId(),
    blob,
    width: metadata?.width ?? 0, // Unknown without loading
    height: metadata?.height ?? 0,
    size: blob.size,
    mimeType,
    generatedAt: metadata?.generatedAt ?? Date.now(),
    preset: metadata?.preset,
    cropMode: metadata?.cropMode ?? 'fit',
    sourcePhotoId: metadata?.sourcePhotoId,
  };
}

/**
 * Checks if a blob is a valid image that can be thumbnailed
 *
 * @param blob - Blob to check
 * @returns Promise resolving to validation result
 */
export async function canGenerateThumbnail(blob: Blob): Promise<{
  valid: boolean;
  error?: string;
  dimensions?: { width: number; height: number };
}> {
  if (!blob || blob.size === 0) {
    return { valid: false, error: 'Blob is empty' };
  }

  if (!blob.type.startsWith('image/')) {
    return { valid: false, error: `Invalid MIME type: ${blob.type}` };
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl);
    return {
      valid: true,
      dimensions: {
        width: img.naturalWidth,
        height: img.naturalHeight,
      },
    };
  } catch {
    return { valid: false, error: 'Failed to decode image' };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

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
      reject(new ThumbnailError(
        'Failed to load image',
        'IMAGE_LOAD_ERROR'
      ));
    };

    img.src = src;
  });
}

/**
 * Generates thumbnail from an already-loaded HTMLImageElement
 * Core rendering function used by all public APIs
 */
async function generateThumbnailFromImage(
  img: HTMLImageElement,
  config: ThumbnailConfig
): Promise<GeneratedThumbnail> {
  const sourceWidth = img.naturalWidth;
  const sourceHeight = img.naturalHeight;
  const cropMode = config.cropMode ?? 'cover';
  const cropAnchor = config.cropAnchor ?? 'center';
  const quality = config.quality ?? 0.7;
  const mimeType = config.mimeType ?? 'image/jpeg';

  // Calculate dimensions based on crop mode
  let canvasWidth: number;
  let canvasHeight: number;
  let drawX: number;
  let drawY: number;
  let drawWidth: number;
  let drawHeight: number;

  if (cropMode === 'fill') {
    // Stretch to exact dimensions
    canvasWidth = config.width;
    canvasHeight = config.height;
    drawX = 0;
    drawY = 0;
    drawWidth = config.width;
    drawHeight = config.height;
  } else if (cropMode === 'cover') {
    // Cover mode: scale to fill, then crop
    canvasWidth = config.width;
    canvasHeight = config.height;

    // Get crop region from source
    const crop = getCropRegion(sourceWidth, sourceHeight, config.width, config.height, cropAnchor);

    // Create canvas at target size
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new ThumbnailError('Failed to get canvas 2d context', 'CANVAS_ERROR');
    }

    // Draw cropped region
    ctx.drawImage(
      img,
      crop.sx, crop.sy, crop.sw, crop.sh, // Source rectangle
      0, 0, canvasWidth, canvasHeight      // Destination rectangle
    );

    // Convert to blob
    const blob = await canvasToBlob(canvas, mimeType, quality);

    return {
      id: generatePhotoId(),
      blob,
      width: canvasWidth,
      height: canvasHeight,
      size: blob.size,
      mimeType,
      generatedAt: Date.now(),
      cropMode,
    };
  } else {
    // Fit/contain mode: scale to fit within bounds
    const dims = calculateThumbnailDimensions(
      sourceWidth,
      sourceHeight,
      config.width,
      config.height,
      cropMode
    );

    canvasWidth = dims.width;
    canvasHeight = dims.height;
    drawX = 0;
    drawY = 0;
    drawWidth = dims.width;
    drawHeight = dims.height;
  }

  // Create canvas and render
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new ThumbnailError('Failed to get canvas 2d context', 'CANVAS_ERROR');
  }

  // Set background for fit mode (if specified)
  if (config.backgroundColor && (cropMode === 'fit' || cropMode === 'contain')) {
    ctx.fillStyle = config.backgroundColor;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }

  // Draw the image
  ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

  // Convert to blob
  const blob = await canvasToBlob(canvas, mimeType, quality);

  return {
    id: generatePhotoId(),
    blob,
    width: canvasWidth,
    height: canvasHeight,
    size: blob.size,
    mimeType,
    generatedAt: Date.now(),
    cropMode,
  };
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
          reject(new ThumbnailError(
            'Failed to create blob from canvas',
            'BLOB_CREATION_FAILED'
          ));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}
