/**
 * Locale-aware sync status row, embedded inside the bottom sheet.
 * Subscribes to subscribeSyncEvents from src/sync/couch and to the locale
 * store so labels update on language switch.
 */
import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { subscribeSyncEvents, type SyncState } from '../../sync/couch';
import { localeStore, m } from '../../i18n';

function statusLabel(status: SyncState['status']): string {
  switch (status) {
    case 'idle': return m.sync_idle();
    case 'connecting': return m.sync_connecting();
    case 'syncing': return m.sync_status_syncing();
    case 'paused': return m.sync_done();
    case 'error': return m.sync_status_error();
    case 'gated': return m.plan_renewalRequiredTitle();
  }
}

export function SyncStatusRow(): JSX.Element {
  useStore(localeStore);
  const [state, setState] = useState<SyncState | null>(null);

  useEffect(() => {
    return subscribeSyncEvents((s) => setState({ ...s }));
  }, []);

  const status = state?.status ?? 'idle';
  const label = statusLabel(status);
  const dotColour = {
    idle: 'var(--ink-4)',
    connecting: 'var(--copper)',
    syncing: 'var(--teal)',
    paused: 'var(--teal)',
    error: 'var(--amber)',
    gated: 'var(--amber)',
  }[status];

  return (
    <div className="sheet-sync">
      <span className="sheet-sync-dot" style={{ background: dotColour }} aria-hidden="true" />
      <span>{label}</span>
      <style>{`
        .sheet-sync {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 22px 14px;
          font-family: 'Geist', sans-serif;
          font-size: 10px;
          font-weight: 600;
          color: var(--ink-3);
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        .sheet-sync-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          box-shadow: 0 0 0 3px var(--teal-tint);
        }
      `}</style>
    </div>
  );
}
