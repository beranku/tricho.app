// RxDB Schema Registry and Collection Setup for TrichoApp
// Provides centralized schema management and collection initialization utilities
// Reference: spec.md - RxDB Database Initialization Pattern

import type {
  RxDatabase,
  RxCollectionCreator,
} from 'rxdb';

// === Re-export all schema types and utilities ===

export {
  // Customer schema
  CUSTOMER_DOC_TYPE,
  customerSchema,
  customerCollectionConfig,
  generateCustomerId,
  createCustomerDocument,
  validateCustomerDocument,
  sanitizeCustomerInput,
  type CustomerDocType,
  type CustomerDocument,
  type CustomerCollection,
  type CustomerEncryptedPayload,
  type CreateCustomerInput,
  type UpdateCustomerInput,
} from './customer';

export {
  // Visit schema
  VISIT_DOC_TYPE,
  visitSchema,
  visitCollectionConfig,
  generateVisitId,
  createVisitDocument,
  validateVisitDocument,
  sanitizeVisitInput,
  type VisitDocType,
  type VisitDocument,
  type VisitCollection,
  type VisitEncryptedPayload,
  type CreateVisitInput,
  type UpdateVisitInput,
} from './visit';

export {
  // PhotoMeta schema
  PHOTO_META_DOC_TYPE,
  photoMetaSchema,
  photoMetaCollectionConfig,
  generatePhotoId,
  createPhotoMetaDocument,
  validatePhotoMetaDocument,
  sanitizePhotoMetaInput,
  isPhotoReady,
  isPhotoPendingUpload,
  getStorageKey,
  type PhotoMetaDocType,
  type PhotoMetaDocument,
  type PhotoMetaCollection,
  type PhotoMetaEncryptedPayload,
  type PhotoVariant,
  type PhotoUploadStatus,
  type BodyRegion,
  type CreatePhotoMetaInput,
  type UpdatePhotoMetaInput,
} from './photo-meta';

// === Import for internal use ===

import {
  customerSchema,
  customerCollectionConfig,
  type CustomerDocType,
  type CustomerCollection,
} from './customer';

import {
  visitSchema,
  visitCollectionConfig,
  type VisitDocType,
  type VisitCollection,
} from './visit';

import {
  photoMetaSchema,
  photoMetaCollectionConfig,
  type PhotoMetaDocType,
  type PhotoMetaCollection,
} from './photo-meta';

/**
 * Collection names used in the database
 * Use these constants to reference collections consistently
 */
export const COLLECTION_NAMES = {
  CUSTOMERS: 'customers',
  VISITS: 'visits',
  PHOTOS: 'photos',
} as const;

/**
 * Type for collection name values
 */
export type CollectionName = typeof COLLECTION_NAMES[keyof typeof COLLECTION_NAMES];

/**
 * Database collections type
 * Represents all collections available in the TrichoApp database
 */
export interface TrichoAppCollections {
  customers: CustomerCollection;
  visits: VisitCollection;
  photos: PhotoMetaCollection;
}

/**
 * Full database type with all collections
 * Use this type when working with the fully initialized database
 */
export type TrichoAppDatabase = RxDatabase<TrichoAppCollections>;

/**
 * Schema registry containing all collection configurations
 * Maps collection names to their RxDB configuration
 */
export const schemaRegistry: Record<CollectionName, RxCollectionCreator<unknown>> = {
  [COLLECTION_NAMES.CUSTOMERS]: {
    schema: customerSchema,
    statics: customerCollectionConfig.statics,
    methods: customerCollectionConfig.methods,
    migrationStrategies: customerCollectionConfig.migrationStrategies,
  } as RxCollectionCreator<CustomerDocType>,
  [COLLECTION_NAMES.VISITS]: {
    schema: visitSchema,
    statics: visitCollectionConfig.statics,
    methods: visitCollectionConfig.methods,
    migrationStrategies: visitCollectionConfig.migrationStrategies,
  } as RxCollectionCreator<VisitDocType>,
  [COLLECTION_NAMES.PHOTOS]: {
    schema: photoMetaSchema,
    statics: photoMetaCollectionConfig.statics,
    methods: photoMetaCollectionConfig.methods,
    migrationStrategies: photoMetaCollectionConfig.migrationStrategies,
  } as RxCollectionCreator<PhotoMetaDocType>,
};

/**
 * All schema definitions for reference
 * Useful for schema validation or inspection
 */
export const schemas = {
  customers: customerSchema,
  visits: visitSchema,
  photos: photoMetaSchema,
} as const;

/**
 * Error thrown when collection setup fails
 */
export class CollectionSetupError extends Error {
  constructor(
    message: string,
    public readonly collectionName?: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'CollectionSetupError';
  }
}

/**
 * Options for collection setup
 */
export interface SetupCollectionsOptions {
  /**
   * Specific collections to set up.
   * If not provided, all collections will be set up.
   */
  collections?: CollectionName[];
  /**
   * If true, skip already existing collections instead of throwing.
   * Default: true
   */
  skipExisting?: boolean;
}

/**
 * Result of collection setup
 */
export interface SetupCollectionsResult {
  /** Collections that were successfully created */
  created: CollectionName[];
  /** Collections that were skipped (already existed) */
  skipped: CollectionName[];
  /** Total number of collections now available */
  total: number;
}

/**
 * Sets up all collections in the database.
 * Should be called after database initialization.
 *
 * IMPORTANT: Collections should only be added once per database.
 * This function handles the case where collections already exist.
 *
 * @param db - The RxDB database instance
 * @param options - Setup options
 * @returns Result containing created and skipped collections
 * @throws CollectionSetupError if setup fails
 *
 * @example
 * ```typescript
 * import { initDatabase } from '../db';
 * import { setupCollections } from '../db/schemas';
 *
 * const { db } = await initDatabase({ dek });
 * const result = await setupCollections(db);
 * console.log(`Created ${result.created.length} collections`);
 *
 * // Now you can use typed collections
 * const customers = db.customers;
 * const allCustomers = await customers.find().exec();
 * ```
 */
