/**
 * KeyStore IndexedDB module for vault state storage
 *
 * This module provides a dedicated IndexedDB database (`tricho_keystore`) separate from RxDB
 * for storing vault state including wrapped DEKs, device salt, credential IDs, and metadata.
 *
 * The KeyStore supports dual-wrap DEK storage:
 * - wrapped_dek_prf: DEK wrapped with KEK derived from WebAuthn PRF output
 * - wrapped_dek_rs: DEK wrapped with KEK derived from Recovery Secret
 *
 * Both unlock paths lead to the same DEK, enabling offline passkey unlock
 * and RS-based recovery.
 */

/** Version string for info domain separation */
export const KEYSTORE_VERSION = 'v1';

/** Database configuration */
const DB_NAME = 'tricho_keystore';
const DB_VERSION = 1;
const STORE_NAME = 'vault_state';

/**
 * Wrapped key metadata
 * Contains all information needed to unwrap a DEK
 */
export interface WrappedKeyData {
  /** Wrapped key ciphertext (Base64url encoded) */
  ct: string;
  /** Initialization vector (Base64url encoded) */
  iv: string;
  /** Algorithm identifier */
  alg: 'AES-256-GCM';
  /** Key version for rotation tracking */
  version: number;
  /** Timestamp when this wrap was created */
  createdAt: number;
}

/**
 * Complete vault state stored in KeyStore
 */
export interface VaultState {
  /** Unique vault identifier (derived from first passkey credential) */
  vaultId: string;
  /** Device-specific salt for key derivation (Base64url encoded) */
  deviceSalt: string;
  /** DEK wrapped with KEK derived from PRF output */
  wrappedDekPrf: WrappedKeyData | null;
  /** DEK wrapped with KEK derived from Recovery Secret */
  wrappedDekRs: WrappedKeyData | null;
  /** DEK wrapped with KEK derived from a local PIN (non-PRF fallback) */
  wrappedDekPin?: WrappedKeyData | null;
  /** Base64url salt for PBKDF2(PIN) — separate from deviceSalt. */
  pinSalt?: string | null;
  /** WebAuthn credential ID (Base64url encoded) */
  credentialId: string | null;
  /** User ID for multi-user support */
  userId: string;
  /** Timestamp when vault was created */
  createdAt: number;
  /** Timestamp of last update */
  updatedAt: number;
  /** Whether RS has been confirmed by user */
  rsConfirmed: boolean;
  /** Metadata for diagnostics and debugging */
  metadata: VaultMetadata;
}

/**
 * Vault metadata for diagnostics
 */
export interface VaultMetadata {
  /** Browser user agent string (for debugging cross-device issues) */
  userAgent: string;
  /** Platform info */
  platform: string;
  /** Last successful unlock timestamp */
  lastUnlockedAt: number | null;
  /** Last unlock method used */
  lastUnlockMethod: 'prf' | 'rs' | null;
}

/**
 * Type for vault state updates (partial updates)
 */
export type VaultStateUpdate = Partial<Omit<VaultState, 'vaultId' | 'createdAt'>>;

/** Singleton database promise */
let dbPromise: Promise<IDBDatabase | null> | null = null;

/**
 * Opens or returns the existing KeyStore database connection
 *
 * Uses a singleton pattern to maintain a single connection across the app.
 * Creates the database and object stores on first access.
 *
 * @returns Promise resolving to IDBDatabase or null if IndexedDB unavailable
 */
export function openKeyStoreDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error(`Failed to open KeyStore database: ${request.error?.message}`));
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // Create vault_state store with vaultId as key
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'vaultId' });
        // Index on userId for multi-user lookup
        store.createIndex('userId', 'userId', { unique: false });
        // Index on credentialId for passkey lookup
        store.createIndex('credentialId', 'credentialId', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Handle connection errors
      db.onerror = (errorEvent) => {
        const target = errorEvent.target as IDBRequest;
        throw new Error(`KeyStore database error: ${target.error?.message}`);
      };

      resolve(db);
    };
  });

  return dbPromise;
}

