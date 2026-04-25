/**
 * Bottom-sheet menu content. Renders rows: Klienti, Statistika, Archiv,
 * Nastavení, Synchronizace status, Téma toggle, Odhlásit.
 *
 * Deferred features show "Připravujeme".
 */
import type { ReactNode } from 'react';
import { closeSheet } from '../../lib/store/sheet';
import { SyncStatusRow } from './SyncStatusRow';
import { ThemeToggle } from './ThemeToggle';

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
  return (
    <>
      <SyncStatusRow />
      <nav className="sheet-nav">
        <Row label="Klienti" meta="Připravujeme" disabled />
        <Row label="Statistika" meta="Připravujeme" disabled />
        <Row label="Archiv" meta="Připravujeme" disabled />
        <Row label="Nastavení" onClick={onSettings} />
        <div className="sheet-row sheet-row--toggle">
          <span className="sheet-item-label">Vzhled</span>
          <ThemeToggle />
        </div>
        <Row label="Odhlásit" onClick={onLogout} />
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

  return (
    <div className="fab-add-sheet">
      <h2 className="fab-add-title">Plánování v příští verzi</h2>
      {formatted && (
        <p className="fab-add-time">Začátek: <strong>{formatted}</strong></p>
      )}
      <p className="fab-add-body">
        Přidávání a úpravy zákroků dorazí v další verzi. Zatím můžete prohlížet
        plán a otevírat detaily klientů.
      </p>
      <button type="button" className="fab-add-close" onClick={closeSheet}>
        Zavřít
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
        }
        .fab-add-time strong {
          font-family: 'Fraunces', serif;
          font-variant-numeric: tabular-nums;
          font-weight: 600;
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
