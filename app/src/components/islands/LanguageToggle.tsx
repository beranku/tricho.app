/**
 * Language toggle island. Cycles through registered locales on click and
 * persists the choice to `_local/locale`. Mirrors the visual language of
 * `ThemeToggle` (pill-shaped chip in the bottom-sheet menu).
 */
import { useStore } from '@nanostores/react';
import {
  LOCALES,
  LOCALE_LABELS,
  localeStore,
  setLocaleAndPersist,
  type Locale,
} from '../../i18n';
import { m } from '../../i18n';

function nextLocale(current: Locale): Locale {
  const idx = LOCALES.indexOf(current);
  return LOCALES[(idx + 1) % LOCALES.length];
}

export function LanguageToggle(): JSX.Element {
  const locale = useStore(localeStore);
  const next = nextLocale(locale);

  return (
    <button
      type="button"
      className="lang-toggle-btn"
      onClick={() => {
        void setLocaleAndPersist(next);
      }}
      aria-label={`${m.menu_language_label()}: ${LOCALE_LABELS[next]}`}
      data-language-toggle="true"
    >
      <span className="lang-toggle-glyph" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12 H21" />
          <path d="M12 3 C8 7 8 17 12 21" />
          <path d="M12 3 C16 7 16 17 12 21" />
        </svg>
      </span>
      <span className="lang-toggle-label">{LOCALE_LABELS[locale]}</span>
      <style>{`
        .lang-toggle-btn {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 9px 14px 9px 12px;
          border-radius: 999px;
          border: 1px solid var(--line);
          background: var(--surface);
          cursor: pointer;
          font-family: 'Geist', sans-serif;
          font-size: 12px;
          font-weight: 550;
          color: var(--ink-2);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          box-shadow: 0 1px 2px rgba(42, 35, 27, 0.04);
          transition: background var(--t-base), border-color var(--t-base), color var(--t-base);
        }
        .lang-toggle-btn:hover { border-color: var(--copper-border); }
        .lang-toggle-btn svg { color: var(--copper); }
      `}</style>
    </button>
  );
}
