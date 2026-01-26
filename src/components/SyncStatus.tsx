/**
 * SyncStatus React Component
 *
 * A comprehensive sync status component that displays:
 * - Online/offline status
 * - Current sync state (idle, syncing, error, etc.)
 * - Last sync time
 * - Sync error messages
 * - Manual sync button
 *
 * This component is designed for iOS PWA users who need explicit
 * sync controls since Background Sync is not supported.
 *
 * @module components/SyncStatus
 *
 * @example
 * ```tsx
 * import { SyncStatus } from '@/components/SyncStatus';
 *
 * // In your settings page:
 * <SyncStatus />
 *
 * // Or with custom styling:
 * <SyncStatus
 *   variant="compact"
 *   showDetails={false}
 *   className="my-custom-class"
 * />
 * ```
 */

import React, { useCallback, useState } from 'react';
import {
  useSyncStatusUI,
  useSyncState,
  SyncStatus as SyncStatusEnum,
} from '../sync/hooks';

// ============================================================================
// Types
// ============================================================================

/**
 * Display variant for the component
 */
export type SyncStatusVariant = 'full' | 'compact' | 'minimal';

/**
 * Props for SyncStatus component
 */
export interface SyncStatusProps {
  /** Display variant (default: 'full') */
  variant?: SyncStatusVariant;
  /** Whether to show detailed sync information (default: true for 'full' variant) */
  showDetails?: boolean;
  /** Whether to show the sync button (default: true) */
  showSyncButton?: boolean;
  /** Whether to show error details (default: true) */
  showErrors?: boolean;
  /** Custom class name for styling */
  className?: string;
  /** Callback when sync is triggered */
  onSyncStart?: () => void;
  /** Callback when sync completes */
  onSyncComplete?: () => void;
  /** Callback when sync fails */
  onSyncError?: (error: Error) => void;
}

// ============================================================================
// Status Helpers
// ============================================================================

/**
 * Get status display text
 */
function getStatusText(status: SyncStatusEnum, isOnline: boolean): string {
  if (!isOnline) {
    return 'Offline';
  }

  switch (status) {
    case SyncStatusEnum.Idle:
      return 'Ready';
    case SyncStatusEnum.Initializing:
      return 'Connecting...';
    case SyncStatusEnum.Syncing:
      return 'Syncing...';
    case SyncStatusEnum.Active:
      return 'Up to date';
    case SyncStatusEnum.Paused:
      return 'Paused';
    case SyncStatusEnum.Error:
      return 'Sync error';
    case SyncStatusEnum.Stopped:
      return 'Stopped';
    default:
      return 'Unknown';
  }
}

/**
 * Get status badge color class
 */
