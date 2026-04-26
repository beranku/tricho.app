/**
 * Theme persistence — `_local/theme` doc round-trip + non-replication contract.
 *
 * The theme nanostore writes a plaintext `_local/theme` doc to a dedicated
 * `tricho_app_prefs` PouchDB instance. Two contracts:
 *   1. The doc has shape `{ _id: '_local/theme', theme, updatedAt }` —
 *      no `payload` field (it's intentionally non-encrypted).
 *   2. Any doc with `_local/` id never replicates — see local-database spec.
 *      We assert that by checking the doc does NOT appear in the live
 *      changes feed without `since: 0` (matching how PouchDB excludes _local
 *      from outgoing replication).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PouchDB from 'pouchdb-browser';
import PouchAdapterMemory from 'pouchdb-adapter-memory';
import { setTheme, themeStore, bootstrapTheme, __resetThemeStoreForTests } from './theme';

PouchDB.plugin(PouchAdapterMemory);

describe('theme persistence (_local/theme)', () => {
  beforeEach(async () => {
    // Wipe per-test prefs DB residue and reset module-level singleton so the
    // next setTheme/bootstrapTheme call opens a fresh DB handle.
    const db = new PouchDB('tricho_app_prefs', {});
    await db.destroy().catch(() => void 0);
    __resetThemeStoreForTests();
  });

  afterEach(async () => {
    const db = new PouchDB('tricho_app_prefs', {});
    await db.destroy().catch(() => void 0);
  });

  it('setTheme writes a _local/theme doc with no payload field', async () => {
    await setTheme('dark');
    // Open the same DB and read the doc directly.
    const probe = new PouchDB('tricho_app_prefs', {});
    const doc = await probe.get('_local/theme');
    expect(doc).toMatchObject({
      _id: '_local/theme',
      theme: 'dark',
    });
    expect((doc as Record<string, unknown>).payload).toBeUndefined();
    await probe.close();
  });

  it('setTheme applies data-theme to <html>', async () => {
    await setTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    await setTheme('light');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('bootstrapTheme reads back the persisted value', async () => {
    await setTheme('dark');
    // Simulate cold-boot: drop the cached PouchDB handle but leave the DB on disk.
    themeStore.set('light');
    delete document.documentElement.dataset.theme;
    await bootstrapTheme();
    expect(themeStore.get()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('bootstrapTheme falls back to OS prefers-color-scheme when no doc exists', async () => {
    // Fake matchMedia to report dark.
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    try {
      await bootstrapTheme();
      expect(themeStore.get()).toBe('dark');
    } finally {
      window.matchMedia = original;
    }
  });

  it('_local/theme is not exported via replication selector', async () => {
    await setTheme('dark');
    const probe = new PouchDB('tricho_app_prefs', {});
    // PouchDB excludes `_local/` ids from `_changes` feeds when `live: false`
    // and `since: 0` is the conventional check; but most importantly, the
    // `_changes` feed never returns `_local/` ids unless explicitly asked.
    const changes = await probe.changes({ since: 0, include_docs: true });
    const ids = changes.results.map((r) => r.id);
    expect(ids).not.toContain('_local/theme');
    await probe.close();
  });
});
