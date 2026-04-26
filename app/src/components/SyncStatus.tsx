import React, { useCallback, useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import {
  getSyncState,
  startSync,
  subscribeSyncEvents,
  type SyncErrorClass,
  type SyncState,
} from '../sync/couch';
import { localeStore, m } from '../i18n';
import type { VaultDb } from '../db/pouch';

export interface SyncStatusProps {
  variant?: 'compact' | 'full';
  className?: string;
  /** Required to support the "Tap to retry" affordance. When omitted, the
   *  retry button is hidden — the status row is read-only. */
  db?: VaultDb;
  username?: string;
  fetchOverride?: typeof fetch;
}

function statusLabel(status: SyncState['status']): string {
  switch (status) {
    case 'idle': return m.syncStatus_idle();
    case 'connecting': return m.syncStatus_connecting();
    case 'syncing': return m.syncStatus_syncing();
    case 'paused': return m.syncStatus_paused();
    case 'error': return m.syncStatus_error();
    case 'gated': return m.syncStatus_gated();
  }
}

function humanisedErrorReason(errorClass: SyncErrorClass | null): string {
  switch (errorClass) {
    case 'network': return m.syncStatus_errorReason_network();
    case 'auth': return m.syncStatus_errorReason_auth();
    case 'vault-mismatch': return m.syncStatus_errorReason_vaultMismatch();
    case 'unknown':
    default:
      return m.syncStatus_errorReason_unknown();
  }
}

const statusColors: Record<SyncState['status'], string> = {
  idle: '#8e8e93',
  connecting: '#007aff',
  syncing: '#007aff',
  paused: '#34c759',
  error: '#ff3b30',
  gated: '#ff9500',
};

export function SyncStatus({
  variant = 'compact',
  className,
  db,
  username,
  fetchOverride,
}: SyncStatusProps): JSX.Element {
  useStore(localeStore);
  const [state, setState] = useState<SyncState>(getSyncState);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => subscribeSyncEvents(setState), []);

  const onRetry = useCallback(async () => {
    if (!db || !username) return;
    setRetrying(true);
    try {
      await startSync(db, { username, fetch: fetchOverride });
    } finally {
      setRetrying(false);
    }
  }, [db, username, fetchOverride]);

  const label = statusLabel(state.status);
  const color = statusColors[state.status];
  const isError = state.status === 'error';
  const reason = isError ? humanisedErrorReason(state.errorClass) : null;
  const canRetry = isError && Boolean(db && username);

  if (variant === 'compact') {
    return (
      <span
        className={className}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#333' }}
        data-testid="sync-status-compact"
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} aria-hidden />
        {label}
        {reason && <span style={{ color: '#ff3b30' }}>· {reason}</span>}
        {canRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            data-testid="sync-status-retry"
            style={{
              marginLeft: 4,
              padding: '2px 8px',
              borderRadius: 6,
              border: '1px solid rgba(255,59,48,0.4)',
              background: 'transparent',
              color: '#ff3b30',
              fontSize: 11,
              cursor: retrying ? 'not-allowed' : 'pointer',
              opacity: retrying ? 0.5 : 1,
            }}
          >
            {retrying ? m.syncStatus_retrying() : m.syncStatus_retry()}
          </button>
        )}
      </span>
    );
  }

  return (
    <div
      className={className}
      style={{ padding: 12, borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)', background: 'rgba(255,255,255,0.7)' }}
      data-testid="sync-status-full"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color }} aria-hidden />
        <strong>{label}</strong>
        {canRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            data-testid="sync-status-retry"
            style={{
              marginLeft: 'auto',
              padding: '4px 10px',
              borderRadius: 8,
              border: '1px solid rgba(255,59,48,0.4)',
              background: 'transparent',
              color: '#ff3b30',
              fontSize: 12,
              cursor: retrying ? 'not-allowed' : 'pointer',
              opacity: retrying ? 0.5 : 1,
            }}
          >
            {retrying ? m.syncStatus_retrying() : m.syncStatus_retry()}
          </button>
        )}
      </div>
      <dl style={{ margin: '8px 0 0', fontSize: 13, color: '#555' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <dt>{m.syncStatus_userLabel()}</dt>
          <dd style={{ margin: 0 }}>{state.username ?? '—'}</dd>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <dt>{m.syncStatus_pushedLabel()}</dt>
          <dd style={{ margin: 0 }}>{state.pushed}</dd>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <dt>{m.syncStatus_pulledLabel()}</dt>
          <dd style={{ margin: 0 }}>{state.pulled}</dd>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <dt>{m.syncStatus_lastEventLabel()}</dt>
          <dd style={{ margin: 0 }}>
            {state.lastEventAt ? new Date(state.lastEventAt).toLocaleTimeString() : '—'}
          </dd>
        </div>
        {reason && (
          <div style={{ display: 'flex', gap: 8, color: '#ff3b30' }}>
            <dt>{m.syncStatus_errorLabel()}</dt>
            <dd style={{ margin: 0 }}>{reason}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
