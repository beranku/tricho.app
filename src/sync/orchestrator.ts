/**
 * Sync Orchestrator Module
 *
 * Manages RxDB ↔ CouchDB replication for TrichoApp.
 * Handles sync lifecycle, offline/online detection, and iOS foreground sync.
 *
 * The orchestrator:
 * - Sets up bidirectional replication with CouchDB for all collections
 * - Monitors sync state and provides reactive updates
 * - Handles network connectivity changes and auto-sync
 * - Implements iOS PWA foreground sync (sync-on-open, sync-on-resume)
 * - Provides conflict resolution (last-write-wins by updatedAt)
 *
 * @module sync/orchestrator
 *
 * @example
 * ```typescript
 * import { initSync, getSyncState, triggerSync, destroySync } from '@/sync/orchestrator';
 *
 * // Initialize sync after database is ready
 * const syncState = await initSync({
 *   database: db,
 *   userId: 'user_123',
 *   authToken: 'jwt_token_here',
 * });
 *
 * // Get current sync status
 * const state = getSyncState();
 * console.log(`Sync status: ${state.status}, last sync: ${state.lastSyncAt}`);
 *
 * // Manual sync trigger (useful for iOS PWA)
 * await triggerSync();
 *
 * // Cleanup on logout
 * await destroySync();
 * ```
 */

import type { RxDatabase, RxCollection, RxReplicationState } from 'rxdb';
import { replicateCouchDB } from 'rxdb/plugins/replication-couchdb';
import { getEnv } from '../config/env';
import {
  COLLECTION_NAMES,
  type CollectionName,
} from '../db/schemas';

// ============================================================================
// Types
// ============================================================================

/**
 * Sync status enum
 */
export enum SyncStatus {
  /** Sync has not been initialized */
  Idle = 'idle',
  /** Initial sync in progress (first connection) */
  Initializing = 'initializing',
  /** Actively syncing changes */
  Syncing = 'syncing',
  /** Sync is up-to-date, watching for changes */
  Active = 'active',
  /** Sync is paused (e.g., offline or user request) */
  Paused = 'paused',
  /** Sync encountered an error */
  Error = 'error',
  /** Sync has been stopped/destroyed */
  Stopped = 'stopped',
}

/**
 * Sync direction for operations
 */
export type SyncDirection = 'push' | 'pull' | 'both';

/**
 * Conflict resolution strategy
 */
export type ConflictStrategy = 'last-write-wins' | 'server-wins' | 'client-wins' | 'custom';

/**
 * Sync error information (for state tracking)
 */
export interface SyncErrorInfo {
  /** Error code for programmatic handling */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Collection that caused the error (if applicable) */
  collection?: CollectionName;
  /** Underlying error object */
  cause?: unknown;
  /** Timestamp when error occurred */
  occurredAt: number;
  /** Whether this error is recoverable */
  recoverable: boolean;
}

/**
 * Statistics for a single collection's sync
 */
export interface CollectionSyncStats {
  /** Collection name */
  name: CollectionName;
  /** Documents pushed to server */
  docsPushed: number;
  /** Documents pulled from server */
  docsPulled: number;
  /** Last sync timestamp for this collection */
  lastSyncAt: number | null;
  /** Current sync state for this collection */
  isActive: boolean;
  /** Any errors specific to this collection */
  error: SyncErrorInfo | null;
}

/**
 * Overall sync state
 */
export interface SyncState {
  /** Current overall sync status */
  status: SyncStatus;
  /** Whether device is online */
  isOnline: boolean;
  /** Whether sync is currently active */
  isActive: boolean;
  /** Last successful sync timestamp */
  lastSyncAt: number | null;
  /** Last error encountered */
  lastError: SyncErrorInfo | null;
  /** Per-collection sync statistics */
  collections: Record<CollectionName, CollectionSyncStats>;
  /** Total documents pushed */
  totalDocsPushed: number;
  /** Total documents pulled */
  totalDocsPulled: number;
  /** User ID for the current sync session */
  userId: string | null;
}

/**
 * Options for initializing sync
 */
