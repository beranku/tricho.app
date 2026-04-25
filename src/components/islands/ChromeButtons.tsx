/**
 * Chrome buttons — React variant. Dispatches openSheet directly.
 *
 * variant 'a': Phone A (menu + ellipsis)
 * variant 'b': Phone B (back + ellipsis)
 */
import { openSheet } from '../../lib/store/sheet';

export interface ChromeButtonsProps {
  variant?: 'a' | 'b';
  backHref?: string;
}

export function ChromeButtons({ variant = 'a', backHref = '/' }: ChromeButtonsProps): JSX.Element {
  return (
    <div className="chrome-buttons">
      {variant === 'a' ? (
        <button
          type="button"
          className="chrome-glyph"
          aria-label="Otevřít menu"
          onClick={() => openSheet('menu', { triggerId: 'menu-btn' })}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <line x1="4" y1="8" x2="20" y2="8" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="16" x2="20" y2="16" />
          </svg>
        </button>
      ) : (
        <a className="chrome-glyph" href={backHref} aria-label="Zpět">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="14,6 8,12 14,18" />
          </svg>
        </a>
      )}
      <button
        type="button"
        className="chrome-glyph"
        aria-label="Další možnosti"
        onClick={() => openSheet('context', { triggerId: 'ellipsis-btn' })}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      <style>{`
        .chrome-buttons {
          position: absolute;
          top: 46px;
          left: 0;
          right: 0;
          min-height: 48px;
          padding: 6px 12px 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          z-index: var(--z-chrome-buttons);
          pointer-events: none;
        }
        .chrome-buttons > * {
          pointer-events: auto;
        }
        .chrome-glyph {
          width: 44px;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--ink-2);
          background: transparent;
          border: none;
          flex-shrink: 0;
          cursor: pointer;
          border-radius: var(--radius-btn);
          transition: background var(--t-hover);
          text-decoration: none;
        }
        .chrome-glyph:active {
          background: var(--surface-2);
        }
      `}</style>
    </div>
  );
}
