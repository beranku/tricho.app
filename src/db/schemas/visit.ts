// RxDB Visit schema for TrichoApp
// Implements encrypted payload pattern for visit/appointment data
// Reference: spec.md - Document Schema with Encrypted Payload Pattern

import type {
  RxCollection,
  RxDocument,
  RxJsonSchema,
} from 'rxdb';

/**
 * Document type constant for visits
 * Used in unencrypted 'type' field for queries
 */
export const VISIT_DOC_TYPE = 'visit' as const;

/**
 * Encrypted visit payload containing sensitive appointment data
 * This object is stored encrypted in the 'enc' field
 */
export interface VisitEncryptedPayload {
  /** Services performed during the visit (e.g., "haircut", "color", "treatment") */
  services: string[];
  /** Duration of the visit in minutes */
  duration?: number;
  /** Price charged for the visit (in cents to avoid floating point issues) */
  price?: number;
  /** Currency code (ISO 4217, e.g., "CZK", "EUR", "USD") */
  currency?: string;
  /** Products used during the visit */
  productsUsed?: string[];
  /** Products recommended to the customer */
  productsRecommended?: string[];
  /** General notes about the visit */
  notes?: string;
  /** Scalp/hair condition observations during this visit */
  scalpObservations?: string;
  /** Treatment notes (specific to any treatments performed) */
  treatmentNotes?: string;
  /** Stylist who performed the service */
  stylist?: string;
  /** Customer satisfaction rating (1-5) */
  satisfactionRating?: number;
  /** Follow-up recommendations */
  followUpRecommendations?: string;
  /** Next appointment date suggestion (ISO 8601 string) */
  nextAppointmentSuggestion?: string;
  /** Photos associated with this visit (photo IDs) */
  photoIds?: string[];
}

/**
 * Full visit document type (unencrypted fields + encrypted payload)
 * This represents the document as stored in RxDB
 */
export interface VisitDocType {
  /** Unique visit ID (UUID v4) */
  id: string;
  /** Document type identifier - always 'visit' */
  type: typeof VISIT_DOC_TYPE;
  /** Customer ID this visit belongs to (unencrypted for queries) */
  customerId: string;
  /** Visit date timestamp (Unix ms) - unencrypted for queries/sorting */
  visitDate: number;
  /** Last modification timestamp (Unix ms) for sync ordering */
  updatedAt: number;
  /** Creation timestamp (Unix ms) */
  createdAt: number;
  /** Soft delete flag for sync tombstones */
  deleted: boolean;
  /** Encrypted payload containing all sensitive visit data */
  enc: VisitEncryptedPayload;
}

/**
 * RxDB document type with methods
 * Use this type when working with visit documents from queries
 */
export type VisitDocument = RxDocument<VisitDocType>;

/**
 * RxDB collection type for visits
 * Use this type for the visits collection reference
 */
export type VisitCollection = RxCollection<VisitDocType>;

/**
 * Input type for creating a new visit
 * Omits auto-generated fields (createdAt, updatedAt, deleted)
 */
export interface CreateVisitInput {
  /** Customer ID this visit belongs to (required) */
  customerId: string;
  /** Visit date (Unix ms timestamp) */
  visitDate: number;
  /** Services performed (required) */
  services: string[];
  /** Duration in minutes */
  duration?: number;
  /** Price in cents */
  price?: number;
  /** Currency code */
  currency?: string;
  /** Products used */
  productsUsed?: string[];
  /** Products recommended */
  productsRecommended?: string[];
  /** General notes */
  notes?: string;
  /** Scalp observations */
  scalpObservations?: string;
  /** Treatment notes */
  treatmentNotes?: string;
  /** Stylist name */
  stylist?: string;
  /** Satisfaction rating (1-5) */
  satisfactionRating?: number;
  /** Follow-up recommendations */
  followUpRecommendations?: string;
  /** Next appointment suggestion (ISO 8601 string) */
  nextAppointmentSuggestion?: string;
  /** Photo IDs associated with this visit */
  photoIds?: string[];
}

/**
 * Input type for updating an existing visit
 * All fields are optional except id
 */
export interface UpdateVisitInput {
  /** Visit ID to update */
  id: string;
  /** Visit date (can be rescheduled) */
  visitDate?: number;
  /** Fields to update (all optional) */
  enc?: Partial<VisitEncryptedPayload>;
}

/**
 * Generates a new UUID v4 for visit IDs
 * Uses crypto.randomUUID() when available, falls back to manual generation
 */
