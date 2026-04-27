import { atom } from 'nanostores';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'tricho:theme';

/** Current theme — reactive store */
export const theme = atom<Theme>('light');

/** Read from localStorage on client side. Must be called from effect. */
export function loadTheme(): void {
  if (typeof window === 'undefined') return;
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored === 'light' || stored === 'dark') {
    theme.set(stored);
    applyTheme(stored);
  } else {
    // Respect system preference on first visit
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initial: Theme = prefersDark ? 'dark' : 'light';
    theme.set(initial);
    applyTheme(initial);
  }
}

/** Toggle light ↔ dark */
export function toggleTheme(): void {
  const next: Theme = theme.get() === 'dark' ? 'light' : 'dark';
  theme.set(next);
  applyTheme(next);
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, next);
  }
}

function applyTheme(t: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', t);
}