export interface SyncInitOptions {
  /** The initialized RxDB database */
  database: RxDatabase;
  /** User ID for CouchDB database name */
  userId: string;
  /** Authentication token for CouchDB */
  authToken?: string;
  /** CouchDB URL override (default from env) */
  couchDbUrl?: string;
  /** Collections to sync (default: all) */
  collections?: CollectionName[];
  /** Conflict resolution strategy */
  conflictStrategy?: ConflictStrategy;
  /** Enable auto-retry on error */
  autoRetry?: boolean;
  /** Retry interval in milliseconds (default: 5000) */
  retryInterval?: number;
  /** Enable iOS foreground sync handlers */
  enableForegroundSync?: boolean;
  /** Enable network change listeners */
  enableNetworkSync?: boolean;
  /** Sync direction (default: 'both') */
  direction?: SyncDirection;
  /** Live sync (continuous) vs one-time sync */
  live?: boolean;
}

/**
 * Options for manual sync trigger
 */
export interface TriggerSyncOptions {
  /** Force sync even if recently synced */
  force?: boolean;
  /** Specific collections to sync (default: all) */
  collections?: CollectionName[];
  /** Direction for this sync operation */
  direction?: SyncDirection;
}

/**
 * Replication state wrapper with metadata
 */
interface CollectionReplication {
  /** The RxDB replication state */
  replication: RxReplicationState<unknown, unknown>;
  /** Collection name */
  name: CollectionName;
  /** Subscription for state changes */
  subscription?: ReturnType<typeof replicateCouchDB>['error$']['subscribe'];
  /** Stats for this replication */
  stats: CollectionSyncStats;
}

/**
 * Event types for sync state changes
 */
export type SyncEventType =
  | 'status-change'
  | 'sync-complete'
  | 'sync-error'
  | 'online-change'
  | 'collection-sync';

/**
 * Sync event data
 */
export interface SyncEvent {
  type: SyncEventType;
  state: SyncState;
  collection?: CollectionName;
  error?: SyncErrorInfo;
}

/**
 * Sync event listener function
 */
export type SyncEventListener = (event: SyncEvent) => void;

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when sync operations fail
 */
export class SyncError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly collection?: CollectionName,
    public readonly cause?: unknown,
    public readonly recoverable: boolean = true
  ) {
    super(message);
    this.name = 'SyncError';
  }

  /**
   * Convert to SyncError object for state tracking
   */
  toSyncErrorObject(): SyncErrorInfo {
    return {
      code: this.code,
      message: this.message,
      collection: this.collection,
      cause: this.cause,
      occurredAt: Date.now(),
      recoverable: this.recoverable,
    };
  }
}

// ============================================================================
// Module State
// ============================================================================

/** Active replication instances per collection */
let replications: Map<CollectionName, CollectionReplication> = new Map();

/** Current sync state */
let currentState: SyncState = createInitialState();

/** Sync options from initialization */
let syncOptions: SyncInitOptions | null = null;

/** Event listeners */
const eventListeners: Set<SyncEventListener> = new Set();

/** Visibility change handler reference */
let visibilityHandler: (() => void) | null = null;

/** Network change handler references */
let onlineHandler: (() => void) | null = null;
let offlineHandler: (() => void) | null = null;

/** Retry timeout reference */
let retryTimeout: ReturnType<typeof setTimeout> | null = null;

// ============================================================================
// State Management
// ============================================================================

/**
 * Creates the initial sync state
 */
function createInitialState(): SyncState {
  const collections: Record<CollectionName, CollectionSyncStats> = {
    [COLLECTION_NAMES.CUSTOMERS]: createCollectionStats(COLLECTION_NAMES.CUSTOMERS),
    [COLLECTION_NAMES.VISITS]: createCollectionStats(COLLECTION_NAMES.VISITS),
    [COLLECTION_NAMES.PHOTOS]: createCollectionStats(COLLECTION_NAMES.PHOTOS),
  };

  return {
    status: SyncStatus.Idle,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isActive: false,
    lastSyncAt: null,
    lastError: null,
    collections,
    totalDocsPushed: 0,
    totalDocsPulled: 0,
    userId: null,
  };
}

/**
 * Creates initial stats for a collection
 */
function createCollectionStats(name: CollectionName): CollectionSyncStats {
  return {
    name,
    docsPushed: 0,
    docsPulled: 0,
    lastSyncAt: null,
    isActive: false,
    error: null,
  };
}

/**
 * Updates the current sync state and notifies listeners
 */
function updateState(
  updates: Partial<SyncState>,
  eventType?: SyncEventType,
  eventCollection?: CollectionName,
  eventError?: SyncErrorInfo
): void {
  currentState = {
    ...currentState,
    ...updates,
  };

  // Emit event if specified
  if (eventType) {
    emitEvent({
      type: eventType,
      state: currentState,
      collection: eventCollection,
      error: eventError,
    });
  }
}

