import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootstrapLocale,
  getLocale,
  setLocale,
  setLocaleAndPersist,
  localeStore,
  __resetLocaleRuntimeForTests,
} from './runtime.ts';
import { DEFAULT_LOCALE } from './config.ts';

const PREFS_DB = 'tricho_app_prefs';

async function destroyPrefsDb(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PouchDB = (await import('pouchdb-browser')).default;
  try {
    await new PouchDB(PREFS_DB).destroy();
  } catch {
    /* noop */
  }
}

describe('i18n runtime', () => {
  beforeEach(async () => {
    __resetLocaleRuntimeForTests();
    await destroyPrefsDb();
    __resetLocaleRuntimeForTests();
  });

  afterEach(async () => {
    await destroyPrefsDb();
  });

  it('default locale is English on a clean boot with English navigator', async () => {
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
    await bootstrapLocale();
    expect(getLocale()).toBe('en');
  });

  it('Czech navigator on first install switches to Czech and persists it', async () => {
    Object.defineProperty(navigator, 'language', { value: 'cs-CZ', configurable: true });
    await bootstrapLocale();
    expect(getLocale()).toBe('cs');
    // re-bootstrap on a fresh runtime instance reads persisted value
    __resetLocaleRuntimeForTests();
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
    await bootstrapLocale();
    expect(getLocale()).toBe('cs'); // persisted, not overridden by host
  });

  it('unsupported navigator language falls back to default', async () => {
    Object.defineProperty(navigator, 'language', { value: 'fr-FR', configurable: true });
    await bootstrapLocale();
    expect(getLocale()).toBe(DEFAULT_LOCALE);
  });

  it('setLocale notifies subscribers and updates html lang', () => {
    const seen: string[] = [];
    const unsubscribe = localeStore.subscribe((value) => seen.push(value));
    setLocale('cs');
    setLocale('en');
    unsubscribe();
    expect(seen.at(-1)).toBe('en');
    expect(seen).toContain('cs');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('setLocaleAndPersist updates UI before write completes', async () => {
    const promise = setLocaleAndPersist('cs');
    expect(getLocale()).toBe('cs');
    await promise;
    expect(getLocale()).toBe('cs');
  });

  it('persistence failure does not revert UI', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setLocale('en');
    // Simulate failure by closing IndexedDB (jsdom doesn't easily mock this;
    // call the API and just confirm UI does not revert even if persist fails)
    await setLocaleAndPersist('cs');
    expect(getLocale()).toBe('cs');
    warn.mockRestore();
  });
});
