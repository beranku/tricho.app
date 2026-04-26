import React, { useState } from 'react';
import { useStore } from '@nanostores/react';
import { localeStore, m } from '../i18n';

export interface GatedSheetProps {
  onRenew: () => void;
}

/**
 * Bottom sheet shown when sync flips to `gated` (subscription expired or
 * past grace). Non-blocking — the user can dismiss with "Pokračovat
 * offline" and continue working locally. Auto-reopens on next launch if
 * the gate is still active.
 */
export function GatedSheet({ onRenew }: GatedSheetProps): JSX.Element | null {
  useStore(localeStore);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="gated-sheet-title"
      data-testid="gated-sheet"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        background: 'rgba(255,255,255,0.98)',
        borderTop: '1px solid rgba(0,0,0,0.06)',
        boxShadow: '0 -8px 24px rgba(15,23,42,0.12)',
        padding: '20px 16px 28px',
      }}
    >
      <div style={{ maxWidth: 420, margin: '0 auto' }}>
        <h3
          id="gated-sheet-title"
          style={{
            margin: '0 0 6px',
            fontFamily: "'Fraunces', serif",
            fontSize: 18,
          }}
        >
          {m.gatedSheet_title()}
        </h3>
        <p
          style={{
            margin: '0 0 16px',
            color: '#555',
            fontSize: 14,
            lineHeight: 1.45,
          }}
        >
          {m.gatedSheet_body()}
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          <button
            type="button"
            onClick={onRenew}
            data-testid="gated-sheet-renew"
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: 'none',
              background: '#007aff',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 15,
              fontWeight: 500,
            }}
          >
            {m.gatedSheet_renew()}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            data-testid="gated-sheet-dismiss"
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              border: '1px solid rgba(0,0,0,0.1)',
              background: 'transparent',
              color: '#333',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {m.gatedSheet_continueOffline()}
          </button>
        </div>
      </div>
    </div>
  );
}
