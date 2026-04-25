import React, { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { getSyncState, subscribeSyncEvents, type SyncState } from '../sync/couch';
import { localeStore, m } from '../i18n';

export interface SyncStatusProps {
  variant?: 'compact' | 'full';
  className?: string;
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

const statusColors: Record<SyncState['status'], string> = {
  idle: '#8e8e93',
  connecting: '#007aff',
  syncing: '#007aff',
  paused: '#34c759',
  error: '#ff3b30',
  gated: '#ff9500',
};

export function SyncStatus({ variant = 'compact', className }: SyncStatusProps): JSX.Element {
  useStore(localeStore);
  const [state, setState] = useState<SyncState>(getSyncState);
  useEffect(() => subscribeSyncEvents(setState), []);

  const label = statusLabel(state.status);
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
        {state.error && (
          <div style={{ display: 'flex', gap: 8, color: '#ff3b30' }}>
            <dt>{m.syncStatus_errorLabel()}</dt>
            <dd style={{ margin: 0 }}>{state.error}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
