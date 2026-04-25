import { useTheme } from './hooks/useTheme';

/**
 * Dark mode toggle switch pro bottom sheet.
 * Synchronizuje se s persistentním theme state (localStorage + nanostore).
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-pressed={isDark}
        aria-label="Přepnout tmavý režim"
        className="theme-switch"
        onClick={toggle}
      >
        <span className="theme-switch-thumb" />
      </button>

      <style>{`
        .theme-switch {
          width: 44px;
          height: 26px;
          background: var(--surface-2);
          border: 1px solid var(--line);
          border-radius: 13px;
          position: relative;
          cursor: pointer;
          padding: 0;
          transition: background var(--t-std);
        }
        .theme-switch[aria-pressed="true"] {
          background: var(--teal);
          border-color: var(--teal);
        }
        .theme-switch-thumb {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 20px;
          height: 20px;
          background: var(--surface);
          border-radius: 50%;
          transition: transform var(--t-std);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
        }
        .theme-switch[aria-pressed="true"] .theme-switch-thumb {
          transform: translateX(18px);
        }
      `}</style>
    </>
  );
}
