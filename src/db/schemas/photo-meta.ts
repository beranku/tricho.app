// RxDB PhotoMeta schema for TrichoApp
// Implements encrypted payload pattern for photo metadata
// Photos are stored as encrypted blobs in object storage; this schema tracks metadata and storage pointers
// Reference: spec.md - Document Schema with Encrypted Payload Pattern

import type {
  RxCollection,
  RxDocument,
  RxJsonSchema,
} from 'rxdb';

/**
 * Document type constant for photo metadata
 * Used in unencrypted 'type' field for queries
 */
export const PHOTO_META_DOC_TYPE = 'photo' as const;

/**
 * Photo variant types
 * Photos may have multiple variants stored in object storage
 */
export type PhotoVariant = 'original' | 'thumbnail' | 'preview';

/**
 * Upload status for tracking sync state
 * Photos are uploaded separately from JSON document sync
 */
export type PhotoUploadStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

/**
 * Body/scalp region for categorizing photos
 * Used to track which area of the scalp/head is shown
 */
export type BodyRegion =
  | 'crown'      // Top of head
  | 'front'      // Hairline/forehead area
  | 'back'       // Back of head/nape
  | 'left_side'  // Left temple/side
  | 'right_side' // Right temple/side
  | 'part_line'  // Along hair part
  | 'full_head'  // Overall view
  | 'close_up'   // Detailed close-up
  | 'other';     // Other/unspecified

/**
 * Encrypted photo metadata containing sensitive information
 * This object is stored encrypted in the 'enc' field
 */
export interface PhotoMetaEncryptedPayload {
  /** User-provided caption for the photo */
  caption?: string;
  /** Detailed notes about the photo (observations, treatment context) */
  notes?: string;
  /** Body region shown in the photo */
  bodyRegion?: BodyRegion;
  /** User-defined tags for categorization */
  tags?: string[];
  /** Original filename (if imported from device) */
  originalFilename?: string;
  /** Camera/device information (if available) */
  deviceInfo?: string;
  /** GPS coordinates (if available and user consents) */
  location?: {
    latitude: number;
    longitude: number;
  };
  /** Treatment context (what treatment was being done when photo taken) */
  treatmentContext?: string;
  /** Comparison reference - ID of another photo this should be compared with */
  comparisonPhotoId?: string;
}

/**
 * Full photo metadata document type (unencrypted fields + encrypted payload)
 * This represents the document as stored in RxDB
 */
export interface PhotoMetaDocType {
  /** Unique photo ID (UUID v4) */
  id: string;
  /** Document type identifier - always 'photo' */
  type: typeof PHOTO_META_DOC_TYPE;
  /** Customer ID this photo belongs to (unencrypted for queries) */
  customerId: string;
  /** Visit ID this photo is associated with (optional, unencrypted for queries) */
  visitId?: string;
  /** Photo variant type (original, thumbnail, preview) */
  variant: PhotoVariant;
  /** Upload status for tracking sync state */
  uploadStatus: PhotoUploadStatus;
  /** Timestamp when photo was captured (Unix ms) - unencrypted for sorting */
  capturedAt: number;
  /** Last modification timestamp (Unix ms) for sync ordering */
  updatedAt: number;
  /** Creation timestamp (Unix ms) */
  createdAt: number;
  /** Soft delete flag for sync tombstones */
  deleted: boolean;

  // === Storage pointers (unencrypted, needed to retrieve encrypted blob) ===

  /** Object storage key/path for the encrypted blob */
  storageKey: string;
  /** MIME type of the photo (e.g., 'image/jpeg') */
  mimeType: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Base64-encoded IV used for encrypting the blob */
  encryptionIv: string;
  /** Base64-encoded salt used for deriving the photo encryption key */
  encryptionSalt: string;
  /** Hash of the original unencrypted photo for deduplication (SHA-256, base64) */
  contentHash?: string;

  /** Encrypted payload containing sensitive metadata */
  enc: PhotoMetaEncryptedPayload;
}

/**
 * RxDB document type with methods
 * Use this type when working with photo metadata documents from queries
 */
export type PhotoMetaDocument = RxDocument<PhotoMetaDocType>;

/**
 * RxDB collection type for photo metadata
 * Use this type for the photos collection reference
 */
export type PhotoMetaCollection = RxCollection<PhotoMetaDocType>;

/**
 * Input type for creating new photo metadata
 * Omits auto-generated fields (id, createdAt, updatedAt, deleted)
 */