/**
 * Updates stats for a specific collection
 */
function updateCollectionStats(
  name: CollectionName,
  updates: Partial<CollectionSyncStats>
): void {
  currentState.collections[name] = {
    ...currentState.collections[name],
    ...updates,
  };

  // Update totals
  let totalPushed = 0;
  let totalPulled = 0;
  for (const stats of Object.values(currentState.collections)) {
    totalPushed += stats.docsPushed;
    totalPulled += stats.docsPulled;
  }
  currentState.totalDocsPushed = totalPushed;
  currentState.totalDocsPulled = totalPulled;
}

// ============================================================================
// Event Handling
// ============================================================================

/**
 * Emits a sync event to all listeners
 */
function emitEvent(event: SyncEvent): void {
  for (const listener of eventListeners) {
    try {
      listener(event);
    } catch (error) {
      // Don't let listener errors break the sync system
      if (getEnv().debug) {
        console.warn('Sync event listener error:', error);
      }
    }
  }
}

/**
 * Subscribes to sync events
 *
 * @param listener - Event listener function
 * @returns Unsubscribe function
 */
export function subscribeSyncEvents(listener: SyncEventListener): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

// ============================================================================
// Conflict Resolution
// ============================================================================

/**
 * Document type with optional updatedAt for conflict resolution
 */
interface ConflictableDocument {
  updatedAt?: number;
  _deleted?: boolean;
  [key: string]: unknown;
}

/**
 * RxDB conflict handler input structure
 */
interface RxConflictHandlerInput<T> {
  /** The local version (client changes, aka "fork") */
  newDocumentState: T;
  /** The assumed state on the server when changes were made */
  realMasterState: T;
}

/**
 * RxDB conflict handler output structure
 */
interface RxConflictHandlerOutput<T> {
  /** Whether this was an actual conflict (both modified) */
  isEqual: boolean;
  /** The resolved document state */
  documentData: T;
}

/**
 * Default conflict handler implementing last-write-wins strategy.
 * Uses the updatedAt field to determine the winner.
 *
 * This handler follows RxDB's conflict handler signature:
 * - Input: { newDocumentState, realMasterState }
 * - Output: Promise<{ isEqual, documentData }>
 *
 * @param input - The conflict handler input with both document states
 * @returns Promise resolving to the conflict handler output
 *
 * @example
 * ```typescript
 * // The handler compares updatedAt timestamps:
 * // - If local (newDocumentState) is newer, keep local
 * // - If server (realMasterState) is newer, keep server
 * // - If equal timestamps, prefer server for consistency
 * ```
 */
async function lastWriteWinsConflictHandler<T extends ConflictableDocument>(
  input: RxConflictHandlerInput<T>
): Promise<RxConflictHandlerOutput<T>> {
  const { newDocumentState, realMasterState } = input;

  // Get timestamps (default to 0 if not present)
  const localTime = newDocumentState.updatedAt ?? 0;
  const serverTime = realMasterState.updatedAt ?? 0;

  // Check if documents are effectively the same
  // (same timestamp and neither is a conflict situation)
  if (localTime === serverTime) {
    // Same timestamp - documents are considered equal, prefer server for consistency
    return {
      isEqual: true,
      documentData: realMasterState,
    };
  }

  // Last write wins - prefer the newer document
  if (localTime > serverTime) {
    // Local changes are newer - keep local
    return {
      isEqual: false,
      documentData: newDocumentState,
    };
  } else {
    // Server changes are newer - keep server
    return {
      isEqual: false,
      documentData: realMasterState,
    };
  }
}

/**
 * Server-wins conflict handler.
 * Always prefers the server (master) state.
 */
async function serverWinsConflictHandler<T extends ConflictableDocument>(
  input: RxConflictHandlerInput<T>
): Promise<RxConflictHandlerOutput<T>> {
  return {
    isEqual: false,
    documentData: input.realMasterState,
  };
}

/**
 * Client-wins conflict handler.
 * Always prefers the client (local) state.
 */
async function clientWinsConflictHandler<T extends ConflictableDocument>(
  input: RxConflictHandlerInput<T>
): Promise<RxConflictHandlerOutput<T>> {
  return {
    isEqual: false,
    documentData: input.newDocumentState,
  };
}