export function generateVisitId(): string {
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
 * Creates a new visit document from input
 * Generates ID and timestamps automatically
 *
 * @param input - Visit data to create
 * @returns Complete visit document ready for insertion
 */
export function createVisitDocument(input: CreateVisitInput): VisitDocType {
  const now = Date.now();

  return {
    id: generateVisitId(),
    type: VISIT_DOC_TYPE,
    customerId: input.customerId,
    visitDate: input.visitDate,
    createdAt: now,
    updatedAt: now,
    deleted: false,
    enc: {
      services: input.services,
      duration: input.duration,
      price: input.price,
      currency: input.currency,
      productsUsed: input.productsUsed,
      productsRecommended: input.productsRecommended,
      notes: input.notes,
      scalpObservations: input.scalpObservations,
      treatmentNotes: input.treatmentNotes,
      stylist: input.stylist,
      satisfactionRating: input.satisfactionRating,
      followUpRecommendations: input.followUpRecommendations,
      nextAppointmentSuggestion: input.nextAppointmentSuggestion,
      photoIds: input.photoIds,
    },
  };
}

/**
 * RxDB JSON Schema for Visit collection
 *
 * IMPORTANT: Encrypted fields CANNOT be queried in RxDB.
 * Only the unencrypted metadata fields (id, type, customerId, visitDate, updatedAt, deleted)
 * can be used in queries and indexes.
 *
 * The 'enc' object is encrypted at rest and only decrypted when accessed.
 */
export const visitSchema: RxJsonSchema<VisitDocType> = {
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
      default: VISIT_DOC_TYPE,
    },
    customerId: {
      type: 'string',
      maxLength: 100,
      // Foreign key to customer document (not enforced by RxDB, but by app logic)
    },
    visitDate: {
      type: 'number',
      minimum: 0,
      maximum: 9999999999999, // Max timestamp (year 2286)
      multipleOf: 1, // Integer only
    },
    updatedAt: {
      type: 'number',
      minimum: 0,
      maximum: 9999999999999, // Max timestamp (year 2286)
      multipleOf: 1, // Integer only
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

    // === Encrypted payload (not queryable) ===
    enc: {
      type: 'object',
      properties: {
        services: {
          type: 'array',
          items: {
            type: 'string',
            maxLength: 200,
          },
          maxItems: 50,
        },
        duration: {
          type: 'number',
          minimum: 0,
          maximum: 1440, // Max 24 hours in minutes
        },
        price: {
          type: 'number',
          minimum: 0,
          maximum: 999999999, // Max ~10M in cents
        },
        currency: {
          type: 'string',
          maxLength: 3, // ISO 4217 currency code
        },
        productsUsed: {
          type: 'array',
          items: {
            type: 'string',
            maxLength: 200,
          },
          maxItems: 100,
        },
        productsRecommended: {
          type: 'array',
          items: {
            type: 'string',
            maxLength: 200,
          },
          maxItems: 100,
        },
        notes: {
          type: 'string',
          maxLength: 10000,
        },
        scalpObservations: {
          type: 'string',
          maxLength: 10000,
        },
        treatmentNotes: {
          type: 'string',
          maxLength: 10000,
        },
        stylist: {
          type: 'string',
          maxLength: 200,
        },
        satisfactionRating: {
          type: 'number',
          minimum: 1,
          maximum: 5,
        },
        followUpRecommendations: {
          type: 'string',
          maxLength: 5000,
        },
        nextAppointmentSuggestion: {
          type: 'string',
          maxLength: 20, // ISO 8601 date
        },
        photoIds: {
          type: 'array',
          items: {
            type: 'string',
            maxLength: 100,
          },
          maxItems: 50,
        },
      },
      required: ['services'],
    },
  },
  required: ['id', 'type', 'customerId', 'visitDate', 'updatedAt', 'createdAt', 'enc'],
  // Mark the enc field as encrypted - RxDB will handle encryption/decryption
  encrypted: ['enc'],
  // Indexes on unencrypted fields only (encrypted fields cannot be indexed)
  indexes: [
    'updatedAt',
    'type',
    'deleted',
    'createdAt',
    'customerId',
    'visitDate',
    // Compound index for efficient "visits for a customer sorted by date" queries
    ['customerId', 'visitDate'],
    // Compound index for "active visits sorted by date" queries
    ['deleted', 'visitDate'],
    // Compound index for "customer's active visits" queries
    ['customerId', 'deleted', 'visitDate'],
    // Compound index for type-based queries with time ordering
    ['type', 'updatedAt'],
  ],
};

/**
 * Collection configuration for visits
 * Use this when adding the collection to the database
 */
export const visitCollectionConfig = {
  schema: visitSchema,
  statics: {},
  methods: {},
  migrationStrategies: {},
} as const;

/**
 * Validates a visit document
 * Checks required fields and basic constraints
 *
 * @param doc - Document to validate
 * @returns true if valid, throws Error if invalid
 */