export interface CreatePhotoMetaInput {
  /** Customer ID this photo belongs to (required) */
  customerId: string;
  /** Visit ID this photo is associated with */
  visitId?: string;
  /** Photo variant type */
  variant: PhotoVariant;
  /** Initial upload status (defaults to 'pending') */
  uploadStatus?: PhotoUploadStatus;
  /** Timestamp when photo was captured (defaults to now) */
  capturedAt?: number;

  // Storage info (required)
  /** Object storage key/path */
  storageKey: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Base64-encoded IV */
  encryptionIv: string;
  /** Base64-encoded salt */
  encryptionSalt: string;
  /** Content hash for deduplication */
  contentHash?: string;

  // Encrypted fields
  /** Caption */
  caption?: string;
  /** Notes */
  notes?: string;
  /** Body region */
  bodyRegion?: BodyRegion;
  /** Tags */
  tags?: string[];
  /** Original filename */
  originalFilename?: string;
  /** Device info */
  deviceInfo?: string;
  /** GPS location */
  location?: {
    latitude: number;
    longitude: number;
  };
  /** Treatment context */
  treatmentContext?: string;
  /** Comparison photo ID */
  comparisonPhotoId?: string;
}

/**
 * Input type for updating existing photo metadata
 * All fields are optional except id
 */
export interface UpdatePhotoMetaInput {
  /** Photo ID to update */
  id: string;
  /** Update upload status */
  uploadStatus?: PhotoUploadStatus;
  /** Update visit association */
  visitId?: string;
  /** Fields to update in encrypted payload (all optional) */
  enc?: Partial<PhotoMetaEncryptedPayload>;
}

/**
 * Generates a new UUID v4 for photo IDs
 * Uses crypto.randomUUID() when available, falls back to manual generation
 */
export function generatePhotoId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Creates a new photo metadata document from input
 * Generates ID and timestamps automatically
 *
 * @param input - Photo metadata to create
 * @returns Complete photo metadata document ready for insertion
 */
export function createPhotoMetaDocument(input: CreatePhotoMetaInput): PhotoMetaDocType {
  const now = Date.now();

  return {
    id: generatePhotoId(),
    type: PHOTO_META_DOC_TYPE,
    customerId: input.customerId,
    visitId: input.visitId,
    variant: input.variant,
    uploadStatus: input.uploadStatus ?? 'pending',
    capturedAt: input.capturedAt ?? now,
    createdAt: now,
    updatedAt: now,
    deleted: false,

    // Storage pointers
    storageKey: input.storageKey,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    width: input.width,
    height: input.height,
    encryptionIv: input.encryptionIv,
    encryptionSalt: input.encryptionSalt,
    contentHash: input.contentHash,

    // Encrypted payload
    enc: {
      caption: input.caption,
      notes: input.notes,
      bodyRegion: input.bodyRegion,
      tags: input.tags,
      originalFilename: input.originalFilename,
      deviceInfo: input.deviceInfo,
      location: input.location,
      treatmentContext: input.treatmentContext,
      comparisonPhotoId: input.comparisonPhotoId,
    },
  };
}

/**
 * RxDB JSON Schema for PhotoMeta collection
 *
 * IMPORTANT: Encrypted fields CANNOT be queried in RxDB.
 * Only the unencrypted metadata fields can be used in queries and indexes.
 *
 * The 'enc' object is encrypted at rest and only decrypted when accessed.
 * Storage pointers (storageKey, encryptionIv, etc.) are unencrypted to allow
 * the photo sync module to retrieve and decrypt blobs without full document access.
 */
