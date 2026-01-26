/**
 * Sync State Hooks for React Components
 *
 * Provides React hooks that subscribe to sync orchestrator state changes
 * and return reactive results for building sync-aware UI components.
 *
 * @module sync/hooks
 *
 * @example
 * ```tsx
 * import { useSyncState, useSyncStatus, useIsOnline } from '@/sync/hooks';
 *
 * function SyncStatusBadge() {
 *   const { status, lastSyncAt, isOnline } = useSyncState();
 *   const isSyncing = useSyncStatus() === SyncStatus.Syncing;
 *
 *   return (
 *     <div>
 *       {isOnline ? 'Online' : 'Offline'}
 *       {isSyncing && <Spinner />}
 *       {lastSyncAt && `Last sync: ${formatTime(lastSyncAt)}`}
 *     </div>
 *   );
 * }
 * ```
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  getSyncState,
  subscribeSyncEvents,
  triggerSync,
  pauseSync,
  resumeSync,
  getTimeSinceLastSync,
  isSyncStale,
  isSyncActive,
  isOnline as checkIsOnline,
  SyncStatus,
  type SyncState,
  type SyncEvent,
  type SyncEventType,
  type CollectionSyncStats,
  type CollectionName,
  type TriggerSyncOptions,
  type SyncErrorInfo,
} from './orchestrator';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of useSyncState hook
 */
export interface SyncStateHookResult {
  /** Current sync state */
  state: SyncState;
  /** Whether sync is initialized and running */
  isActive: boolean;
  /** Whether the device is online */
  isOnline: boolean;
  /** Current sync status */
  status: SyncStatus;
  /** Last successful sync timestamp */
  lastSyncAt: number | null;
  /** Last error encountered */
  lastError: SyncErrorInfo | null;
  /** Total documents pushed */
  totalDocsPushed: number;
  /** Total documents pulled */
  totalDocsPulled: number;
}

/**
 * Result of useSyncActions hook
 */
export interface SyncActionsHookResult {
  /** Trigger a manual sync */
  sync: (options?: TriggerSyncOptions) => Promise<void>;
  /** Pause sync operations */
  pause: () => Promise<void>;
  /** Resume sync operations */
  resume: () => Promise<void>;
  /** Whether a sync operation is currently in progress */
  isSyncing: boolean;
  /** Whether an action is currently pending */
  isPending: boolean;
  /** Error from the last action */
  error: Error | null;
}

/**
 * Options for useSyncState hook
 */
export interface UseSyncStateOptions {
  /** Event types to subscribe to (default: all) */
  eventTypes?: SyncEventType[];
  /** Whether to update on every event (default: true) */
  updateOnEvents?: boolean;
}

/**
 * Options for useLastSyncTime hook
 */
export interface UseLastSyncTimeOptions {
  /** Update interval in milliseconds (default: 1000) */
  updateInterval?: number;
  /** Whether to format as relative time (default: false) */
  formatRelative?: boolean;
}

// ============================================================================
// Main State Hook
// ============================================================================

