import { useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { theme, toggleTheme, loadTheme, type Theme } from '../../../lib/store/theme';

/**
 * React-side theme hook. Subscribes to nanostore, triggers initial load
 * on mount (reads localStorage + applies data-theme attribute).
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const current = useStore(theme);

  useEffect(() => {
    loadTheme();
  }, []);

  return { theme: current, toggle: toggleTheme };
}