export async function setupCollections(
  db: RxDatabase,
  options: SetupCollectionsOptions = {}
): Promise<SetupCollectionsResult> {
  const { collections: requestedCollections, skipExisting = true } = options;

  // Determine which collections to set up
  const collectionsToSetup = requestedCollections ?? [
    COLLECTION_NAMES.CUSTOMERS,
    COLLECTION_NAMES.VISITS,
    COLLECTION_NAMES.PHOTOS,
  ];

  const created: CollectionName[] = [];
  const skipped: CollectionName[] = [];

  // Build collections config object for batch creation
  const collectionsConfig: Record<string, RxCollectionCreator<unknown>> = {};

  for (const name of collectionsToSetup) {
    const config = schemaRegistry[name];
    if (!config) {
      throw new CollectionSetupError(
        `Unknown collection: ${name}`,
        name
      );
    }

    // Check if collection already exists
    if (db.collections[name]) {
      if (skipExisting) {
        skipped.push(name);
        continue;
      } else {
        throw new CollectionSetupError(
          `Collection '${name}' already exists`,
          name
        );
      }
    }

    collectionsConfig[name] = config;
  }

  // Create all collections at once for efficiency
  if (Object.keys(collectionsConfig).length > 0) {
    try {
      await db.addCollections(collectionsConfig);
      created.push(...(Object.keys(collectionsConfig) as CollectionName[]));
    } catch (error) {
      throw new CollectionSetupError(
        `Failed to create collections: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        error
      );
    }
  }

  return {
    created,
    skipped,
    total: Object.keys(db.collections).length,
  };
}

/**
 * Checks if all required collections are set up in the database.
 *
 * @param db - The RxDB database instance
 * @returns true if all collections exist
 */
export function areCollectionsReady(db: RxDatabase): boolean {
  return (
    COLLECTION_NAMES.CUSTOMERS in db.collections &&
    COLLECTION_NAMES.VISITS in db.collections &&
    COLLECTION_NAMES.PHOTOS in db.collections
  );
}

/**
 * Gets the list of collections that are missing from the database.
 *
 * @param db - The RxDB database instance
 * @returns Array of missing collection names
 */
export function getMissingCollections(db: RxDatabase): CollectionName[] {
  const allCollections: CollectionName[] = [
    COLLECTION_NAMES.CUSTOMERS,
    COLLECTION_NAMES.VISITS,
    COLLECTION_NAMES.PHOTOS,
  ];

  return allCollections.filter((name) => !(name in db.collections));
}

/**
 * Gets typed access to the customers collection.
 * Throws if collection is not set up.
 *
 * @param db - The RxDB database instance
 * @returns The customers collection
 * @throws CollectionSetupError if collection doesn't exist
 */
export function getCustomersCollection(db: RxDatabase): CustomerCollection {
  const collection = db.collections[COLLECTION_NAMES.CUSTOMERS];
  if (!collection) {
    throw new CollectionSetupError(
      'Customers collection not found. Call setupCollections() first.',
      COLLECTION_NAMES.CUSTOMERS
    );
  }
  return collection as CustomerCollection;
}

/**
 * Gets typed access to the visits collection.
 * Throws if collection is not set up.
 *
 * @param db - The RxDB database instance
 * @returns The visits collection
 * @throws CollectionSetupError if collection doesn't exist
 */
export function getVisitsCollection(db: RxDatabase): VisitCollection {
  const collection = db.collections[COLLECTION_NAMES.VISITS];
  if (!collection) {
    throw new CollectionSetupError(
      'Visits collection not found. Call setupCollections() first.',
      COLLECTION_NAMES.VISITS
    );
  }
  return collection as VisitCollection;
}

/**
 * Gets typed access to the photos collection.
 * Throws if collection is not set up.
 *
 * @param db - The RxDB database instance
 * @returns The photos collection
 * @throws CollectionSetupError if collection doesn't exist
 */
export function getPhotosCollection(db: RxDatabase): PhotoMetaCollection {
  const collection = db.collections[COLLECTION_NAMES.PHOTOS];
  if (!collection) {
    throw new CollectionSetupError(
      'Photos collection not found. Call setupCollections() first.',
      COLLECTION_NAMES.PHOTOS
    );
  }
  return collection as PhotoMetaCollection;
}

/**
 * Gets all collection document counts for diagnostics.
 *
 * @param db - The RxDB database instance
 * @returns Object with document counts per collection
 */
export async function getCollectionCounts(
  db: RxDatabase
): Promise<Record<CollectionName, number>> {
  const counts: Partial<Record<CollectionName, number>> = {};

  for (const name of Object.values(COLLECTION_NAMES)) {
    const collection = db.collections[name];
    if (collection) {
      const docs = await collection.find().exec();
      counts[name] = docs.length;
    } else {
      counts[name] = 0;
    }
  }

  return counts as Record<CollectionName, number>;
}

/**
 * Schema version information for each collection.
 * Useful for debugging and migration tracking.
 */
export const schemaVersions = {
  [COLLECTION_NAMES.CUSTOMERS]: customerSchema.version,
  [COLLECTION_NAMES.VISITS]: visitSchema.version,
  [COLLECTION_NAMES.PHOTOS]: photoMetaSchema.version,
} as const;

/**
 * Gets the current schema version for a collection.
 *
 * @param collectionName - Name of the collection
 * @returns Schema version number
 */
export function getSchemaVersion(collectionName: CollectionName): number {
  return schemaVersions[collectionName];
}
