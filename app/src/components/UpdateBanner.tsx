import type { JSX } from 'react';
import { useStore } from '@nanostores/react';
import { swUpdate$, applyUpdate } from '../lib/sw-update';
import { m } from '../i18n';

// Non-modal "Nová verze připravena — restartovat" banner. Mounted from
// AppShell only when view === 'unlocked' (per app-release-versioning spec —
// pre-unlock surfaces never show the update banner).

export function UpdateBanner(): JSX.Element | null {
  const state = useStore(swUpdate$);
  if (!state.waiting) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="sw-update-banner"
      style={{
        position: 'fixed',
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 60,
        margin: '0 auto',
        maxWidth: 480,
        padding: '12px 16px',
        borderRadius: 12,
        background: 'var(--copper-tint, rgba(176,110,82,0.08))',
        border: '1px solid var(--copper-border, rgba(176,110,82,0.32))',
        color: 'var(--ink, #1c1917)',
        boxShadow: 'var(--card-shadow, 0 4px 12px rgba(0,0,0,0.06))',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 14,
      }}
    >
      <span style={{ flex: 1 }}>{m.update_banner_title()}</span>
      <button
        type="button"
        onClick={() => { void applyUpdate(); }}
        data-testid="sw-update-banner-action"
        style={{
          background: 'var(--ink-espresso, #2A231B)',
          color: 'var(--bg, #FDFAF3)',
          border: 'none',
          borderRadius: 8,
          padding: '8px 14px',
          fontSize: 14,
          fontWeight: 500,
          cursor: 'pointer',
          minHeight: 36,
        }}
      >
        {m.update_banner_action()}
      </button>
    </div>
  );
}
