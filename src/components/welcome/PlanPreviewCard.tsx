import React, { useState } from 'react';
import { useStore } from '@nanostores/react';
import { localeStore, m } from '../../i18n';

const DISMISSED_KEY = 'tricho-plan-preview-dismissed';

/**
 * Pre-OAuth plan-preview card. Read-only — the actual plan choice happens
 * after sign-in. Dismissible per-device via localStorage flag. Renders
 * directly above Step 1 in the welcome wizard.
 */
export function PlanPreviewCard(): JSX.Element | null {
  useStore(localeStore);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const onDismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // sandboxed iframe / disabled storage — non-fatal
    }
    setDismissed(true);
  };

  return (
    <aside
      className="plan-preview-card"
      data-testid="plan-preview-card"
      style={{
        margin: '12px 0 16px',
        padding: 16,
        borderRadius: 14,
        border: '1px solid rgba(186,108,52,0.18)',
        background: 'rgba(186,108,52,0.04)',
      }}
    >
      <p
        style={{
          margin: '0 0 12px',
          fontFamily: "'Fraunces', serif",
          fontSize: 15,
          color: 'var(--ink-1, rgb(59,48,39))',
        }}
      >
        {m.planPreview_heading()}
      </p>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'grid',
          gap: 6,
          fontSize: 13,
          color: 'var(--ink-2, rgb(85,85,85))',
        }}
      >
        <li>
          <strong>{m.planPreview_freeLabel()}</strong> — {m.planPreview_freeBlurb()}
        </li>
        <li>
          <strong>{m.planPreview_proLabel()}</strong> — {m.planPreview_proBlurb()}
        </li>
        <li>
          <strong>{m.planPreview_maxLabel()}</strong> — {m.planPreview_maxBlurb()}
        </li>
      </ul>
      <button
        type="button"
        className="btn btn--ghost"
        onClick={onDismiss}
        data-testid="plan-preview-dismiss"
        style={{
          marginTop: 10,
          color: 'var(--copper-mid, rgb(122,69,25))',
          fontSize: 12,
        }}
      >
        {m.planPreview_dismiss()}
      </button>
    </aside>
  );
}
