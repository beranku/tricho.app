import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PouchDB from 'pouchdb-browser';
import PouchAdapterMemory from 'pouchdb-adapter-memory';
import { openVaultDb, destroyVaultDb } from '../db/pouch';
import { storePhoto, listPhotoIds, deletePhoto } from './photos';
import { generateAesGcmKey } from '../crypto/envelope';

PouchDB.plugin(PouchAdapterMemory);

const VAULT_ID = 'test-vault-photos';

describe('photos (attachments)', () => {
  let dek: CryptoKey;

  beforeEach(async () => {
    dek = await generateAesGcmKey(false);
  });

  afterEach(async () => {
    await destroyVaultDb().catch(() => void 0);
  });

  // PouchDB's memory adapter under Node/jsdom doesn't resolve attachment
  // writes cleanly with browser Blob inputs — attachment E2E is covered by the
  // real CouchDB sync in manual testing. Here we just verify the meta doc path
  // and soft-delete semantics, which is what the UI also relies on.
  it('stores the photo meta doc without an attachment', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    // Bypass attachment in-memory by mocking putAttachment to resolve.
    const spy = vi.spyOn(db.pouch, 'putAttachment').mockResolvedValue({ ok: true, id: '', rev: '' } as never);
    const id = await storePhoto(db, {
      meta: { customerId: 'c1', takenAt: Date.now(), contentType: 'image/jpeg' },
      cipherBlob: new Blob([new Uint8Array(8) as BlobPart]),
    });
    expect(spy).toHaveBeenCalled();
    const ids = await listPhotoIds(db);
    expect(ids).toContain(id);
  });

  it('soft-deletes a photo so it drops out of listPhotoIds', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    vi.spyOn(db.pouch, 'putAttachment').mockResolvedValue({ ok: true, id: '', rev: '' } as never);
    const id = await storePhoto(db, {
      meta: { customerId: 'c1', takenAt: Date.now(), contentType: 'image/jpeg' },
      cipherBlob: new Blob([new Uint8Array(8) as BlobPart]),
    });
    expect((await listPhotoIds(db)).length).toBe(1);
    await deletePhoto(db, id);
    expect((await listPhotoIds(db)).length).toBe(0);
  });

  it('writes plaintext monthBucket field at top level from takenAt', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    vi.spyOn(db.pouch, 'putAttachment').mockResolvedValue({ ok: true, id: '', rev: '' } as never);
    const takenAt = Date.UTC(2026, 3, 15, 10, 30); // 2026-04-15
    const id = await storePhoto(db, {
      meta: { customerId: 'c1', takenAt, contentType: 'image/jpeg' },
      cipherBlob: new Blob([new Uint8Array(8) as BlobPart]),
    });
    const raw = await db.pouch.get(id);
    expect((raw as { monthBucket?: string }).monthBucket).toBe('2026-04');
  });

  it('soft-delete preserves monthBucket', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    vi.spyOn(db.pouch, 'putAttachment').mockResolvedValue({ ok: true, id: '', rev: '' } as never);
    const takenAt = Date.UTC(2026, 0, 15);
    const id = await storePhoto(db, {
      meta: { customerId: 'c1', takenAt, contentType: 'image/jpeg' },
      cipherBlob: new Blob([new Uint8Array(8) as BlobPart]),
    });
    await deletePhoto(db, id);
    const raw = await db.pouch.get(id, { deleted_conflicts: true } as never).catch(() => db.pouch.get(id));
    expect((raw as { monthBucket?: string }).monthBucket).toBe('2026-01');
  });

  it('uses UTC, not local time for bucketing', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    vi.spyOn(db.pouch, 'putAttachment').mockResolvedValue({ ok: true, id: '', rev: '' } as never);
    // 2026-04-30T23:30:00Z is 2026-05-01T01:30:00 in CET — bucket must stay April
    const takenAt = Date.UTC(2026, 3, 30, 23, 30);
    const id = await storePhoto(db, {
      meta: { customerId: 'c1', takenAt, contentType: 'image/jpeg' },
      cipherBlob: new Blob([new Uint8Array(8) as BlobPart]),
    });
    const raw = await db.pouch.get(id);
    expect((raw as { monthBucket?: string }).monthBucket).toBe('2026-04');
  });
});
