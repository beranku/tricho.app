// RxDB Customer schema for TrichoApp
// Implements encrypted payload pattern for customer data
// Reference: spec.md - Document Schema with Encrypted Payload Pattern

import type {
  RxCollection,
  RxDocument,
  RxJsonSchema,
} from 'rxdb';

/**
 * Document type constant for customers
 * Used in unencrypted 'type' field for queries
 */
export const CUSTOMER_DOC_TYPE = 'customer' as const;

/**
 * Encrypted customer payload containing PII
 * This object is stored encrypted in the 'enc' field
 */
export interface CustomerEncryptedPayload {
  /** Customer's full name */
  name: string;
  /** Phone number (optional) */
  phone?: string;
  /** Email address (optional) */
  email?: string;
  /** Free-form notes about the customer */
  notes?: string;
  /** Scalp/hair condition notes (sensitive medical info) */
  scalpNotes?: string;
  /** Customer's preferred products (optional) */
  preferredProducts?: string[];
  /** Customer's allergies or sensitivities (important for treatments) */
  allergies?: string[];
  /** Date of birth for age-related treatments (ISO 8601 string) */
  dateOfBirth?: string;
  /** Customer's preferred stylist name */
  preferredStylist?: string;
}

/**
 * Full customer document type (unencrypted fields + encrypted payload)
 * This represents the document as stored in RxDB
 */
export interface CustomerDocType {
  /** Unique customer ID (UUID v4) */
  id: string;
  /** Document type identifier - always 'customer' */
  type: typeof CUSTOMER_DOC_TYPE;
  /** Last modification timestamp (Unix ms) for sync ordering */
  updatedAt: number;
  /** Creation timestamp (Unix ms) */
  createdAt: number;
  /** Soft delete flag for sync tombstones */
  deleted: boolean;
  /** Encrypted payload containing all PII */
  enc: CustomerEncryptedPayload;
}

/**
 * RxDB document type with methods
 * Use this type when working with customer documents from queries
 */
export type CustomerDocument = RxDocument<CustomerDocType>;

/**
 * RxDB collection type for customers
 * Use this type for the customers collection reference
 */
export type CustomerCollection = RxCollection<CustomerDocType>;

/**
 * Input type for creating a new customer
 * Omits auto-generated fields (createdAt, updatedAt, deleted)
 */
export interface CreateCustomerInput {
  /** Customer's full name (required) */
  name: string;
  /** Phone number */
  phone?: string;
  /** Email address */
  email?: string;
  /** Free-form notes */
  notes?: string;
  /** Scalp/hair condition notes */
  scalpNotes?: string;
  /** Preferred products */
  preferredProducts?: string[];
  /** Known allergies */
  allergies?: string[];
  /** Date of birth (ISO 8601 string) */
  dateOfBirth?: string;
  /** Preferred stylist name */
  preferredStylist?: string;
}

/**
 * Input type for updating an existing customer
 * All fields are optional except id
 */
export interface UpdateCustomerInput {
  /** Customer ID to update */
  id: string;
  /** Fields to update (all optional) */
  enc?: Partial<CustomerEncryptedPayload>;
}

/**
 * Generates a new UUID v4 for customer IDs
 * Uses crypto.randomUUID() when available, falls back to manual generation
 */
export function generateCustomerId(): string {
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
 * Creates a new customer document from input
 * Generates ID and timestamps automatically
 *
 * @param input - Customer data to create
 * @returns Complete customer document ready for insertion
 */
export function createCustomerDocument(input: CreateCustomerInput): CustomerDocType {
  const now = Date.now();

  return {
    id: generateCustomerId(),
    type: CUSTOMER_DOC_TYPE,
    createdAt: now,
    updatedAt: now,
    deleted: false,
    enc: {
      name: input.name,
      phone: input.phone,
      email: input.email,
      notes: input.notes,
      scalpNotes: input.scalpNotes,
      preferredProducts: input.preferredProducts,
      allergies: input.allergies,
      dateOfBirth: input.dateOfBirth,
      preferredStylist: input.preferredStylist,
    },
  };
}

/**
 * RxDB JSON Schema for Customer collection
 *
 * IMPORTANT: Encrypted fields CANNOT be queried in RxDB.
 * Only the unencrypted metadata fields (id, type, updatedAt, deleted)
 * can be used in queries and indexes.
 *
 * The 'enc' object is encrypted at rest and only decrypted when accessed.
 */
export const customerSchema: RxJsonSchema<CustomerDocType> = {
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
      default: CUSTOMER_DOC_TYPE,
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
        name: {
          type: 'string',
          maxLength: 200,
        },
        phone: {
          type: 'string',
          maxLength: 50,
        },
        email: {
          type: 'string',
          maxLength: 200,
        },
        notes: {
          type: 'string',
          maxLength: 10000,
        },
        scalpNotes: {
          type: 'string',
          maxLength: 10000,
        },
        preferredProducts: {
          type: 'array',
          items: {
            type: 'string',
            maxLength: 200,
          },
          maxItems: 100,
        },
        allergies: {
          type: 'array',
          items: {
            type: 'string',
            maxLength: 200,
          },
          maxItems: 50,
        },
        dateOfBirth: {
          type: 'string',
          maxLength: 20, // ISO 8601 date
        },
        preferredStylist: {
          type: 'string',
          maxLength: 200,
        },
      },
      required: ['name'],
    },
  },
  required: ['id', 'type', 'updatedAt', 'createdAt', 'enc'],
  // Mark the enc field as encrypted - RxDB will handle encryption/decryption
  encrypted: ['enc'],
  // Indexes on unencrypted fields only (encrypted fields cannot be indexed)
  indexes: [
    'updatedAt',
    'type',
    'deleted',
    'createdAt',
    // Compound index for efficient "active customers sorted by update time" queries
    ['deleted', 'updatedAt'],
    // Compound index for type-based queries with time ordering
    ['type', 'updatedAt'],
  ],
};

