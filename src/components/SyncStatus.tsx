import React, { useEffect, useState } from 'react';
import { getSyncState, subscribeSyncEvents, type SyncState } from '../sync/couch';

export interface SyncStatusProps {
  variant?: 'compact' | 'full';
  className?: string;
}

const statusLabels: Record<SyncState['status'], string> = {
  idle: 'Offline',
  connecting: 'Connecting…',
  syncing: 'Syncing',
  paused: 'Up to date',
  error: 'Sync error',
};

const statusColors: Record<SyncState['status'], string> = {
  idle: '#8e8e93',
  connecting: '#007aff',
  syncing: '#007aff',
  paused: '#34c759',
  error: '#ff3b30',
};

export function SyncStatus({ variant = 'compact', className }: SyncStatusProps): JSX.Element {
  const [state, setState] = useState<SyncState>(getSyncState);
  useEffect(() => subscribeSyncEvents(setState), []);

  const label = statusLabels[state.status];
  const color = statusColors[state.status];

  if (variant === 'compact') {
    return (
      <span
        className={className}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#333' }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} aria-hidden />
        {label}
        {state.error && <span style={{ color: '#ff3b30' }}>· {state.error}</span>}
      </span>
    );
  }

  return (
    <div
      className={className}
      style={{ padding: 12, borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)', background: 'rgba(255,255,255,0.7)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color }} aria-hidden />
        <strong>{label}</strong>
      </div>
      <dl style={{ margin: '8px 0 0', fontSize: 13, color: '#555' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <dt>user</dt>
          <dd style={{ margin: 0 }}>{state.username ?? '—'}</dd>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <dt>pushed</dt>
          <dd style={{ margin: 0 }}>{state.pushed}</dd>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <dt>pulled</dt>
          <dd style={{ margin: 0 }}>{state.pulled}</dd>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <dt>last event</dt>
          <dd style={{ margin: 0 }}>
            {state.lastEventAt ? new Date(state.lastEventAt).toLocaleTimeString() : '—'}
          </dd>
        </div>
        {state.error && (
          <div style={{ display: 'flex', gap: 8, color: '#ff3b30' }}>
            <dt>error</dt>
            <dd style={{ margin: 0 }}>{state.error}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