/**
 * Type for RxDB conflict handler function
 */
type RxConflictHandler<T extends ConflictableDocument> = (
  input: RxConflictHandlerInput<T>
) => Promise<RxConflictHandlerOutput<T>>;

/**
 * Creates a conflict handler based on the strategy.
 *
 * @param strategy - The conflict resolution strategy to use
 * @returns A conflict handler function compatible with RxDB replication
 *
 * @example
 * ```typescript
 * const handler = createConflictHandler('last-write-wins');
 * // Use in replication setup:
 * replicateCouchDB({
 *   collection,
 *   url,
 *   push: { conflictHandler: handler },
 *   pull: {},
 * });
 * ```
 */
function createConflictHandler<T extends ConflictableDocument>(
  strategy: ConflictStrategy
): RxConflictHandler<T> {
  switch (strategy) {
    case 'last-write-wins':
      return lastWriteWinsConflictHandler as RxConflictHandler<T>;
    case 'server-wins':
      return serverWinsConflictHandler as RxConflictHandler<T>;
    case 'client-wins':
      return clientWinsConflictHandler as RxConflictHandler<T>;
    case 'custom':
    default:
      // Default to last-write-wins for safety
      return lastWriteWinsConflictHandler as RxConflictHandler<T>;
  }
}

// ============================================================================
// Replication Setup
// ============================================================================

/**
 * Creates the CouchDB URL for a collection
 */
function getCollectionCouchDbUrl(
  baseUrl: string,
  userId: string,
  collectionName: CollectionName
): string {
  // CouchDB database name: user_{userId}_{collection}
  // Sanitize userId for URL safety
  const safeUserId = userId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return `${baseUrl}/tricho_user_${safeUserId}_${collectionName}`;
}

/**
 * Sets up replication for a single collection
 */
async function setupCollectionReplication(
  db: RxDatabase,
  collectionName: CollectionName,
  options: SyncInitOptions
): Promise<CollectionReplication> {
  const collection = db.collections[collectionName] as RxCollection<unknown>;
  if (!collection) {
    throw new SyncError(
      `Collection '${collectionName}' not found in database`,
      'COLLECTION_NOT_FOUND',
      collectionName,
      undefined,
      false
    );
  }

  // Determine CouchDB URL
  const baseUrl = options.couchDbUrl ?? getEnv().couchdbUrl;
  const couchDbUrl = getCollectionCouchDbUrl(baseUrl, options.userId, collectionName);

  // Build fetch options with auth
  const fetchOptions: RequestInit = {
    credentials: 'include',
  };

  if (options.authToken) {
    fetchOptions.headers = {
      'Authorization': `Bearer ${options.authToken}`,
    };
  }

  // Determine replication options
  const isPush = options.direction === 'push' || options.direction === 'both';
  const isPull = options.direction === 'pull' || options.direction === 'both';

  // Create conflict handler based on strategy
  const conflictStrategy = options.conflictStrategy ?? 'last-write-wins';
  const conflictHandler = createConflictHandler<ConflictableDocument>(conflictStrategy);

  // Create replication state
  // Note: RxDB replication-couchdb uses collection's conflict handler by default
  // We configure push with our conflict handler for write conflicts
  const replication = replicateCouchDB({
    collection,
    url: couchDbUrl,
    fetch: (url, init) => {
      // Merge fetch options with auth headers
      return fetch(url, {
        ...init,
        ...fetchOptions,
        headers: {
          ...((init?.headers as Record<string, string>) ?? {}),
          ...((fetchOptions.headers as Record<string, string>) ?? {}),
        },
      });
    },
    live: options.live ?? true,
    retryTime: options.retryInterval ?? 5000,
    autoStart: true,
    push: isPush
      ? {
          /**
           * Conflict handler for push operations.
           * When local changes conflict with server state, this handler
           * resolves the conflict using the configured strategy.
           *
           * For 'last-write-wins' (default): newer updatedAt timestamp wins
           * For 'server-wins': server state always wins
           * For 'client-wins': local state always wins
           */
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          conflictHandler: conflictHandler as any,
        }
      : undefined,
    pull: isPull
      ? {
          /**
           * Pull handler for incoming documents from the server.
           * Ensures documents have proper _deleted flag for RxDB.
           */
          handler: async (docs) => {
            // Process each document - ensure _deleted is properly set
            return docs.map((doc) => ({
              ...doc,
              _deleted: doc._deleted ?? false,
            }));
          },
        }
      : undefined,
  });

  // Create stats object
  const stats = createCollectionStats(collectionName);

  // Create wrapper
  const collectionReplication: CollectionReplication = {
    replication,
    name: collectionName,
    stats,
  };

  // Set up event subscriptions
  setupReplicationSubscriptions(collectionReplication, options);

  return collectionReplication;
}