/**
 * Collection configuration for customers
 * Use this when adding the collection to the database
 */
export const customerCollectionConfig = {
  schema: customerSchema,
  statics: {},
  methods: {},
  migrationStrategies: {},
} as const;

/**
 * Validates a customer document
 * Checks required fields and basic constraints
 *
 * @param doc - Document to validate
 * @returns true if valid, throws Error if invalid
 */
export function validateCustomerDocument(doc: unknown): doc is CustomerDocType {
  if (!doc || typeof doc !== 'object') {
    throw new Error('Customer document must be an object');
  }

  const d = doc as Record<string, unknown>;

  // Check required unencrypted fields
  if (typeof d.id !== 'string' || d.id.length === 0) {
    throw new Error('Customer id is required and must be a non-empty string');
  }
  if (d.id.length > 100) {
    throw new Error('Customer id must be at most 100 characters');
  }

  if (d.type !== CUSTOMER_DOC_TYPE) {
    throw new Error(`Customer type must be '${CUSTOMER_DOC_TYPE}'`);
  }

  if (typeof d.updatedAt !== 'number' || d.updatedAt < 0) {
    throw new Error('Customer updatedAt must be a non-negative number');
  }

  if (typeof d.createdAt !== 'number' || d.createdAt < 0) {
    throw new Error('Customer createdAt must be a non-negative number');
  }

  if (typeof d.deleted !== 'boolean') {
    throw new Error('Customer deleted must be a boolean');
  }

  // Check encrypted payload
  if (!d.enc || typeof d.enc !== 'object') {
    throw new Error('Customer enc payload is required and must be an object');
  }

  const enc = d.enc as Record<string, unknown>;

  if (typeof enc.name !== 'string' || enc.name.length === 0) {
    throw new Error('Customer name is required and must be a non-empty string');
  }

  if (enc.name.length > 200) {
    throw new Error('Customer name must be at most 200 characters');
  }

  // Optional field type checks
  if (enc.phone !== undefined && typeof enc.phone !== 'string') {
    throw new Error('Customer phone must be a string if provided');
  }

  if (enc.email !== undefined && typeof enc.email !== 'string') {
    throw new Error('Customer email must be a string if provided');
  }

  if (enc.notes !== undefined && typeof enc.notes !== 'string') {
    throw new Error('Customer notes must be a string if provided');
  }

  if (enc.preferredProducts !== undefined && !Array.isArray(enc.preferredProducts)) {
    throw new Error('Customer preferredProducts must be an array if provided');
  }

  if (enc.allergies !== undefined && !Array.isArray(enc.allergies)) {
    throw new Error('Customer allergies must be an array if provided');
  }

  return true;
}

/**
 * Sanitizes customer input by trimming strings and removing empty values
 *
 * @param input - Raw input from user
 * @returns Sanitized input ready for document creation
 */
export function sanitizeCustomerInput(input: CreateCustomerInput): CreateCustomerInput {
  return {
    name: input.name.trim(),
    phone: input.phone?.trim() || undefined,
    email: input.email?.trim().toLowerCase() || undefined,
    notes: input.notes?.trim() || undefined,
    scalpNotes: input.scalpNotes?.trim() || undefined,
    preferredProducts: input.preferredProducts
      ?.map((p) => p.trim())
      .filter((p) => p.length > 0),
    allergies: input.allergies
      ?.map((a) => a.trim())
      .filter((a) => a.length > 0),
    dateOfBirth: input.dateOfBirth?.trim() || undefined,
    preferredStylist: input.preferredStylist?.trim() || undefined,
  };
}