export function validateVisitDocument(doc: unknown): doc is VisitDocType {
  if (!doc || typeof doc !== 'object') {
    throw new Error('Visit document must be an object');
  }

  const d = doc as Record<string, unknown>;

  // Check required unencrypted fields
  if (typeof d.id !== 'string' || d.id.length === 0) {
    throw new Error('Visit id is required and must be a non-empty string');
  }
  if (d.id.length > 100) {
    throw new Error('Visit id must be at most 100 characters');
  }

  if (d.type !== VISIT_DOC_TYPE) {
    throw new Error(`Visit type must be '${VISIT_DOC_TYPE}'`);
  }

  if (typeof d.customerId !== 'string' || d.customerId.length === 0) {
    throw new Error('Visit customerId is required and must be a non-empty string');
  }
  if (d.customerId.length > 100) {
    throw new Error('Visit customerId must be at most 100 characters');
  }

  if (typeof d.visitDate !== 'number' || d.visitDate < 0) {
    throw new Error('Visit visitDate must be a non-negative number');
  }

  if (typeof d.updatedAt !== 'number' || d.updatedAt < 0) {
    throw new Error('Visit updatedAt must be a non-negative number');
  }

  if (typeof d.createdAt !== 'number' || d.createdAt < 0) {
    throw new Error('Visit createdAt must be a non-negative number');
  }

  if (typeof d.deleted !== 'boolean') {
    throw new Error('Visit deleted must be a boolean');
  }

  // Check encrypted payload
  if (!d.enc || typeof d.enc !== 'object') {
    throw new Error('Visit enc payload is required and must be an object');
  }

  const enc = d.enc as Record<string, unknown>;

  if (!Array.isArray(enc.services) || enc.services.length === 0) {
    throw new Error('Visit services is required and must be a non-empty array');
  }

  for (const service of enc.services) {
    if (typeof service !== 'string' || service.length === 0) {
      throw new Error('Each service must be a non-empty string');
    }
    if (service.length > 200) {
      throw new Error('Each service must be at most 200 characters');
    }
  }

  // Optional field type checks
  if (enc.duration !== undefined) {
    if (typeof enc.duration !== 'number' || enc.duration < 0 || enc.duration > 1440) {
      throw new Error('Visit duration must be a number between 0 and 1440 if provided');
    }
  }

  if (enc.price !== undefined) {
    if (typeof enc.price !== 'number' || enc.price < 0) {
      throw new Error('Visit price must be a non-negative number if provided');
    }
  }

  if (enc.currency !== undefined && typeof enc.currency !== 'string') {
    throw new Error('Visit currency must be a string if provided');
  }

  if (enc.notes !== undefined && typeof enc.notes !== 'string') {
    throw new Error('Visit notes must be a string if provided');
  }

  if (enc.productsUsed !== undefined && !Array.isArray(enc.productsUsed)) {
    throw new Error('Visit productsUsed must be an array if provided');
  }

  if (enc.productsRecommended !== undefined && !Array.isArray(enc.productsRecommended)) {
    throw new Error('Visit productsRecommended must be an array if provided');
  }

  if (enc.satisfactionRating !== undefined) {
    if (typeof enc.satisfactionRating !== 'number' || enc.satisfactionRating < 1 || enc.satisfactionRating > 5) {
      throw new Error('Visit satisfactionRating must be a number between 1 and 5 if provided');
    }
  }

  if (enc.photoIds !== undefined && !Array.isArray(enc.photoIds)) {
    throw new Error('Visit photoIds must be an array if provided');
  }

  return true;
}

/**
 * Sanitizes visit input by trimming strings and removing empty values
 *
 * @param input - Raw input from user
 * @returns Sanitized input ready for document creation
 */
export function sanitizeVisitInput(input: CreateVisitInput): CreateVisitInput {
  return {
    customerId: input.customerId.trim(),
    visitDate: input.visitDate,
    services: input.services
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    duration: input.duration,
    price: input.price,
    currency: input.currency?.trim().toUpperCase() || undefined,
    productsUsed: input.productsUsed
      ?.map((p) => p.trim())
      .filter((p) => p.length > 0),
    productsRecommended: input.productsRecommended
      ?.map((p) => p.trim())
      .filter((p) => p.length > 0),
    notes: input.notes?.trim() || undefined,
    scalpObservations: input.scalpObservations?.trim() || undefined,
    treatmentNotes: input.treatmentNotes?.trim() || undefined,
    stylist: input.stylist?.trim() || undefined,
    satisfactionRating: input.satisfactionRating,
    followUpRecommendations: input.followUpRecommendations?.trim() || undefined,
    nextAppointmentSuggestion: input.nextAppointmentSuggestion?.trim() || undefined,
    photoIds: input.photoIds
      ?.map((id) => id.trim())
      .filter((id) => id.length > 0),
  };
}