/**
 * Sets up subscriptions for replication state changes
 */
function setupReplicationSubscriptions(
  repl: CollectionReplication,
  options: SyncInitOptions
): void {
  const { replication, name } = repl;

  // Subscribe to active state changes
  replication.active$.subscribe((isActive) => {
    updateCollectionStats(name, { isActive });

    // Update overall state
    const anyActive = Array.from(replications.values()).some(
      (r) => r.stats.isActive
    );

    if (anyActive && currentState.status !== SyncStatus.Syncing) {
      updateState(
        { status: SyncStatus.Syncing, isActive: true },
        'status-change'
      );
    } else if (!anyActive && currentState.status === SyncStatus.Syncing) {
      updateState(
        {
          status: SyncStatus.Active,
          isActive: false,
          lastSyncAt: Date.now(),
        },
        'sync-complete'
      );
    }
  });

  // Subscribe to sent events (documents pushed)
  replication.sent$.subscribe((event) => {
    updateCollectionStats(name, {
      docsPushed: repl.stats.docsPushed + (event.documents?.length ?? 0),
      lastSyncAt: Date.now(),
    });
    emitEvent({
      type: 'collection-sync',
      state: currentState,
      collection: name,
    });
  });

  // Subscribe to received events (documents pulled)
  replication.received$.subscribe((event) => {
    updateCollectionStats(name, {
      docsPulled: repl.stats.docsPulled + (event.documents?.length ?? 0),
      lastSyncAt: Date.now(),
    });
    emitEvent({
      type: 'collection-sync',
      state: currentState,
      collection: name,
    });
  });

  // Subscribe to errors
  replication.error$.subscribe((error) => {
    const syncError = new SyncError(
      error.message ?? 'Replication error',
      'REPLICATION_ERROR',
      name,
      error,
      true
    );

    updateCollectionStats(name, {
      error: syncError.toSyncErrorObject(),
    });

    // Update overall state
    updateState(
      {
        status: SyncStatus.Error,
        lastError: syncError.toSyncErrorObject(),
      },
      'sync-error',
      name,
      syncError.toSyncErrorObject()
    );

    // Schedule retry if enabled
    if (options.autoRetry) {
      scheduleRetry(options);
    }
  });
}

/**
 * Schedules a sync retry after error
 */
function scheduleRetry(options: SyncInitOptions): void {
  // Clear any existing retry
  if (retryTimeout) {
    clearTimeout(retryTimeout);
  }

  const retryDelay = options.retryInterval ?? 5000;

  retryTimeout = setTimeout(async () => {
    if (currentState.status === SyncStatus.Error && currentState.isOnline) {
      try {
        await triggerSync({ force: true });
      } catch {
        // Error will be handled by the error subscription
      }
    }
  }, retryDelay);
}

// ============================================================================
// Network & Visibility Handlers
// ============================================================================

/**
 * Sets up online/offline event handlers
 */
function setupNetworkHandlers(): void {
  if (typeof window === 'undefined') {
    return;
  }

  onlineHandler = () => {
    updateState({ isOnline: true }, 'online-change');

    // Auto-sync when coming online
    if (syncOptions?.enableNetworkSync) {
      triggerSync({ force: false }).catch(() => {
        // Error handled by subscription
      });
    }
  };

  offlineHandler = () => {
    updateState({ isOnline: false }, 'online-change');

    // Pause replications when offline
    for (const repl of replications.values()) {
      repl.replication.cancel();
    }

    updateState({ status: SyncStatus.Paused });
  };

  window.addEventListener('online', onlineHandler);
  window.addEventListener('offline', offlineHandler);
}

/**
 * Sets up visibility change handler for iOS foreground sync
 */
function setupVisibilityHandler(): void {
  if (typeof document === 'undefined') {
    return;
  }

  visibilityHandler = () => {
    if (document.visibilityState === 'visible') {
      // App came to foreground - trigger sync
      if (syncOptions?.enableForegroundSync && currentState.isOnline) {
        triggerSync({ force: false }).catch(() => {
          // Error handled by subscription
        });
      }
    }
  };

  document.addEventListener('visibilitychange', visibilityHandler);
}

