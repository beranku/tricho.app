import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PouchDB from 'pouchdb-browser';
import PouchAdapterMemory from 'pouchdb-adapter-memory';
import { openVaultDb, destroyVaultDb, putEncrypted, DOC_TYPES } from '../db/pouch';
import { generateAesGcmKey } from '../crypto/envelope';
import { storePhoto } from '../sync/photos';
import { generateLocalBackupZip } from './local-zip';
import { restoreFromZipBytes } from './local-zip-restore';
import { unpackBackupZip } from './zip-pack';

PouchDB.plugin(PouchAdapterMemory);

const VAULT_ID = 'test-vault-local-zip';
const SECRET_NAME = 'PavlinaUnique';
const SECRET_NOTE = 'AlergieMartinaPlus';

describe('local-zip round-trip', () => {
  let dek: CryptoKey;

  beforeEach(async () => {
    dek = await generateAesGcmKey(false);
  });

  afterEach(async () => {
    await destroyVaultDb().catch(() => void 0);
  });

  it('packs a customer + photo, ZIP contains no plaintext leakage', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    vi.spyOn(db.pouch, 'putAttachment').mockResolvedValue({ ok: true, id: '', rev: '' } as never);

    await putEncrypted(db, {
      _id: 'customer:1',
      type: DOC_TYPES.CUSTOMER,
      updatedAt: Date.UTC(2026, 3, 5),
      deleted: false,
      data: { firstName: SECRET_NAME, lastName: 'Doe', notes: SECRET_NOTE, createdAt: 0 },
    });
    const aprilPhoto = await storePhoto(db, {
      meta: { customerId: 'customer:1', takenAt: Date.UTC(2026, 3, 10), contentType: 'image/jpeg' },
      cipherBlob: new Blob([new Uint8Array(8) as BlobPart]),
    });
    const mayPhoto = await storePhoto(db, {
      meta: { customerId: 'customer:1', takenAt: Date.UTC(2026, 4, 12), contentType: 'image/jpeg' },
      cipherBlob: new Blob([new Uint8Array(8) as BlobPart]),
    });

    const result = await generateLocalBackupZip({ db, vaultId: VAULT_ID, monthKey: '2026-04' });
    expect(result.manifest.docCount).toBe(1);
    expect(result.manifest.photoCount).toBe(1);
    // Filename is human-friendly.
    expect(result.filename).toBe('2026-04.tricho-backup.zip');

    // assertNoPlaintextLeak — neither customer name nor notes appear in ZIP bytes.
    const text = Buffer.from(result.bytes).toString('utf8');
    expect(text).not.toContain(SECRET_NAME);
    expect(text).not.toContain(SECRET_NOTE);

    // assertCiphertextOnly — every doc row has AEAD-shaped payload.
    const unpacked = await unpackBackupZip(result.bytes);
    for (const row of [...unpacked.docRows, ...unpacked.photoRows]) {
      expect(row.payload).toBeTruthy();
      expect(typeof row.payload.ct).toBe('string');
      expect(typeof row.payload.iv).toBe('string');
      expect(row.payload.ct.length).toBeGreaterThan(0);
    }
    // Photo from the May bucket is excluded.
    expect(unpacked.photoRows.find((p) => p._id === mayPhoto)).toBeUndefined();
    expect(unpacked.photoRows.find((p) => p._id === aprilPhoto)).toBeDefined();
  });

  it('rejects malformed monthKey', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    await expect(
      generateLocalBackupZip({ db, vaultId: VAULT_ID, monthKey: 'invalid' }),
    ).rejects.toThrow();
  });

  it('round-trip: pack → restore into fresh DB applies docs', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    vi.spyOn(db.pouch, 'putAttachment').mockResolvedValue({ ok: true, id: '', rev: '' } as never);

    await putEncrypted(db, {
      _id: 'customer:1',
      type: DOC_TYPES.CUSTOMER,
      updatedAt: 100,
      deleted: false,
      data: { firstName: 'Test', lastName: 'User', createdAt: 0 },
    });
    const result = await generateLocalBackupZip({ db, vaultId: VAULT_ID, monthKey: '2026-04' });
    await destroyVaultDb();

    // Open a fresh vault DB, restore from ZIP without a DEK touch (bytes-as-is).
    const fresh = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    vi.spyOn(fresh.pouch, 'putAttachment').mockResolvedValue({ ok: true, id: '', rev: '' } as never);
    const report = await restoreFromZipBytes({ db: fresh, bytes: result.bytes, expectedVaultId: VAULT_ID });
    expect(report.appliedDocs).toBe(1);

    const restored = await fresh.pouch.get('customer:1');
    expect((restored as { type?: string }).type).toBe(DOC_TYPES.CUSTOMER);
  });

  it('newest-wins: local doc with higher updatedAt is preserved', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    vi.spyOn(db.pouch, 'putAttachment').mockResolvedValue({ ok: true, id: '', rev: '' } as never);
    // First write (older, will be backup version)
    await putEncrypted(db, {
      _id: 'customer:1',
      type: DOC_TYPES.CUSTOMER,
      updatedAt: 100,
      deleted: false,
      data: { firstName: 'Old', lastName: 'Backup', createdAt: 0 },
    });
    const result = await generateLocalBackupZip({ db, vaultId: VAULT_ID, monthKey: '2026-04' });

    // Now overwrite locally with a NEWER updatedAt
    const existing = await db.pouch.get('customer:1');
    await putEncrypted(db, {
      _id: 'customer:1',
      _rev: (existing as { _rev: string })._rev,
      type: DOC_TYPES.CUSTOMER,
      updatedAt: 9999,
      deleted: false,
      data: { firstName: 'New', lastName: 'Local', createdAt: 0 },
    });

    const report = await restoreFromZipBytes({ db, bytes: result.bytes });
    expect(report.skippedNewerLocal).toBe(1);
    expect(report.appliedDocs).toBe(0);

    const after = await db.pouch.get('customer:1');
    expect((after as { updatedAt: number }).updatedAt).toBe(9999);
  });

  it('vaultId mismatch throws', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    vi.spyOn(db.pouch, 'putAttachment').mockResolvedValue({ ok: true, id: '', rev: '' } as never);
    await putEncrypted(db, {
      _id: 'customer:1',
      type: DOC_TYPES.CUSTOMER,
      updatedAt: 100,
      deleted: false,
      data: { firstName: 'A', lastName: 'B', createdAt: 0 },
    });
    const result = await generateLocalBackupZip({ db, vaultId: VAULT_ID, monthKey: '2026-04' });
    await expect(
      restoreFromZipBytes({ db, bytes: result.bytes, expectedVaultId: 'other-vault' }),
    ).rejects.toMatchObject({ name: 'VaultIdMismatchError' });
  });
});