function getStatusColorClass(status: SyncStatusEnum, isOnline: boolean): string {
  if (!isOnline) {
    return 'sync-status--offline';
  }

  switch (status) {
    case SyncStatusEnum.Active:
      return 'sync-status--success';
    case SyncStatusEnum.Syncing:
    case SyncStatusEnum.Initializing:
      return 'sync-status--syncing';
    case SyncStatusEnum.Error:
      return 'sync-status--error';
    case SyncStatusEnum.Paused:
      return 'sync-status--paused';
    default:
      return 'sync-status--idle';
  }
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Online indicator dot
 */
function OnlineIndicator({ isOnline }: { isOnline: boolean }) {
  return (
    <div
      className={`sync-online-indicator ${isOnline ? 'sync-online-indicator--online' : 'sync-online-indicator--offline'}`}
      title={isOnline ? 'Online' : 'Offline'}
      aria-label={isOnline ? 'Device is online' : 'Device is offline'}
    />
  );
}

/**
 * Sync spinner animation
 */
function SyncSpinner() {
  return (
    <div className="sync-spinner" aria-hidden="true">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="sync-spinner-icon"
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
    </div>
  );
}

/**
 * Sync button
 */
function SyncButton({
  onClick,
  disabled,
  isSyncing,
}: {
  onClick: () => void;
  disabled: boolean;
  isSyncing: boolean;
}) {
  return (
    <button
      type="button"
      className={`sync-button ${isSyncing ? 'sync-button--syncing' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={isSyncing ? 'Sync in progress' : 'Sync now'}
    >
      {isSyncing ? (
        <>
          <SyncSpinner />
          <span>Syncing...</span>
        </>
      ) : (
        <>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="sync-button-icon"
            aria-hidden="true"
          >
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
          </svg>
          <span>Sync Now</span>
        </>
      )}
    </button>
  );
}

/**
 * Error display
 */
function SyncErrorDisplay({
  message,
  recoverable,
  onRetry,
}: {
  message: string;
  recoverable: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="sync-error" role="alert">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="sync-error-icon"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span className="sync-error-message">{message}</span>
      {recoverable && onRetry && (
        <button
          type="button"
          className="sync-error-retry"
          onClick={onRetry}
          aria-label="Retry sync"
        >
          Retry
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Sync status component with various display variants.
 *
 * Displays online/offline status, sync state, last sync time,
 * and provides a manual sync button for iOS PWA users.
 */
export function SyncStatus({
  variant = 'full',
  showDetails,
  showSyncButton = true,
  showErrors = true,
  className = '',
  onSyncStart,
  onSyncComplete,
  onSyncError,
}: SyncStatusProps) {
  // Determine showDetails based on variant if not explicitly set
  const shouldShowDetails = showDetails ?? variant === 'full';

  // Get sync state from hooks
  const {
    status,
    isOnline,
    isSyncing,
    isPending,
    lastSyncText,
    error,
    sync,
  } = useSyncStatusUI();

  const { totalDocsPushed, totalDocsPulled } = useSyncState();

  // Local state for feedback
  const [syncResult, setSyncResult] = useState<'success' | 'error' | null>(null);

  // Handle sync button click
  const handleSync = useCallback(async () => {
    if (!isOnline || isSyncing || isPending) {
      return;
    }

    onSyncStart?.();
    setSyncResult(null);

    try {
      await sync({ force: true });
      setSyncResult('success');
      onSyncComplete?.();

      // Clear success message after 2 seconds
      setTimeout(() => setSyncResult(null), 2000);
    } catch (err) {
      setSyncResult('error');
      onSyncError?.(err instanceof Error ? err : new Error('Sync failed'));
    }
  }, [isOnline, isSyncing, isPending, sync, onSyncStart, onSyncComplete, onSyncError]);

  // Handle retry
  const handleRetry = useCallback(() => {
    handleSync();
  }, [handleSync]);

  // Get status classes
  const statusColorClass = getStatusColorClass(status, isOnline);
  const statusText = getStatusText(status, isOnline);

  // Build class names
  const containerClasses = [
    'sync-status',
    `sync-status--${variant}`,
    statusColorClass,
    className,
  ].filter(Boolean).join(' ');

  // Render minimal variant
  if (variant === 'minimal') {
    return (
      <div className={containerClasses}>
        <OnlineIndicator isOnline={isOnline} />
        {isSyncing && <SyncSpinner />}
      </div>
    );
  }

  // Render compact variant
  if (variant === 'compact') {
    return (
      <div className={containerClasses}>
        <div className="sync-status-header">
          <OnlineIndicator isOnline={isOnline} />
          <span className="sync-status-text">{statusText}</span>
          {isSyncing && <SyncSpinner />}
        </div>
        {showSyncButton && !isSyncing && isOnline && (
          <button
            type="button"
            className="sync-button sync-button--compact"
            onClick={handleSync}
            disabled={!isOnline || isSyncing || isPending}
            aria-label="Sync now"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  // Render full variant
  return (
    <div className={containerClasses} role="region" aria-label="Sync status">
      {/* Header with status badge */}
      <div className="sync-status-header">
        <div className="sync-status-badge">
          <OnlineIndicator isOnline={isOnline} />
          <span className="sync-status-text">{statusText}</span>
          {isSyncing && <SyncSpinner />}
        </div>
      </div>

      {/* Last sync time */}
      <div className="sync-status-time">
        <span className="sync-status-time-label">Last sync:</span>
        <span className="sync-status-time-value">{lastSyncText}</span>
      </div>

      {/* Sync details */}
      {shouldShowDetails && (
        <div className="sync-status-details">
          <div className="sync-status-stat">
            <span className="sync-status-stat-label">Uploaded:</span>
            <span className="sync-status-stat-value">{totalDocsPushed} docs</span>
          </div>
          <div className="sync-status-stat">
            <span className="sync-status-stat-label">Downloaded:</span>
            <span className="sync-status-stat-value">{totalDocsPulled} docs</span>
          </div>
        </div>
      )}

      {/* Sync success feedback */}
      {syncResult === 'success' && (
        <div className="sync-feedback sync-feedback--success" role="status">
          Sync completed successfully!
        </div>
      )}

      {/* Error display */}
      {showErrors && error && (
        <SyncErrorDisplay
          message={error.message}
          recoverable={error.recoverable}
          onRetry={handleRetry}
        />
      )}

      {/* Sync button */}
      {showSyncButton && (
        <div className="sync-status-actions">
          <SyncButton
            onClick={handleSync}
            disabled={!isOnline || isPending}
            isSyncing={isSyncing}
          />
        </div>
      )}

      {/* Offline message */}
      {!isOnline && (
        <div className="sync-offline-message">
          Changes will sync automatically when you're back online.
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Convenience Components
// ============================================================================

/**
 * Simple online/offline indicator chip.
 * Use in headers or status bars.
 *
 * @example
 * ```tsx
 * <Header>
 *   <OnlineStatusChip />
 * </Header>
 * ```
 */
export function OnlineStatusChip({ className = '' }: { className?: string }) {
  const { isOnline } = useSyncStatusUI();

  return (
    <div className={`online-status-chip ${isOnline ? 'online-status-chip--online' : 'online-status-chip--offline'} ${className}`}>
      <OnlineIndicator isOnline={isOnline} />
      <span>{isOnline ? 'Online' : 'Offline'}</span>
    </div>
  );
}

/**
 * Minimal sync indicator for use in compact spaces.
 * Shows just an icon that changes based on sync state.
 *
 * @example
 * ```tsx
 * <NavBar>
 *   <SyncIndicator />
 * </NavBar>
 * ```
 */
export function SyncIndicator({ className = '' }: { className?: string }) {
  const { status, isOnline, isSyncing, error } = useSyncStatusUI();

  // Determine icon based on state
  let iconPath: string;
  let colorClass: string;

  if (!isOnline) {
    // Cloud with line through it
    iconPath = 'M22 8a10 10 0 0 0-20 0M2 8l20 14M9 17h6';
    colorClass = 'sync-indicator--offline';
  } else if (error) {
    // Exclamation
    iconPath = 'M12 8v4m0 4h.01';
    colorClass = 'sync-indicator--error';
  } else if (isSyncing) {
    // Sync arrows (will animate)
    iconPath = 'M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2';
    colorClass = 'sync-indicator--syncing';
  } else {
    // Cloud check
    iconPath = 'M9 12l2 2 4-4';
    colorClass = 'sync-indicator--ok';
  }

  return (
    <div
      className={`sync-indicator ${colorClass} ${className}`}
      title={getStatusText(status, isOnline)}
      aria-label={getStatusText(status, isOnline)}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isSyncing ? 'sync-indicator-icon--spinning' : ''}
      >
        <path d={iconPath} />
      </svg>
    </div>
  );
}

/**
 * Sync button without status display.
 * Use when you need just a button to trigger sync.
 *
 * @example
 * ```tsx
 * <ToolBar>
 *   <SyncNowButton />
 * </ToolBar>
 * ```
 */
export function SyncNowButton({ className = '' }: { className?: string }) {
  const { isOnline, isSyncing, isPending, sync } = useSyncStatusUI();

  const handleClick = useCallback(async () => {
    if (isOnline && !isSyncing && !isPending) {
      await sync({ force: true });
    }
  }, [isOnline, isSyncing, isPending, sync]);

  return (
    <button
      type="button"
      className={`sync-now-button ${isSyncing ? 'sync-now-button--syncing' : ''} ${className}`}
      onClick={handleClick}
      disabled={!isOnline || isPending}
      aria-label={isSyncing ? 'Sync in progress' : 'Sync now'}
    >
      {isSyncing ? (
        <SyncSpinner />
      ) : (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
        </svg>
      )}
    </button>
  );
}

// Default export
export default SyncStatus;