/**
 * Removes all event handlers
 */
function removeEventHandlers(): void {
  if (typeof window !== 'undefined') {
    if (onlineHandler) {
      window.removeEventListener('online', onlineHandler);
      onlineHandler = null;
    }
    if (offlineHandler) {
      window.removeEventListener('offline', offlineHandler);
      offlineHandler = null;
    }
  }

  if (typeof document !== 'undefined' && visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }

  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initializes the sync orchestrator with CouchDB replication.
 * Should be called after database initialization and user authentication.
 *
 * @param options - Sync initialization options
 * @returns Promise resolving to initial sync state
 * @throws {SyncError} If initialization fails
 *
 * @example
 * ```typescript
 * const state = await initSync({
 *   database: db,
 *   userId: 'user_123',
 *   authToken: sessionToken,
 *   enableForegroundSync: true,  // Important for iOS PWA
 *   enableNetworkSync: true,
 *   conflictStrategy: 'last-write-wins',
 * });
 * ```
 */
export async function initSync(options: SyncInitOptions): Promise<SyncState> {
  // Validate inputs
  if (!options.database) {
    throw new SyncError(
      'Database is required for sync initialization',
      'INVALID_CONFIG',
      undefined,
      undefined,
      false
    );
  }

  if (!options.userId) {
    throw new SyncError(
      'User ID is required for sync initialization',
      'INVALID_CONFIG',
      undefined,
      undefined,
      false
    );
  }

  // Stop existing sync if any
  await destroySync();

  // Store options for later use
  syncOptions = {
    ...options,
    conflictStrategy: options.conflictStrategy ?? 'last-write-wins',
    autoRetry: options.autoRetry ?? true,
    retryInterval: options.retryInterval ?? 5000,
    enableForegroundSync: options.enableForegroundSync ?? true,
    enableNetworkSync: options.enableNetworkSync ?? true,
    direction: options.direction ?? 'both',
    live: options.live ?? true,
  };

  // Reset state
  currentState = createInitialState();
  updateState({
    status: SyncStatus.Initializing,
    userId: options.userId,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  });

  // Determine which collections to sync
  const collectionsToSync = options.collections ?? [
    COLLECTION_NAMES.CUSTOMERS,
    COLLECTION_NAMES.VISITS,
    COLLECTION_NAMES.PHOTOS,
  ];

  // Set up replications for each collection
  const errors: SyncError[] = [];

  for (const collectionName of collectionsToSync) {
    try {
      const replication = await setupCollectionReplication(
        options.database,
        collectionName,
        syncOptions
      );
      replications.set(collectionName, replication);
    } catch (error) {
      const syncError =
        error instanceof SyncError
          ? error
          : new SyncError(
              `Failed to setup replication for ${collectionName}: ${
                error instanceof Error ? error.message : 'Unknown error'
              }`,
              'SETUP_FAILED',
              collectionName,
              error
            );
      errors.push(syncError);
    }
  }

  // Set up event handlers
  if (syncOptions.enableNetworkSync) {
    setupNetworkHandlers();
  }

  if (syncOptions.enableForegroundSync) {
    setupVisibilityHandler();
  }

  // Check if any setup failed
  if (errors.length > 0) {
    if (errors.length === collectionsToSync.length) {
      // All collections failed - this is a critical error
      updateState({
        status: SyncStatus.Error,
        lastError: errors[0].toSyncErrorObject(),
      });
      throw errors[0];
    }

    // Partial failure - continue but report the error
    updateState({
      status: SyncStatus.Active,
      lastError: errors[0].toSyncErrorObject(),
    });
  } else {
    // All successful
    updateState({
      status: SyncStatus.Active,
    });
  }

  return currentState;
}

/**
 * Gets the current sync state.
 *
 * @returns Current sync state
 *
 * @example
 * ```typescript
 * const state = getSyncState();
 * if (state.status === SyncStatus.Error) {
 *   console.error('Sync error:', state.lastError);
 * }
 * ```
 */
export function getSyncState(): SyncState {
  return { ...currentState };
}

/**
 * Gets sync statistics for a specific collection.
 *
 * @param collectionName - Name of the collection
 * @returns Collection sync stats
 */
export function getCollectionSyncStats(
  collectionName: CollectionName
): CollectionSyncStats {
  return { ...currentState.collections[collectionName] };
}

/**
 * Checks if sync is currently active.
 *
 * @returns true if sync is initialized and running
 */
export function isSyncActive(): boolean {
  return (
    currentState.status === SyncStatus.Active ||
    currentState.status === SyncStatus.Syncing
  );
}

/**
 * Checks if the device is online.
 *
 * @returns true if the device has network connectivity
 */
export function isOnline(): boolean {
  return currentState.isOnline;
}

/**
 * Triggers a manual sync operation.
 * Use this for the "Sync Now" button in the UI.
 *
 * @param options - Trigger options
 * @returns Promise resolving when sync starts (not when it completes)
 *
 * @example
 * ```typescript
 * // Basic sync trigger
 * await triggerSync();
 *
 * // Force sync even if recently synced
 * await triggerSync({ force: true });
 *
 * // Sync only specific collections
 * await triggerSync({ collections: ['customers'] });
 * ```
 */
export async function triggerSync(options: TriggerSyncOptions = {}): Promise<void> {
  if (!syncOptions) {
    throw new SyncError(
      'Sync not initialized. Call initSync() first.',
      'NOT_INITIALIZED',
      undefined,
      undefined,
      false
    );
  }

  if (!currentState.isOnline) {
    throw new SyncError(
      'Cannot sync while offline',
      'OFFLINE',
      undefined,
      undefined,
      true
    );
  }

  // Determine which collections to sync
  const collectionsToSync = options.collections ?? Array.from(replications.keys());

  updateState({ status: SyncStatus.Syncing, isActive: true }, 'status-change');

  // Restart replications that may have been paused
  for (const collectionName of collectionsToSync) {
    const repl = replications.get(collectionName);
    if (repl) {
      // If paused or in error state, restart
      if (!repl.stats.isActive) {
        try {
          await repl.replication.reSync();
        } catch (error) {
          // Error will be handled by the error subscription
          if (getEnv().debug) {
            console.warn(`Failed to resync ${collectionName}:`, error);
          }
        }
      }
    }
  }
}

/**
 * Pauses sync operations.
 * Useful when the user wants to work offline or conserve battery.
 *
 * @example
 * ```typescript
 * // Pause sync for offline work
 * await pauseSync();
 *
 * // Later, resume sync
 * await resumeSync();
 * ```
 */
export async function pauseSync(): Promise<void> {
  for (const repl of replications.values()) {
    await repl.replication.cancel();
  }

  updateState({ status: SyncStatus.Paused, isActive: false }, 'status-change');
}

/**
 * Resumes sync operations after pausing.
 *
 * @example
 * ```typescript
 * await resumeSync();
 * ```
 */
export async function resumeSync(): Promise<void> {
  if (!syncOptions) {
    throw new SyncError(
      'Sync not initialized. Call initSync() first.',
      'NOT_INITIALIZED',
      undefined,
      undefined,
      false
    );
  }

  if (!currentState.isOnline) {
    throw new SyncError(
      'Cannot resume sync while offline',
      'OFFLINE',
      undefined,
      undefined,
      true
    );
  }

  updateState({ status: SyncStatus.Syncing, isActive: true }, 'status-change');

  for (const repl of replications.values()) {
    try {
      await repl.replication.reSync();
    } catch (error) {
      // Error will be handled by the error subscription
      if (getEnv().debug) {
        console.warn(`Failed to resume ${repl.name}:`, error);
      }
    }
  }
}

/**
 * Stops and cleans up all sync operations.
 * Call this when the user logs out or the app is shutting down.
 *
 * @example
 * ```typescript
 * // On logout
 * await destroySync();
 * await closeDatabase();
 * ```
 */
export async function destroySync(): Promise<void> {
  // Remove event handlers
  removeEventHandlers();

  // Cancel all replications
  for (const repl of replications.values()) {
    try {
      await repl.replication.cancel();
    } catch {
      // Ignore errors during cleanup
    }
  }

  // Clear replications
  replications.clear();

  // Clear event listeners
  eventListeners.clear();

  // Reset state
  syncOptions = null;
  currentState = createInitialState();
  currentState.status = SyncStatus.Stopped;
}

/**
 * Awaits the next sync completion.
 * Useful for testing or ensuring data is synced before proceeding.
 *
 * @param timeout - Maximum time to wait in milliseconds (default: 30000)
 * @returns Promise resolving to the sync state after completion
 * @throws {SyncError} If timeout is reached or sync fails
 *
 * @example
 * ```typescript
 * // Wait for sync to complete before navigation
 * await awaitSync();
 * router.navigate('/dashboard');
 * ```
 */
export async function awaitSync(timeout = 30000): Promise<SyncState> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      unsubscribe();
      reject(
        new SyncError(
          'Sync timeout exceeded',
          'TIMEOUT',
          undefined,
          undefined,
          true
        )
      );
    }, timeout);

    const unsubscribe = subscribeSyncEvents((event) => {
      if (event.type === 'sync-complete') {
        clearTimeout(timeoutId);
        unsubscribe();
        resolve(event.state);
      } else if (event.type === 'sync-error' && event.error) {
        clearTimeout(timeoutId);
        unsubscribe();
        reject(
          new SyncError(
            event.error.message,
            event.error.code,
            event.error.collection as CollectionName,
            event.error.cause,
            event.error.recoverable
          )
        );
      }
    });

    // Trigger sync if not already syncing
    if (currentState.status !== SyncStatus.Syncing) {
      triggerSync().catch((error) => {
        clearTimeout(timeoutId);
        unsubscribe();
        reject(error);
      });
    }
  });
}

