// RxDB database initialization for TrichoApp
// Implements encrypted local storage with Dexie adapter and CryptoJS encryption
// Reference: spec.md - RxDB Database Initialization Pattern

import { createRxDatabase, addRxPlugin, type RxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { wrappedKeyEncryptionCryptoJsStorage } from 'rxdb/plugins/encryption-crypto-js';
import { RxDBDevModePlugin } from 'rxdb/plugins/dev-mode';
import { keyToPassword } from '../crypto/utils';
import type { DataEncryptionKey } from '../crypto/keys';

/**
 * Database name used in IndexedDB
 */
export const DB_NAME = 'trichoapp';

/**
 * Database state enum for tracking initialization status
 */
export enum DatabaseState {
  /** Database has not been initialized */
  Uninitialized = 'uninitialized',
  /** Database is currently initializing */
  Initializing = 'initializing',
  /** Database is ready for use */
  Ready = 'ready',
  /** Database initialization failed */
  Error = 'error',
  /** Database has been closed */
  Closed = 'closed',
}

/**
 * Error thrown when database operations fail
 */
export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/**
 * Database initialization options
 */
export interface DatabaseOptions {
  /** Data Encryption Key (32 bytes) - required for encryption */
  dek: DataEncryptionKey;
  /** Enable dev mode plugins (auto-detected from NODE_ENV if not specified) */
  devMode?: boolean;
  /** Database name override (defaults to 'trichoapp') */
  name?: string;
}

/**
 * Result of database initialization
 */
export interface DatabaseInstance {
  /** The RxDB database instance */
  db: RxDatabase;
  /** Current state of the database */
  state: DatabaseState;
}

// Module-level singleton state
let dbPromise: Promise<RxDatabase> | null = null;
let currentState: DatabaseState = DatabaseState.Uninitialized;
let currentDb: RxDatabase | null = null;
let devModeAdded = false;

/**
 * Gets the current database state
 */
export function getDatabaseState(): DatabaseState {
  return currentState;
}

/**
 * Checks if the database is ready for use
 */
export function isDatabaseReady(): boolean {
  return currentState === DatabaseState.Ready && currentDb !== null;
}

/**
 * Checks if IndexedDB is available in the current environment
 */
export function isIndexedDBAvailable(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return 'indexedDB' in window;
}

/**
 * Adds RxDB dev mode plugin if not already added.
 * Should only be called once and only in development.
 */
function addDevModePluginIfNeeded(devMode: boolean): void {
  if (devMode && !devModeAdded) {
    addRxPlugin(RxDBDevModePlugin);
    devModeAdded = true;
  }
}

/**
 * Creates the encrypted storage adapter.
 * Wraps Dexie storage with CryptoJS encryption layer.
 */
function createEncryptedStorage() {
  const baseStorage = getRxStorageDexie();
  return wrappedKeyEncryptionCryptoJsStorage({
    storage: baseStorage,
  });
}

/**
 * Initializes the RxDB database with encryption.
 * Uses singleton pattern - subsequent calls return the same database instance.
 *
 * IMPORTANT: The database password (derived from DEK) cannot be changed
 * after creation. Design your key management flow accordingly.
 *
 * @param options - Database initialization options including DEK
 * @returns Promise resolving to the database instance
 * @throws DatabaseError if initialization fails
 *
 * @example
 * ```typescript
 * import { initDatabase } from './db';
 * import { generateDataEncryptionKey } from '../crypto/keys';
 *
 * const dek = generateDataEncryptionKey();
 * const { db } = await initDatabase({ dek });
 *
 * // Use db for CRUD operations
 * ```
 */
export async function initDatabase(
  options: DatabaseOptions
): Promise<DatabaseInstance> {
  // Return existing database if already initialized
  if (currentDb && currentState === DatabaseState.Ready) {
    return { db: currentDb, state: currentState };
  }

  // Return pending initialization if in progress
  if (dbPromise && currentState === DatabaseState.Initializing) {
    const db = await dbPromise;
    return { db, state: currentState };
  }

  // Validate environment
  if (!isIndexedDBAvailable()) {
    currentState = DatabaseState.Error;
    throw new DatabaseError(
      'IndexedDB is not available in this environment',
      'INDEXEDDB_UNAVAILABLE'
    );
  }

  // Validate DEK
  if (
    !options.dek ||
    !(options.dek instanceof Uint8Array) ||
    options.dek.length !== 32
  ) {
    currentState = DatabaseState.Error;
    throw new DatabaseError(
      'Invalid DEK: must be a 32-byte Uint8Array',
      'INVALID_DEK'
    );
  }

  // Determine dev mode
  const isDevMode =
    options.devMode ??
    (typeof import.meta !== 'undefined' &&
      (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true);

  currentState = DatabaseState.Initializing;

  dbPromise = (async () => {
    try {
      // Add dev mode plugin if needed
      addDevModePluginIfNeeded(isDevMode);

      // Convert DEK to password string for RxDB encryption
      const password = keyToPassword(options.dek);

      // Create encrypted storage
      const encryptedStorage = createEncryptedStorage();

      // Create database
      const db = await createRxDatabase({
        name: options.name ?? DB_NAME,
        storage: encryptedStorage,
        password,
        multiInstance: true, // Allow multiple browser tabs
        eventReduce: true, // Optimize event handling
      });

      currentDb = db;
      currentState = DatabaseState.Ready;

      return db;
    } catch (error) {
      currentState = DatabaseState.Error;
      dbPromise = null;

      // Provide helpful error messages
      if (error instanceof Error) {
        if (error.message.includes('password')) {
          throw new DatabaseError(
            'Database encryption password mismatch. This may indicate a different DEK was used previously.',
            'PASSWORD_MISMATCH',
            error
          );
        }
        throw new DatabaseError(
          `Failed to initialize database: ${error.message}`,
          'INIT_FAILED',
          error
        );
      }

      throw new DatabaseError(
        'Failed to initialize database: Unknown error',
        'INIT_FAILED',
        error
      );
    }
  })();

  const db = await dbPromise;
  return { db, state: currentState };
}

/**
 * Gets the current database instance if initialized.
 * Returns null if database has not been initialized.
 *
 * @returns The database instance or null
 */
export function getDatabase(): RxDatabase | null {
  return currentDb;
}

/**
 * Gets the database instance, throwing if not initialized.
 * Use this when you expect the database to be ready.
 *
 * @returns The database instance
 * @throws DatabaseError if database is not initialized
 */
export function requireDatabase(): RxDatabase {
  if (!currentDb || currentState !== DatabaseState.Ready) {
    throw new DatabaseError(
      'Database not initialized. Call initDatabase() first.',
      'NOT_INITIALIZED'
    );
  }
  return currentDb;
}

/**
 * Closes the database and clears the singleton state.
 * Call this when the user logs out or the app is shutting down.
 *
 * After calling this, initDatabase() must be called again with
 * the DEK to use the database.
 */
export async function closeDatabase(): Promise<void> {
  if (currentDb) {
    try {
      await currentDb.close();
    } catch {
      // Ignore errors during close
    }
  }

  currentDb = null;
  dbPromise = null;
  currentState = DatabaseState.Closed;
}

/**
 * Completely removes the database from IndexedDB.
 * Use with caution - this permanently deletes all local data.
 *
 * @throws DatabaseError if removal fails
 */
export async function destroyDatabase(): Promise<void> {
  // Close if open
  await closeDatabase();

  if (!isIndexedDBAvailable()) {
    return;
  }

  return new Promise((resolve, reject) => {
    // RxDB creates databases with a specific naming pattern
    const dbNames = [
      DB_NAME,
      `${DB_NAME}-rxdb-version`,
      `${DB_NAME}-lock`,
    ];

    let remaining = dbNames.length;
    let hasError = false;

    const checkComplete = () => {
      remaining--;
      if (remaining === 0) {
        if (hasError) {
          reject(
            new DatabaseError(
              'Failed to completely remove database',
              'DESTROY_FAILED'
            )
          );
        } else {
          currentState = DatabaseState.Uninitialized;
          resolve();
        }
      }
    };

    for (const name of dbNames) {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => checkComplete();
      request.onerror = () => {
        hasError = true;
        checkComplete();
      };
      request.onblocked = () => {
        // Database is blocked by another connection
        // This is expected if other tabs have the database open
        checkComplete();
      };
    }
  });
}

/**
 * Resets the database module state.
 * Primarily used for testing - allows re-initialization without page reload.
 *
 * WARNING: Does not close existing connections. Use closeDatabase() for proper cleanup.
 */
export function resetDatabaseState(): void {
  currentDb = null;
  dbPromise = null;
  currentState = DatabaseState.Uninitialized;
}
