/**
 * Czech-formatted sync status row, suitable for embedding inside the bottom
 * sheet. Subscribes to subscribeSyncEvents from src/sync/couch.
 */
import { useEffect, useState } from 'react';
import { subscribeSyncEvents, type SyncState } from '../../sync/couch';

const LABELS: Record<SyncState['status'], string> = {
  idle: 'Připraveno',
  connecting: 'Připojuji…',
  syncing: 'Synchronizuji…',
  paused: 'Synchronizováno',
  error: 'Chyba synchronizace',
};

export function SyncStatusRow(): JSX.Element {
  const [state, setState] = useState<SyncState | null>(null);

  useEffect(() => {
    return subscribeSyncEvents((s) => setState({ ...s }));
  }, []);

  const status = state?.status ?? 'idle';
  const label = LABELS[status];
  const dotColour = {
    idle: 'var(--ink-4)',
    connecting: 'var(--copper)',
    syncing: 'var(--teal)',
    paused: 'var(--teal)',
    error: 'var(--amber)',
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