/**
 * Gets the time since the last successful sync.
 *
 * @returns Milliseconds since last sync, or null if never synced
 */
export function getTimeSinceLastSync(): number | null {
  if (!currentState.lastSyncAt) {
    return null;
  }
  return Date.now() - currentState.lastSyncAt;
}

/**
 * Checks if sync is stale (hasn't synced in a while).
 *
 * @param threshold - Threshold in milliseconds (default: 5 minutes)
 * @returns true if last sync was more than threshold ago
 */
export function isSyncStale(threshold = 5 * 60 * 1000): boolean {
  const timeSince = getTimeSinceLastSync();
  if (timeSince === null) {
    return true;
  }
  return timeSince > threshold;
}

// ============================================================================
// Conflict Resolution Exports
// ============================================================================

/**
 * Gets the conflict handler function for a given strategy.
 * Useful for testing or custom replication setups.
 *
 * @param strategy - The conflict resolution strategy
 * @returns The conflict handler function
 *
 * @example
 * ```typescript
 * const handler = getConflictHandler('last-write-wins');
 * const result = await handler({
 *   newDocumentState: localDoc,
 *   realMasterState: serverDoc,
 * });
 * console.log('Winner:', result.documentData);
 * ```
 */
export function getConflictHandler(
  strategy: ConflictStrategy = 'last-write-wins'
): RxConflictHandler<ConflictableDocument> {
  return createConflictHandler(strategy);
}