/**
 * Closes the KeyStore database connection
 * Useful for cleanup during testing or app shutdown
 */
export async function closeKeyStoreDb(): Promise<void> {
  if (!dbPromise) return;

  const db = await dbPromise;
  if (db) {
    db.close();
  }
  dbPromise = null;
}

/**
 * Creates a new vault state entry
 *
 * @param state - Initial vault state to store
 * @returns Promise resolving when stored
 * @throws Error if vault with same ID already exists
 */
export async function createVaultState(state: VaultState): Promise<void> {
  const db = await openKeyStoreDb();
  if (!db) {
    throw new Error('KeyStore database not available');
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const request = store.add(state);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      if (request.error?.name === 'ConstraintError') {
        reject(new Error(`Vault with ID ${state.vaultId} already exists`));
      } else {
        reject(new Error(`Failed to create vault state: ${request.error?.message}`));
      }
    };
  });
}

/**
 * Retrieves a vault state by vault ID
 *
 * @param vaultId - Unique vault identifier
 * @returns Promise resolving to VaultState or null if not found
 */
export async function getVaultState(vaultId: string): Promise<VaultState | null> {
  const db = await openKeyStoreDb();
  if (!db) {
    throw new Error('KeyStore database not available');
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(vaultId);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = () => {
      reject(new Error(`Failed to get vault state: ${request.error?.message}`));
    };
  });
}

/**
 * Retrieves a vault state by user ID
 *
 * @param userId - User identifier
 * @returns Promise resolving to VaultState or null if not found
 */
export async function getVaultStateByUserId(userId: string): Promise<VaultState | null> {
  const db = await openKeyStoreDb();
  if (!db) {
    throw new Error('KeyStore database not available');
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('userId');
    const request = index.get(userId);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = () => {
      reject(new Error(`Failed to get vault state by user ID: ${request.error?.message}`));
    };
  });
}

/**
 * Retrieves a vault state by credential ID
 *
 * @param credentialId - WebAuthn credential ID (Base64url encoded)
 * @returns Promise resolving to VaultState or null if not found
 */
export async function getVaultStateByCredentialId(credentialId: string): Promise<VaultState | null> {
  const db = await openKeyStoreDb();
  if (!db) {
    throw new Error('KeyStore database not available');
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('credentialId');
    const request = index.get(credentialId);

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    request.onerror = () => {
      reject(new Error(`Failed to get vault state by credential ID: ${request.error?.message}`));
    };
  });
}

/**
 * Updates an existing vault state
 *
 * @param vaultId - Vault identifier to update
 * @param updates - Partial updates to apply
 * @returns Promise resolving when updated
 * @throws Error if vault doesn't exist
 */
export async function updateVaultState(vaultId: string, updates: VaultStateUpdate): Promise<void> {
  const db = await openKeyStoreDb();
  if (!db) {
    throw new Error('KeyStore database not available');
  }

  const existing = await getVaultState(vaultId);
  if (!existing) {
    throw new Error(`Vault with ID ${vaultId} not found`);
  }

  const updated: VaultState = {
    ...existing,
    ...updates,
    updatedAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(updated);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error(`Failed to update vault state: ${request.error?.message}`));
    };
  });
}

/**
 * Deletes a vault state
 *
 * @param vaultId - Vault identifier to delete
 * @returns Promise resolving when deleted
 */
export async function deleteVaultState(vaultId: string): Promise<void> {
  const db = await openKeyStoreDb();
  if (!db) {
    throw new Error('KeyStore database not available');
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(vaultId);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error(`Failed to delete vault state: ${request.error?.message}`));
    };
  });
}

/**
 * Lists all vault states
 * Primarily for debugging and admin purposes
 *
 * @returns Promise resolving to array of VaultState
 */
export async function listVaultStates(): Promise<VaultState[]> {
  const db = await openKeyStoreDb();
  if (!db) {
    throw new Error('KeyStore database not available');
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      reject(new Error(`Failed to list vault states: ${request.error?.message}`));
    };
  });
}

/**
 * Checks if a vault exists for the given user
 *
 * @param userId - User identifier
 * @returns Promise resolving to boolean
 */