/**
 * Hook to subscribe to sync state changes.
 * Returns the current sync state with reactive updates.
 *
 * @param options - Hook options
 * @returns Current sync state with derived values
 *
 * @example
 * ```tsx
 * function SyncIndicator() {
 *   const { status, isOnline, lastSyncAt, lastError } = useSyncState();
 *
 *   return (
 *     <div className="sync-indicator">
 *       <span className={`status-${status}`}>{status}</span>
 *       {!isOnline && <span className="offline-badge">Offline</span>}
 *       {lastError && <span className="error">{lastError.message}</span>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useSyncState(options: UseSyncStateOptions = {}): SyncStateHookResult {
  const { eventTypes, updateOnEvents = true } = options;

  const [state, setState] = useState<SyncState>(() => getSyncState());

  useEffect(() => {
    // Get initial state
    setState(getSyncState());

    if (!updateOnEvents) {
      return;
    }

    // Subscribe to sync events
    const unsubscribe = subscribeSyncEvents((event: SyncEvent) => {
      // Filter by event type if specified
      if (eventTypes && !eventTypes.includes(event.type)) {
        return;
      }

      // Update state from event
      setState(event.state);
    });

    return () => {
      unsubscribe();
    };
  }, [eventTypes, updateOnEvents]);

  return {
    state,
    isActive: state.isActive,
    isOnline: state.isOnline,
    status: state.status,
    lastSyncAt: state.lastSyncAt,
    lastError: state.lastError,
    totalDocsPushed: state.totalDocsPushed,
    totalDocsPulled: state.totalDocsPulled,
  };
}

// ============================================================================
// Status Hooks
// ============================================================================

/**
 * Hook to get just the current sync status.
 * More lightweight than useSyncState when you only need the status.
 *
 * @returns Current sync status
 *
 * @example
 * ```tsx
 * function SyncStatusBadge() {
 *   const status = useSyncStatus();
 *
 *   const colors = {
 *     [SyncStatus.Active]: 'green',
 *     [SyncStatus.Syncing]: 'blue',
 *     [SyncStatus.Paused]: 'yellow',
 *     [SyncStatus.Error]: 'red',
 *   };
 *
 *   return <Badge color={colors[status]}>{status}</Badge>;
 * }
 * ```
 */
