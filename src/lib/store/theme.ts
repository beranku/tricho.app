/**
 * Theme preference — persisted in a `_local/theme` PouchDB doc.
 *
 * The `_local/` prefix guarantees the doc is never replicated to CouchDB
 * (see openspec/specs/local-database). Reading happens before vault unlock
 * via a small dedicated PouchDB instance (no DEK needed since the doc is
 * unencrypted plaintext — non-sensitive display preference).
 */
import { atom } from 'nanostores';

export type Theme = 'light' | 'dark';

export const themeStore = atom<Theme>('light');

const PREFS_DB_NAME = 'tricho_app_prefs';
const THEME_DOC_ID = '_local/theme';

interface ThemeDoc {
  _id: string;
  _rev?: string;
  theme: Theme;
  updatedAt: number;
}

let prefsDbPromise: Promise<unknown> | null = null;

/**
 * Test-only escape hatch. Tests destroy + recreate the prefs DB between cases;
 * without this they'd hold a stale handle to a destroyed instance.
 */
export function __resetThemeStoreForTests(): void {
  prefsDbPromise = null;
  themeStore.set('light');
  if (typeof document !== 'undefined') delete document.documentElement.dataset.theme;
}

async function getPrefsDb(): Promise<{ get: (id: string) => Promise<ThemeDoc>; put: (doc: ThemeDoc) => Promise<{ rev: string }> }> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    // SSR / Node test path — return a no-op handle.
    return {
      get: async () => { throw { status: 404 }; },
      put: async () => ({ rev: '1' }),
    } as never;
  }
  if (!prefsDbPromise) {
    prefsDbPromise = (async () => {
      const { default: PouchDB } = await import('pouchdb-browser');
      return new PouchDB(PREFS_DB_NAME);
    })();
  }
  return prefsDbPromise as Promise<{
    get: (id: string) => Promise<ThemeDoc>;
    put: (doc: ThemeDoc) => Promise<{ rev: string }>;
  }>;
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  if (theme === 'dark') {
    document.documentElement.dataset.theme = 'dark';
  } else {
    delete document.documentElement.dataset.theme;
  }
}

/** Read persisted theme; fall back to OS preference on first run. */
export async function bootstrapTheme(): Promise<void> {
  let resolved: Theme = 'light';
  try {
    const db = await getPrefsDb();
    const doc = await db.get(THEME_DOC_ID).catch(() => null);
    if (doc?.theme === 'dark' || doc?.theme === 'light') {
      resolved = doc.theme;
    } else if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      resolved = 'dark';
    }
  } catch {
    // fall back to light
  }
  themeStore.set(resolved);
  applyTheme(resolved);
}

/** Apply + persist a new theme. */
export async function setTheme(theme: Theme): Promise<void> {
  themeStore.set(theme);
  applyTheme(theme);
  try {
    const db = await getPrefsDb();
    const existing = await db.get(THEME_DOC_ID).catch(() => null);
    await db.put({
      _id: THEME_DOC_ID,
      _rev: existing?._rev,
      theme,
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.warn('[theme] persistence failed', err);
  }
}

/** Toggle helper for the ThemeToggle island. */
export async function toggleTheme(): Promise<void> {
  const next: Theme = themeStore.get() === 'dark' ? 'light' : 'dark';
  await setTheme(next);
}