export async function hasVaultForUser(userId: string): Promise<boolean> {
  const vault = await getVaultStateByUserId(userId);
  return vault !== null;
}

/**
 * Updates the wrapped DEK for PRF unlock path
 *
 * @param vaultId - Vault identifier
 * @param wrappedDekPrf - New wrapped DEK data
 * @returns Promise resolving when updated
 */
export async function updateWrappedDekPrf(vaultId: string, wrappedDekPrf: WrappedKeyData): Promise<void> {
  return updateVaultState(vaultId, { wrappedDekPrf });
}

/**
 * Updates the wrapped DEK for RS unlock path
 *
 * @param vaultId - Vault identifier
 * @param wrappedDekRs - New wrapped DEK data
 * @returns Promise resolving when updated
 */
export async function updateWrappedDekRs(vaultId: string, wrappedDekRs: WrappedKeyData): Promise<void> {
  return updateVaultState(vaultId, { wrappedDekRs });
}

/**
 * Updates the wrapped DEK for PIN unlock path (authenticators without PRF).
 */
export async function updateWrappedDekPin(
  vaultId: string,
  wrappedDekPin: WrappedKeyData,
  pinSalt: string,
): Promise<void> {
  return updateVaultState(vaultId, { wrappedDekPin, pinSalt });
}

/**
 * Parameters for dual DEK wrapping
 */
export interface DualWrapParams {
  /** DEK wrapped with KEK derived from PRF output */
  wrappedDekPrf: WrappedKeyData;
  /** DEK wrapped with KEK derived from Recovery Secret */
  wrappedDekRs: WrappedKeyData;
}

/**
 * Updates both wrapped DEKs (PRF and RS) atomically
 *
 * This is the preferred method for initial vault setup or DEK rotation,
 * ensuring both unlock paths are updated together in a single transaction.
 *
 * @param vaultId - Vault identifier
 * @param params - Both wrapped DEK data objects
 * @returns Promise resolving when both wraps are stored
 * @throws Error if vault doesn't exist or wrapped key data is invalid
 */
export async function updateDualWrappedDek(
  vaultId: string,
  params: DualWrapParams
): Promise<void> {
  // Validate wrapped key data
  validateWrappedKeyData(params.wrappedDekPrf, 'PRF');
  validateWrappedKeyData(params.wrappedDekRs, 'RS');

  return updateVaultState(vaultId, {
    wrappedDekPrf: params.wrappedDekPrf,
    wrappedDekRs: params.wrappedDekRs,
  });
}

/**
 * Validates wrapped key data has all required fields
 *
 * @param data - Wrapped key data to validate
 * @param label - Label for error messages (e.g., 'PRF' or 'RS')
 * @throws Error if validation fails
 */
function validateWrappedKeyData(data: WrappedKeyData, label: string): void {
  if (!data.ct || typeof data.ct !== 'string') {
    throw new Error(`Invalid ${label} wrapped key: missing or invalid ciphertext`);
  }
  if (!data.iv || typeof data.iv !== 'string') {
    throw new Error(`Invalid ${label} wrapped key: missing or invalid IV`);
  }
  if (data.alg !== 'AES-256-GCM') {
    throw new Error(`Invalid ${label} wrapped key: unsupported algorithm ${data.alg}`);
  }
  if (typeof data.version !== 'number' || data.version < 1) {
    throw new Error(`Invalid ${label} wrapped key: invalid version`);
  }
  if (typeof data.createdAt !== 'number' || data.createdAt <= 0) {
    throw new Error(`Invalid ${label} wrapped key: invalid createdAt timestamp`);
  }
}

/**
 * Checks if a vault has complete dual DEK wrapping
 *
 * Both PRF and RS wrapped DEKs must be present for dual wrapping to be complete.
 * This is required before the vault can be used for both offline passkey unlock
 * and RS-based recovery.
 *
 * @param vaultId - Vault identifier
 * @returns Promise resolving to boolean indicating if dual wrapping is complete
 */