export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(() => getSyncState().status);

  useEffect(() => {
    // Get initial status
    setStatus(getSyncState().status);

    // Subscribe to status changes only
    const unsubscribe = subscribeSyncEvents((event) => {
      if (event.type === 'status-change' || event.type === 'sync-complete' || event.type === 'sync-error') {
        setStatus(event.state.status);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return status;
}

/**
 * Hook to check if currently syncing.
 *
 * @returns true if sync is actively in progress
 *
 * @example
 * ```tsx
 * function SyncButton() {
 *   const isSyncing = useIsSyncing();
 *   const { sync } = useSyncActions();
 *
 *   return (
 *     <button onClick={() => sync()} disabled={isSyncing}>
 *       {isSyncing ? <Spinner /> : 'Sync Now'}
 *     </button>
 *   );
 * }
 * ```
 */
export function useIsSyncing(): boolean {
  const status = useSyncStatus();
  return status === SyncStatus.Syncing || status === SyncStatus.Initializing;
}

/**
 * Hook to check online/offline status.
 *
 * @returns true if the device is online
 *
 * @example
 * ```tsx
 * function OfflineNotice() {
 *   const isOnline = useIsOnline();
 *
 *   if (isOnline) return null;
 *
 *   return (
 *     <div className="offline-banner">
 *       You're offline. Changes will sync when reconnected.
 *     </div>
 *   );
 * }
 * ```
 */
export function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() => checkIsOnline());

  useEffect(() => {
    // Get initial state
    setIsOnline(checkIsOnline());

    // Subscribe to online changes
    const unsubscribe = subscribeSyncEvents((event) => {
      if (event.type === 'online-change') {
        setIsOnline(event.state.isOnline);
      }
    });

    // Also listen to browser online/offline events directly for faster response
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }

    return () => {
      unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
    };
  }, []);

  return isOnline;
}

// ============================================================================
// Time Hooks
// ============================================================================

/**
 * Hook to get the time since last sync with automatic updates.
 *
 * @param options - Hook options
 * @returns Time since last sync in milliseconds, or null if never synced
 *
 * @example
 * ```tsx
 * function LastSyncIndicator() {
 *   const timeSince = useTimeSinceLastSync({ updateInterval: 1000 });
 *
 *   if (timeSince === null) {
 *     return <span>Never synced</span>;
 *   }
 *
 *   const minutes = Math.floor(timeSince / 60000);
 *   return <span>Last sync: {minutes}m ago</span>;
 * }
 * ```
 */
export function useTimeSinceLastSync(options: UseLastSyncTimeOptions = {}): number | null {
  const { updateInterval = 1000 } = options;

  const [timeSince, setTimeSince] = useState<number | null>(() => getTimeSinceLastSync());

  useEffect(() => {
    // Update immediately
    setTimeSince(getTimeSinceLastSync());

    // Set up interval to update the time
    const interval = setInterval(() => {
      setTimeSince(getTimeSinceLastSync());
    }, updateInterval);

    // Also update on sync complete events
    const unsubscribe = subscribeSyncEvents((event) => {
      if (event.type === 'sync-complete') {
        setTimeSince(0); // Just synced
      }
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [updateInterval]);

  return timeSince;
}

/**
 * Hook to get a formatted "last sync" string.
 *
 * @param options - Hook options
 * @returns Formatted last sync time string
 *
 * @example
 * ```tsx
 * function SyncTime() {
 *   const lastSyncText = useFormattedLastSync();
 *   return <span>{lastSyncText}</span>;
 * }
 * ```
 */
export function useFormattedLastSync(options: UseLastSyncTimeOptions = {}): string {
  const timeSince = useTimeSinceLastSync(options);

  return useMemo(() => {
    if (timeSince === null) {
      return 'Never synced';
    }

    if (timeSince < 5000) {
      return 'Just now';
    }

    if (timeSince < 60000) {
      const seconds = Math.floor(timeSince / 1000);
      return `${seconds}s ago`;
    }

    if (timeSince < 3600000) {
      const minutes = Math.floor(timeSince / 60000);
      return `${minutes}m ago`;
    }

    if (timeSince < 86400000) {
      const hours = Math.floor(timeSince / 3600000);
      return `${hours}h ago`;
    }

    const days = Math.floor(timeSince / 86400000);
    return `${days}d ago`;
  }, [timeSince]);
}

/**
 * Hook to check if sync is stale (hasn't synced in a while).
 *
 * @param threshold - Threshold in milliseconds (default: 5 minutes)
 * @returns true if sync is stale
 *
 * @example
 * ```tsx
 * function StaleWarning() {
 *   const isStale = useSyncIsStale(5 * 60 * 1000); // 5 minutes
 *
 *   if (!isStale) return null;
 *
 *   return (
 *     <div className="warning">
 *       Data may be outdated. Tap to sync.
 *     </div>
 *   );
 * }
 * ```
 */
export function useSyncIsStale(threshold = 5 * 60 * 1000): boolean {
  const timeSince = useTimeSinceLastSync();

  return useMemo(() => {
    if (timeSince === null) {
      return true;
    }
    return timeSince > threshold;
  }, [timeSince, threshold]);
}

// ============================================================================
// Action Hooks
// ============================================================================

/**
 * Hook to get sync action functions with loading/error states.
 *
 * @returns Sync actions with state
 *
 * @example
 * ```tsx
 * function SyncControls() {
 *   const { sync, pause, resume, isSyncing, isPending, error } = useSyncActions();
 *
 *   return (
 *     <div>
 *       <button onClick={() => sync()} disabled={isPending}>
 *         {isSyncing ? 'Syncing...' : 'Sync Now'}
 *       </button>
 *       <button onClick={pause}>Pause</button>
 *       <button onClick={resume}>Resume</button>
 *       {error && <span className="error">{error.message}</span>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useSyncActions(): SyncActionsHookResult {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const isSyncing = useIsSyncing();

  const sync = useCallback(async (options?: TriggerSyncOptions) => {
    setIsPending(true);
    setError(null);
    try {
      await triggerSync(options);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Sync failed'));
      throw err;
    } finally {
      setIsPending(false);
    }
  }, []);

  const pause = useCallback(async () => {
    setIsPending(true);
    setError(null);
    try {
      await pauseSync();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to pause sync'));
      throw err;
    } finally {
      setIsPending(false);
    }
  }, []);

  const resume = useCallback(async () => {
    setIsPending(true);
    setError(null);
    try {
      await resumeSync();
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to resume sync'));
      throw err;
    } finally {
      setIsPending(false);
    }
  }, []);

  return {
    sync,
    pause,
    resume,
    isSyncing,
    isPending,
    error,
  };
}

// ============================================================================
// Collection Hooks
// ============================================================================

/**
 * Hook to get sync stats for a specific collection.
 *
 * @param collectionName - Name of the collection
 * @returns Collection sync stats
 *
 * @example
 * ```tsx
 * function CollectionSyncInfo({ collection }: { collection: CollectionName }) {
 *   const stats = useCollectionSyncStats(collection);
 *
 *   return (
 *     <div>
 *       <span>{collection}</span>
 *       <span>Pushed: {stats.docsPushed}</span>
 *       <span>Pulled: {stats.docsPulled}</span>
 *       {stats.error && <span className="error">{stats.error.message}</span>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useCollectionSyncStats(
  collectionName: CollectionName
): CollectionSyncStats {
  const { state } = useSyncState({
    eventTypes: ['collection-sync', 'sync-complete', 'sync-error'],
  });

  return state.collections[collectionName];
}

// ============================================================================
// Error Hook
// ============================================================================

/**
 * Hook to get the last sync error.
 *
 * @returns Last sync error info, or null if no error
 *
 * @example
 * ```tsx
 * function SyncErrorDisplay() {
 *   const error = useSyncError();
 *   const { sync } = useSyncActions();
 *
 *   if (!error) return null;
 *
 *   return (
 *     <div className="sync-error">
 *       <span>{error.message}</span>
 *       {error.recoverable && (
 *         <button onClick={() => sync({ force: true })}>Retry</button>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function useSyncError(): SyncErrorInfo | null {
  const [error, setError] = useState<SyncErrorInfo | null>(() => getSyncState().lastError);

  useEffect(() => {
    // Get initial error
    setError(getSyncState().lastError);

    // Subscribe to error events
    const unsubscribe = subscribeSyncEvents((event) => {
      if (event.type === 'sync-error') {
        setError(event.error ?? null);
      } else if (event.type === 'sync-complete') {
        // Clear error on successful sync
        setError(null);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return error;
}

// ============================================================================
// Event Hook
// ============================================================================

/**
 * Hook to subscribe to specific sync events with a callback.
 *
 * @param eventTypes - Event types to listen for
 * @param callback - Callback function for events
 *
 * @example
 * ```tsx
 * function SyncNotifications() {
 *   const [message, setMessage] = useState('');
 *
 *   useSyncEvents(['sync-complete', 'sync-error'], (event) => {
 *     if (event.type === 'sync-complete') {
 *       setMessage('Sync completed successfully!');
 *     } else if (event.type === 'sync-error') {
 *       setMessage(`Sync error: ${event.error?.message}`);
 *     }
 *   });
 *
 *   return message ? <Toast>{message}</Toast> : null;
 * }
 * ```
 */
export function useSyncEvents(
  eventTypes: SyncEventType[],
  callback: (event: SyncEvent) => void
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const unsubscribe = subscribeSyncEvents((event) => {
      if (eventTypes.includes(event.type)) {
        callbackRef.current(event);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [eventTypes]);
}

// ============================================================================
// Combined Status Hook
// ============================================================================

/**
 * Combined hook for building sync status UI components.
 * Returns all commonly needed sync state in one call.
 *
 * @returns Combined sync status information
 *
 * @example
 * ```tsx
 * function SyncStatusBar() {
 *   const {
 *     status,
 *     isOnline,
 *     isSyncing,
 *     lastSyncText,
 *     error,
 *     sync,
 *   } = useSyncStatusUI();
 *
 *   return (
 *     <div className="sync-bar">
 *       <OnlineIndicator online={isOnline} />
 *       <span>{lastSyncText}</span>
 *       <button onClick={() => sync()} disabled={isSyncing}>
 *         {isSyncing ? <Spinner /> : 'Sync'}
 *       </button>
 *       {error && <ErrorIcon title={error.message} />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useSyncStatusUI() {
  const status = useSyncStatus();
  const isOnline = useIsOnline();
  const isSyncing = status === SyncStatus.Syncing || status === SyncStatus.Initializing;
  const lastSyncText = useFormattedLastSync();
  const error = useSyncError();
  const { sync, isPending } = useSyncActions();
  const isStale = useSyncIsStale();

  return {
    status,
    isOnline,
    isSyncing,
    isPending,
    lastSyncText,
    error,
    isStale,
    sync,
  };
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export { SyncStatus, type SyncState, type SyncEvent, type SyncErrorInfo, type CollectionName };