export const photoMetaSchema: RxJsonSchema<PhotoMetaDocType> = {
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    // === Unencrypted metadata (queryable) ===
    id: {
      type: 'string',
      maxLength: 100,
    },
    type: {
      type: 'string',
      maxLength: 50,
      default: PHOTO_META_DOC_TYPE,
    },
    customerId: {
      type: 'string',
      maxLength: 100,
      // Foreign key to customer document
    },
    visitId: {
      type: 'string',
      maxLength: 100,
      // Optional foreign key to visit document
    },
    variant: {
      type: 'string',
      enum: ['original', 'thumbnail', 'preview'],
      maxLength: 20,
    },
    uploadStatus: {
      type: 'string',
      enum: ['pending', 'uploading', 'uploaded', 'failed'],
      maxLength: 20,
      default: 'pending',
    },
    capturedAt: {
      type: 'number',
      minimum: 0,
      maximum: 9999999999999, // Max timestamp (year 2286)
      multipleOf: 1, // Integer only
    },
    updatedAt: {
      type: 'number',
      minimum: 0,
      maximum: 9999999999999,
      multipleOf: 1,
    },
    createdAt: {
      type: 'number',
      minimum: 0,
      maximum: 9999999999999,
      multipleOf: 1,
    },
    deleted: {
      type: 'boolean',
      default: false,
    },

    // === Storage pointers (unencrypted for blob retrieval) ===
    storageKey: {
      type: 'string',
      maxLength: 500, // S3 key max is 1024, but we'll be more conservative
    },
    mimeType: {
      type: 'string',
      maxLength: 100,
    },
    sizeBytes: {
      type: 'number',
      minimum: 0,
      maximum: 104857600, // Max 100MB
      multipleOf: 1,
    },
    width: {
      type: 'number',
      minimum: 1,
      maximum: 65535, // Max reasonable image dimension
      multipleOf: 1,
    },
    height: {
      type: 'number',
      minimum: 1,
      maximum: 65535,
      multipleOf: 1,
    },
    encryptionIv: {
      type: 'string',
      maxLength: 50, // Base64-encoded 12-byte IV is 16 chars
    },
    encryptionSalt: {
      type: 'string',
      maxLength: 100, // Base64-encoded 32-byte salt is ~44 chars
    },
    contentHash: {
      type: 'string',
      maxLength: 100, // Base64-encoded SHA-256 is ~44 chars
    },

    // === Encrypted payload (not queryable) ===
    enc: {
      type: 'object',
      properties: {
        caption: {
          type: 'string',
          maxLength: 500,
        },
        notes: {
          type: 'string',
          maxLength: 10000,
        },
        bodyRegion: {
          type: 'string',
          enum: [
            'crown',
            'front',
            'back',
            'left_side',
            'right_side',
            'part_line',
            'full_head',
            'close_up',
            'other',
          ],
          maxLength: 20,
        },
        tags: {
          type: 'array',
          items: {
            type: 'string',
            maxLength: 100,
          },
          maxItems: 50,
        },
        originalFilename: {
          type: 'string',
          maxLength: 255,
        },
        deviceInfo: {
          type: 'string',
          maxLength: 200,
        },
        location: {
          type: 'object',
          properties: {
            latitude: {
              type: 'number',
              minimum: -90,
              maximum: 90,
            },
            longitude: {
              type: 'number',
              minimum: -180,
              maximum: 180,
            },
          },
          required: ['latitude', 'longitude'],
        },
        treatmentContext: {
          type: 'string',
          maxLength: 1000,
        },
        comparisonPhotoId: {
          type: 'string',
          maxLength: 100,
        },
      },
    },
  },
  required: [
    'id',
    'type',
    'customerId',
    'variant',
    'uploadStatus',
    'capturedAt',
    'updatedAt',
    'createdAt',
    'storageKey',
    'mimeType',
    'sizeBytes',
    'width',
    'height',
    'encryptionIv',
    'encryptionSalt',
    'enc',
  ],
  // Mark the enc field as encrypted - RxDB will handle encryption/decryption
  encrypted: ['enc'],
  // Indexes on unencrypted fields only (encrypted fields cannot be indexed)
  indexes: [
    'updatedAt',
    'type',
    'deleted',
    'createdAt',
    'customerId',
    'visitId',
    'capturedAt',
    'uploadStatus',
    'variant',
    // Compound index for "photos for a customer sorted by capture time" queries
    ['customerId', 'capturedAt'],
    // Compound index for "photos for a visit" queries
    ['visitId', 'capturedAt'],
    // Compound index for "active photos sorted by capture time" queries
    ['deleted', 'capturedAt'],
    // Compound index for "customer's active photos" queries
    ['customerId', 'deleted', 'capturedAt'],
    // Compound index for "pending uploads" queries (sync module)
    ['uploadStatus', 'createdAt'],
    // Compound index for "photos by variant for a customer" queries
    ['customerId', 'variant', 'capturedAt'],
    // Compound index for type-based queries with time ordering
    ['type', 'updatedAt'],
  ],
};

/**
 * Collection configuration for photo metadata
 * Use this when adding the collection to the database
 */