/**
 * Resolves a conflict between two document states using last-write-wins.
 * Convenience function for manual conflict resolution.
 *
 * @param localDoc - The local document state
 * @param serverDoc - The server document state
 * @returns Promise resolving to the winning document
 *
 * @example
 * ```typescript
 * const winner = await resolveConflict(localCustomer, serverCustomer);
 * ```
 */
export async function resolveConflict<T extends ConflictableDocument>(
  localDoc: T,
  serverDoc: T
): Promise<T> {
  const result = await lastWriteWinsConflictHandler({
    newDocumentState: localDoc,
    realMasterState: serverDoc,
  });
  return result.documentData as T;
}

/**
 * Compares two documents and determines which is newer.
 *
 * @param docA - First document
 * @param docB - Second document
 * @returns -1 if docA is newer, 1 if docB is newer, 0 if equal
 */
export function compareDocumentTimestamps<T extends ConflictableDocument>(
  docA: T,
  docB: T
): -1 | 0 | 1 {
  const timeA = docA.updatedAt ?? 0;
  const timeB = docB.updatedAt ?? 0;

  if (timeA > timeB) return -1;
  if (timeB > timeA) return 1;
  return 0;
}

// ============================================================================
// Exports for Testing
// ============================================================================

/**
 * Resets sync module state (for testing only)
 * @internal
 */
export function _resetSyncState(): void {
  removeEventHandlers();
  replications.clear();
  eventListeners.clear();
  syncOptions = null;
  currentState = createInitialState();
}

/**
 * Exposes the conflict handler for testing purposes.
 * @internal
 */
export const _conflictHandlers = {
  lastWriteWins: lastWriteWinsConflictHandler,
  serverWins: serverWinsConflictHandler,
  clientWins: clientWinsConflictHandler,
  create: createConflictHandler,
} as const;
