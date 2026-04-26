/**
 * Locale runtime — the only path components use to read or change the
 * active locale. Wraps Paraglide's `getLocale`/`setLocale` with:
 *
 *   - a nanostore for `@nanostores/react` subscribers to re-render on switch,
 *   - persistence to `_local/locale` (mirroring `_local/theme`), and
 *   - automatic `<html lang>` reflection.
 *
 * The Paraglide compiler is configured with strategy `['globalVariable',
 * 'baseLocale']` (see astro.config.mjs); we own the global variable.
 */
import { atom } from 'nanostores';
import {
  getLocale as paraglideGetLocale,
  setLocale as paraglideSetLocale,
} from '../paraglide/runtime.js';
import { DEFAULT_LOCALE, isLocale, resolveHostLocale, type Locale } from './config.ts';

export type { Locale } from './config.ts';

export const localeStore = atom<Locale>(DEFAULT_LOCALE);

const PREFS_DB_NAME = 'tricho_app_prefs';
const LOCALE_DOC_ID = '_local/locale';

interface LocaleDoc {
  _id: string;
  _rev?: string;
  locale: Locale;
  updatedAt: number;
}

let prefsDbPromise: Promise<{
  get: (id: string) => Promise<LocaleDoc>;
  put: (doc: LocaleDoc) => Promise<{ rev: string }>;
}> | null = null;

/**
 * Test-only escape hatch. Tests destroy + recreate the prefs DB between
 * cases; without this they'd hold a stale handle to a destroyed instance.
 */
export function __resetLocaleRuntimeForTests(): void {
  prefsDbPromise = null;
  bootstrapped = false;
  localeStore.set(DEFAULT_LOCALE);
  paraglideSetLocale(DEFAULT_LOCALE, { reload: false });
  if (typeof document !== 'undefined') {
    document.documentElement.removeAttribute('lang');
  }
}

async function getPrefsDb(): Promise<{
  get: (id: string) => Promise<LocaleDoc>;
  put: (doc: LocaleDoc) => Promise<{ rev: string }>;
}> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return {
      get: async () => {
        throw { status: 404 };
      },
      put: async () => ({ rev: '1' }),
    };
  }
  if (!prefsDbPromise) {
    prefsDbPromise = (async () => {
      const { default: PouchDB } = await import('pouchdb-browser');
      return new PouchDB(PREFS_DB_NAME);
    })();
  }
  return prefsDbPromise;
}

function applyLocaleToDom(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('lang', locale);
}

/** Synchronous read of the current locale. */
export function getLocale(): Locale {
  const current = paraglideGetLocale();
  return isLocale(current) ? current : DEFAULT_LOCALE;
}

/**
 * Switch the active locale in memory only (no persistence).
 * Notifies subscribers synchronously and updates `<html lang>`.
 */
export function setLocale(locale: Locale): void {
  paraglideSetLocale(locale, { reload: false });
  localeStore.set(locale);
  applyLocaleToDom(locale);
}

/**
 * Switch the active locale and write `_local/locale`. The in-memory
 * switch happens first so the UI updates immediately; a write failure
 * does NOT roll back the in-memory state (the user sees the locale
 * they picked; we log the persistence failure).
 */
export async function setLocaleAndPersist(locale: Locale): Promise<void> {
  setLocale(locale);
  try {
    const db = await getPrefsDb();
    const existing = await db.get(LOCALE_DOC_ID).catch(() => null);
    await db.put({
      _id: LOCALE_DOC_ID,
      _rev: existing?._rev,
      locale,
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.warn('[locale] persistence failed', err);
  }
}

/**
 * Initialize the runtime: read the persisted locale, fall back to
 * `navigator.language` (region-stripped) on first install, persist
 * the resolved locale so future boots skip the host-locale check.
 *
 * Idempotent — safe to call from multiple entry points (Layout, App
 * islands). Only the first call writes to PouchDB.
 */
let bootstrapped = false;
export async function bootstrapLocale(): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;

  let resolved: Locale = DEFAULT_LOCALE;
  let needsPersist = false;

  try {
    const db = await getPrefsDb();
    const doc = await db.get(LOCALE_DOC_ID).catch(() => null);
    if (doc && isLocale(doc.locale)) {
      resolved = doc.locale;
    } else {
      const fromHost =
        typeof navigator !== 'undefined' ? resolveHostLocale(navigator.language) : null;
      resolved = fromHost ?? DEFAULT_LOCALE;
      needsPersist = true;
    }
  } catch {
    /* keep DEFAULT_LOCALE */
  }

  setLocale(resolved);

  if (needsPersist) {
    try {
      const db = await getPrefsDb();
      await db.put({
        _id: LOCALE_DOC_ID,
        locale: resolved,
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.warn('[locale] initial persistence failed', err);
    }
  }
}