export const photoMetaCollectionConfig = {
  schema: photoMetaSchema,
  statics: {},
  methods: {},
  migrationStrategies: {},
} as const;

/**
 * Validates a photo metadata document
 * Checks required fields and basic constraints
 *
 * @param doc - Document to validate
 * @returns true if valid, throws Error if invalid
 */
export function validatePhotoMetaDocument(doc: unknown): doc is PhotoMetaDocType {
  if (!doc || typeof doc !== 'object') {
    throw new Error('PhotoMeta document must be an object');
  }

  const d = doc as Record<string, unknown>;

  // Check required unencrypted fields
  if (typeof d.id !== 'string' || d.id.length === 0) {
    throw new Error('PhotoMeta id is required and must be a non-empty string');
  }
  if (d.id.length > 100) {
    throw new Error('PhotoMeta id must be at most 100 characters');
  }

  if (d.type !== PHOTO_META_DOC_TYPE) {
    throw new Error(`PhotoMeta type must be '${PHOTO_META_DOC_TYPE}'`);
  }

  if (typeof d.customerId !== 'string' || d.customerId.length === 0) {
    throw new Error('PhotoMeta customerId is required and must be a non-empty string');
  }
  if (d.customerId.length > 100) {
    throw new Error('PhotoMeta customerId must be at most 100 characters');
  }

  // visitId is optional but must be valid if present
  if (d.visitId !== undefined && d.visitId !== null) {
    if (typeof d.visitId !== 'string') {
      throw new Error('PhotoMeta visitId must be a string if provided');
    }
    if (d.visitId.length > 100) {
      throw new Error('PhotoMeta visitId must be at most 100 characters');
    }
  }

  // Variant validation
  const validVariants: PhotoVariant[] = ['original', 'thumbnail', 'preview'];
  if (!validVariants.includes(d.variant as PhotoVariant)) {
    throw new Error(`PhotoMeta variant must be one of: ${validVariants.join(', ')}`);
  }

  // Upload status validation
  const validStatuses: PhotoUploadStatus[] = ['pending', 'uploading', 'uploaded', 'failed'];
  if (!validStatuses.includes(d.uploadStatus as PhotoUploadStatus)) {
    throw new Error(`PhotoMeta uploadStatus must be one of: ${validStatuses.join(', ')}`);
  }

  // Timestamp validations
  if (typeof d.capturedAt !== 'number' || d.capturedAt < 0) {
    throw new Error('PhotoMeta capturedAt must be a non-negative number');
  }

  if (typeof d.updatedAt !== 'number' || d.updatedAt < 0) {
    throw new Error('PhotoMeta updatedAt must be a non-negative number');
  }

  if (typeof d.createdAt !== 'number' || d.createdAt < 0) {
    throw new Error('PhotoMeta createdAt must be a non-negative number');
  }

  if (typeof d.deleted !== 'boolean') {
    throw new Error('PhotoMeta deleted must be a boolean');
  }

  // Storage pointer validations
  if (typeof d.storageKey !== 'string' || d.storageKey.length === 0) {
    throw new Error('PhotoMeta storageKey is required and must be a non-empty string');
  }
  if (d.storageKey.length > 500) {
    throw new Error('PhotoMeta storageKey must be at most 500 characters');
  }

  if (typeof d.mimeType !== 'string' || d.mimeType.length === 0) {
    throw new Error('PhotoMeta mimeType is required and must be a non-empty string');
  }
  if (!d.mimeType.startsWith('image/')) {
    throw new Error('PhotoMeta mimeType must be an image type (e.g., image/jpeg)');
  }

  if (typeof d.sizeBytes !== 'number' || d.sizeBytes < 0) {
    throw new Error('PhotoMeta sizeBytes must be a non-negative number');
  }
  if (d.sizeBytes > 104857600) {
    throw new Error('PhotoMeta sizeBytes must be at most 100MB');
  }

  if (typeof d.width !== 'number' || d.width < 1 || d.width > 65535) {
    throw new Error('PhotoMeta width must be a number between 1 and 65535');
  }

  if (typeof d.height !== 'number' || d.height < 1 || d.height > 65535) {
    throw new Error('PhotoMeta height must be a number between 1 and 65535');
  }

  if (typeof d.encryptionIv !== 'string' || d.encryptionIv.length === 0) {
    throw new Error('PhotoMeta encryptionIv is required and must be a non-empty string');
  }

  if (typeof d.encryptionSalt !== 'string' || d.encryptionSalt.length === 0) {
    throw new Error('PhotoMeta encryptionSalt is required and must be a non-empty string');
  }

  // Check encrypted payload
  if (!d.enc || typeof d.enc !== 'object') {
    throw new Error('PhotoMeta enc payload is required and must be an object');
  }

  const enc = d.enc as Record<string, unknown>;

  // Optional field validations for encrypted payload
  if (enc.caption !== undefined && typeof enc.caption !== 'string') {
    throw new Error('PhotoMeta caption must be a string if provided');
  }

  if (enc.notes !== undefined && typeof enc.notes !== 'string') {
    throw new Error('PhotoMeta notes must be a string if provided');
  }

  if (enc.bodyRegion !== undefined) {
    const validRegions: BodyRegion[] = [
      'crown', 'front', 'back', 'left_side', 'right_side',
      'part_line', 'full_head', 'close_up', 'other',
    ];
    if (!validRegions.includes(enc.bodyRegion as BodyRegion)) {
      throw new Error(`PhotoMeta bodyRegion must be one of: ${validRegions.join(', ')}`);
    }
  }

  if (enc.tags !== undefined && !Array.isArray(enc.tags)) {
    throw new Error('PhotoMeta tags must be an array if provided');
  }

  if (enc.location !== undefined) {
    if (typeof enc.location !== 'object' || enc.location === null) {
      throw new Error('PhotoMeta location must be an object if provided');
    }
    const loc = enc.location as Record<string, unknown>;
    if (typeof loc.latitude !== 'number' || loc.latitude < -90 || loc.latitude > 90) {
      throw new Error('PhotoMeta location.latitude must be a number between -90 and 90');
    }
    if (typeof loc.longitude !== 'number' || loc.longitude < -180 || loc.longitude > 180) {
      throw new Error('PhotoMeta location.longitude must be a number between -180 and 180');
    }
  }

  return true;
}

