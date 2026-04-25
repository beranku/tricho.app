/**
 * Bottom-sheet menu content. Renders rows for clients, statistics, archive,
 * settings, sync status, theme toggle, language toggle, sign-out.
 *
 * Strings come from `m.<key>()` (Paraglide) — never inline.
 */
import type { ReactNode } from 'react';
import { useStore } from '@nanostores/react';
import { closeSheet } from '../../lib/store/sheet';
import { localeStore, m } from '../../i18n';
import { SyncStatusRow } from './SyncStatusRow';
import { ThemeToggle } from './ThemeToggle';
import { LanguageToggle } from './LanguageToggle';

export interface MenuSheetProps {
  onSettings?: () => void;
  onLogout?: () => void;
}

interface RowProps {
  icon?: ReactNode;
  label: string;
  meta?: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}

function Row({ icon, label, meta, href, onClick, disabled }: RowProps): JSX.Element {
  const Tag = href ? 'a' : 'button';
  return (
    <Tag
      type={Tag === 'button' ? 'button' : undefined}
      href={href}
      className={`sheet-item ${disabled ? 'sheet-item--disabled' : ''}`}
      onClick={() => {
        if (disabled) return;
        onClick?.();
        if (href) closeSheet();
      }}
    >
      {icon && <span className="sheet-item-icon" aria-hidden="true">{icon}</span>}
      <span className="sheet-item-label">{label}</span>
      {meta && <span className="sheet-item-meta">{meta}</span>}
    </Tag>
  );
}

export function MenuSheet({ onSettings, onLogout }: MenuSheetProps): JSX.Element {
  // Subscribing to localeStore here makes the sheet re-render on language
  // switch, so every `m.<key>()` call returns the freshly-set locale.
  useStore(localeStore);

  return (
    <>
      <SyncStatusRow />
      <nav className="sheet-nav">
        <Row label={m.menu_clients()} meta={m.menu_clients_meta()} disabled />
        <Row label={m.menu_statistics()} meta={m.menu_clients_meta()} disabled />
        <Row label={m.menu_archive()} meta={m.menu_clients_meta()} disabled />
        <Row label={m.menu_settings()} onClick={onSettings} />
        <div className="sheet-row sheet-row--toggle">
          <span className="sheet-item-label">{m.menu_language_label()}</span>
          <LanguageToggle />
        </div>
        <div className="sheet-row sheet-row--toggle">
          <span className="sheet-item-label">{m.menu_theme_label()}</span>
          <ThemeToggle />
        </div>
        <Row label={m.menu_signOut()} onClick={onLogout} />
      </nav>
      <style>{`
        .sheet-nav {
          padding: 0 8px 6px;
          display: flex;
          flex-direction: column;
          gap: 0;
          position: relative;
          z-index: 2;
        }
        .sheet-item {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 13px 14px;
          border-radius: 12px;
          font-family: 'Fraunces', serif;
          font-variation-settings: 'opsz' 22;
          font-size: 17px;
          font-weight: 500;
          letter-spacing: -0.015em;
          color: var(--ink);
          cursor: pointer;
          background: transparent;
          border: none;
          text-align: left;
          width: 100%;
          transition: background var(--t-hover);
          text-decoration: none;
        }
        .sheet-item:hover, .sheet-item:active { background: var(--surface-2); }
        .sheet-item--disabled { color: var(--ink-3); cursor: default; }
        .sheet-item--disabled:hover { background: transparent; }
        .sheet-item-icon {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--ink-3);
          flex-shrink: 0;
        }
        .sheet-item-meta {
          margin-left: auto;
          font-family: 'Geist', sans-serif;
          font-size: 13px;
          font-weight: 500;
          color: var(--ink-3);
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.01em;
        }
        .sheet-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 13px 14px;
          font-family: 'Fraunces', serif;
          font-variation-settings: 'opsz' 22;
          font-size: 17px;
          font-weight: 500;
          color: var(--ink);
        }
      `}</style>
    </>
  );
}

export function FabAddSheet({ payload }: { payload?: { startAt?: number } }): JSX.Element {
  const startTime = payload?.startAt ? new Date(payload.startAt) : null;
  const formatted = startTime
    ? `${String(startTime.getHours()).padStart(2, '0')}:${String(startTime.getMinutes()).padStart(2, '0')}`
    : null;

  // Subscribe so the sheet re-renders with the active locale's strings.
  useStore(localeStore);

  return (
    <div className="fab-add-sheet">
      <h2 className="fab-add-title">{m.schedule_addAppointment()}</h2>
      {formatted && (
        <p className="fab-add-time">{formatted}</p>
      )}
      <p className="fab-add-body">{m.menu_promo_body()}</p>
      <button type="button" className="fab-add-close" onClick={closeSheet}>
        {m.common_close()}
      </button>
      <style>{`
        .fab-add-sheet {
          padding: 4px 22px 18px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          z-index: 2;
        }
        .fab-add-title {
          font-family: 'Fraunces', serif;
          font-variation-settings: 'opsz' 28;
          font-weight: 550;
          font-size: 22px;
          color: var(--ink);
          letter-spacing: -0.02em;
        }
        .fab-add-time {
          font-family: 'Geist', sans-serif;
          font-size: 14px;
          color: var(--ink-2);
          font-variant-numeric: tabular-nums;
        }
        .fab-add-body {
          font-family: 'Patrick Hand', cursive;
          font-size: 17px;
          color: var(--ink-3);
          line-height: 1.4;
        }
        .fab-add-close {
          align-self: flex-start;
          padding: 8px 16px;
          border-radius: 999px;
          background: var(--surface-2);
          border: 1px solid var(--line);
          color: var(--ink-2);
          font-family: 'Geist', sans-serif;
          font-size: 13px;
          font-weight: 550;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
