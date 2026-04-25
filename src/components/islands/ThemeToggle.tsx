/**
 * Theme toggle island. Subscribes to themeStore via @nanostores/react;
 * persists changes through setTheme (which writes _local/theme).
 */
import { useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { themeStore, toggleTheme, bootstrapTheme } from '../../lib/store/theme';
import { localeStore, m } from '../../i18n';

export function ThemeToggle(): JSX.Element {
  const theme = useStore(themeStore);
  useStore(localeStore); // re-render on locale switch so labels update

  useEffect(() => {
    void bootstrapTheme();
  }, []);

  const isDark = theme === 'dark';
  const label = isDark ? m.menu_theme_dark() : m.menu_theme_light();
  const oppositeLabel = isDark ? m.menu_theme_light() : m.menu_theme_dark();

  return (
    <button
      type="button"
      className="theme-toggle-btn"
      onClick={() => { void toggleTheme(); }}
      aria-label={`${m.menu_theme_label()}: ${oppositeLabel}`}
      data-theme-toggle="true"
    >
      <span className="sun-icon" aria-hidden="true" hidden={isDark}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3 V5" />
          <path d="M12 19 V21" />
          <path d="M3 12 H5" />
          <path d="M19 12 H21" />
          <path d="M5.6 5.6 L7 7" />
          <path d="M17 17 L18.4 18.4" />
          <path d="M5.6 18.4 L7 17" />
          <path d="M17 7 L18.4 5.6" />
        </svg>
      </span>
      <span className="moon-icon" aria-hidden="true" hidden={!isDark}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 14 A8 8 0 1 1 10 4 A6 6 0 0 0 20 14 Z" />
        </svg>
      </span>
      <span className="theme-toggle-label">{label}</span>
      <style>{`
        .theme-toggle-btn {
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
        .theme-toggle-btn:hover {
          border-color: var(--copper-border);
        }
        .theme-toggle-btn svg {
          color: var(--copper);
        }
      `}</style>
    </button>
  );
}