/**
 * Sanitizes photo metadata input by trimming strings and removing empty values
 *
 * @param input - Raw input from user
 * @returns Sanitized input ready for document creation
 */
export function sanitizePhotoMetaInput(input: CreatePhotoMetaInput): CreatePhotoMetaInput {
  return {
    customerId: input.customerId.trim(),
    visitId: input.visitId?.trim() || undefined,
    variant: input.variant,
    uploadStatus: input.uploadStatus,
    capturedAt: input.capturedAt,

    // Storage fields (no sanitization needed)
    storageKey: input.storageKey,
    mimeType: input.mimeType.trim().toLowerCase(),
    sizeBytes: input.sizeBytes,
    width: input.width,
    height: input.height,
    encryptionIv: input.encryptionIv,
    encryptionSalt: input.encryptionSalt,
    contentHash: input.contentHash,

    // Encrypted fields
    caption: input.caption?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    bodyRegion: input.bodyRegion,
    tags: input.tags
      ?.map((t) => t.trim())
      .filter((t) => t.length > 0),
    originalFilename: input.originalFilename?.trim() || undefined,
    deviceInfo: input.deviceInfo?.trim() || undefined,
    location: input.location,
    treatmentContext: input.treatmentContext?.trim() || undefined,
    comparisonPhotoId: input.comparisonPhotoId?.trim() || undefined,
  };
}

/**
 * Checks if a photo is ready for viewing (uploaded and not deleted)
 *
 * @param doc - Photo metadata document
 * @returns true if photo is ready to view
 */
export function isPhotoReady(doc: PhotoMetaDocType): boolean {
  return doc.uploadStatus === 'uploaded' && !doc.deleted;
}

/**
 * Checks if a photo needs to be uploaded (pending or failed)
 *
 * @param doc - Photo metadata document
 * @returns true if photo needs upload
 */
export function isPhotoPendingUpload(doc: PhotoMetaDocType): boolean {
  return (doc.uploadStatus === 'pending' || doc.uploadStatus === 'failed') && !doc.deleted;
}

/**
 * Gets the storage key for a specific variant of a photo
 * Convention: {userId}/{photoId}/{variant}.enc
 *
 * @param userId - User ID (tenant)
 * @param photoId - Photo ID
 * @param variant - Photo variant
 * @returns Storage key path
 */
export function getStorageKey(userId: string, photoId: string, variant: PhotoVariant): string {
  return `${userId}/${photoId}/${variant}.enc`;
}