export async function hasDualWrappedDek(vaultId: string): Promise<boolean> {
  const vault = await getVaultState(vaultId);
  if (!vault) {
    return false;
  }
  return vault.wrappedDekPrf !== null && vault.wrappedDekRs !== null;
}

/**
 * Retrieves both wrapped DEKs from a vault
 *
 * @param vaultId - Vault identifier
 * @returns Promise resolving to DualWrapParams or null if not complete
 */
export async function getDualWrappedDek(vaultId: string): Promise<DualWrapParams | null> {
  const vault = await getVaultState(vaultId);
  if (!vault || !vault.wrappedDekPrf || !vault.wrappedDekRs) {
    return null;
  }
  return {
    wrappedDekPrf: vault.wrappedDekPrf,
    wrappedDekRs: vault.wrappedDekRs,
  };
}

/**
 * Creates a new WrappedKeyData object with current timestamp
 *
 * Helper function for creating properly formatted wrapped key metadata.
 *
 * @param ct - Ciphertext (Base64url encoded)
 * @param iv - Initialization vector (Base64url encoded)
 * @param version - Key version (defaults to 1)
 * @returns WrappedKeyData object
 */
export function createWrappedKeyData(
  ct: string,
  iv: string,
  version: number = 1
): WrappedKeyData {
  return {
    ct,
    iv,
    alg: 'AES-256-GCM',
    version,
    createdAt: Date.now(),
  };
}

/**
 * Updates the credential ID for a vault
 *
 * @param vaultId - Vault identifier
 * @param credentialId - New credential ID
 * @returns Promise resolving when updated
 */
export async function updateCredentialId(vaultId: string, credentialId: string): Promise<void> {
  return updateVaultState(vaultId, { credentialId });
}

/**
 * Marks the Recovery Secret as confirmed
 *
 * @param vaultId - Vault identifier
 * @returns Promise resolving when updated
 */
export async function confirmRecoverySecret(vaultId: string): Promise<void> {
  return updateVaultState(vaultId, { rsConfirmed: true });
}

/**
 * Records a successful unlock event
 *
 * @param vaultId - Vault identifier
 * @param method - Unlock method used
 * @returns Promise resolving when updated
 */
export async function recordUnlock(vaultId: string, method: 'prf' | 'rs'): Promise<void> {
  const existing = await getVaultState(vaultId);
  if (!existing) {
    throw new Error(`Vault with ID ${vaultId} not found`);
  }

  const updatedMetadata: VaultMetadata = {
    ...existing.metadata,
    lastUnlockedAt: Date.now(),
    lastUnlockMethod: method,
  };

  return updateVaultState(vaultId, { metadata: updatedMetadata });
}

/**
 * Creates default vault metadata
 *
 * @returns Default VaultMetadata object
 */
export function createDefaultMetadata(): VaultMetadata {
  return {
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
    lastUnlockedAt: null,
    lastUnlockMethod: null,
  };
}

/**
 * Generates a unique vault ID
 *
 * Uses crypto.randomUUID() if available, falls back to timestamp-based ID
 *
 * @returns Unique vault identifier string
 */
export function generateVaultId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return `vault-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Clears all vault states from the KeyStore
 * WARNING: This is destructive and should only be used for testing or reset
 *
 * @returns Promise resolving when cleared
 */
export async function clearAllVaultStates(): Promise<void> {
  const db = await openKeyStoreDb();
  if (!db) {
    throw new Error('KeyStore database not available');
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error(`Failed to clear vault states: ${request.error?.message}`));
    };
  });
}

/**
 * Deletes the entire KeyStore database
 * WARNING: This is destructive and should only be used for testing or complete reset
 *
 * @returns Promise resolving when deleted
 */
export async function deleteKeyStoreDb(): Promise<void> {
  // Close any open connection first
  await closeKeyStoreDb();

  if (typeof indexedDB === 'undefined') {
    return;
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error(`Failed to delete KeyStore database: ${request.error?.message}`));
    };

    request.onblocked = () => {
      // Database delete was blocked, likely due to open connections
      reject(new Error('KeyStore database deletion was blocked'));
    };
  });
}
