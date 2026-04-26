import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import PouchDB from 'pouchdb-browser';
import PouchAdapterMemory from 'pouchdb-adapter-memory';
import {
  openVaultDb,
  closeVaultDb,
  destroyVaultDb,
  putEncrypted,
  getDecrypted,
  queryDecrypted,
  softDelete,
  watchChanges,
  DOC_TYPES,
} from './pouch';
import { generateAesGcmKey } from '../crypto/envelope';
import { generateDocId, type CustomerData } from './types';

PouchDB.plugin(PouchAdapterMemory);

const VAULT_ID = 'test-vault';

describe('pouch module', () => {
  let dek: CryptoKey;

  beforeEach(async () => {
    dek = await generateAesGcmKey(false);
  });

  afterEach(async () => {
    await destroyVaultDb().catch(() => void 0);
  });

  it('opens a vault DB', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    expect(db.vaultId).toBe(VAULT_ID);
    expect(db.dbName).toContain('tricho_');
  });

  it('encrypts on put and decrypts on get', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    const id = generateDocId(DOC_TYPES.CUSTOMER);
    const data: CustomerData = { firstName: 'Ada', lastName: 'Lovelace', createdAt: Date.now() };
    await putEncrypted<CustomerData>(db, {
      _id: id,
      type: DOC_TYPES.CUSTOMER,
      updatedAt: Date.now(),
      deleted: false,
      data,
    });
    const row = await db.pouch.get(id);
    // Server-visible payload must not contain plaintext.
    expect(JSON.stringify(row.payload)).not.toContain('Ada');
    expect(JSON.stringify(row.payload)).not.toContain('Lovelace');
    const decrypted = await getDecrypted<CustomerData>(db, id);
    expect(decrypted?.data.firstName).toBe('Ada');
    expect(decrypted?.data.lastName).toBe('Lovelace');
  });

  it('queryDecrypted returns non-deleted docs sorted by updatedAt desc', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    for (let i = 0; i < 3; i++) {
      await putEncrypted<CustomerData>(db, {
        _id: generateDocId(DOC_TYPES.CUSTOMER),
        type: DOC_TYPES.CUSTOMER,
        updatedAt: 1_000_000 + i,
        deleted: false,
        data: { firstName: `A${i}`, lastName: 'X', createdAt: 0 },
      });
    }
    const rows = await queryDecrypted<CustomerData>(db, DOC_TYPES.CUSTOMER);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.data.firstName)).toEqual(['A2', 'A1', 'A0']);
  });

  it('softDelete marks a doc as deleted and excludes it from queries', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    const id = generateDocId(DOC_TYPES.CUSTOMER);
    await putEncrypted<CustomerData>(db, {
      _id: id,
      type: DOC_TYPES.CUSTOMER,
      updatedAt: Date.now(),
      deleted: false,
      data: { firstName: 'Gone', lastName: 'Soon', createdAt: 0 },
    });
    await softDelete(db, id);
    const rows = await queryDecrypted<CustomerData>(db, DOC_TYPES.CUSTOMER);
    expect(rows).toHaveLength(0);

    const includingDeleted = await queryDecrypted<CustomerData>(db, DOC_TYPES.CUSTOMER, { includeDeleted: true });
    expect(includingDeleted).toHaveLength(1);
    expect(includingDeleted[0].deleted).toBe(true);
  });

  it('watchChanges fires on put', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    const received: string[] = [];
    const handle = watchChanges(db, ({ id }) => received.push(id));
    const id = generateDocId(DOC_TYPES.CUSTOMER);
    await putEncrypted<CustomerData>(db, {
      _id: id,
      type: DOC_TYPES.CUSTOMER,
      updatedAt: Date.now(),
      deleted: false,
      data: { firstName: 'Live', lastName: 'Feed', createdAt: 0 },
    });
    await new Promise((r) => setTimeout(r, 50));
    handle.cancel();
    expect(received).toContain(id);
  });

  it('decryption fails with a wrong DEK (AAD bound to doc id)', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    const id = generateDocId(DOC_TYPES.CUSTOMER);
    await putEncrypted<CustomerData>(db, {
      _id: id,
      type: DOC_TYPES.CUSTOMER,
      updatedAt: Date.now(),
      deleted: false,
      data: { firstName: 'Top', lastName: 'Secret', createdAt: 0 },
    });
    // Close and reopen with a different key — should fail to decrypt.
    await closeVaultDb();
    const otherDek = await generateAesGcmKey(false);
    const db2 = await openVaultDb(VAULT_ID, otherDek, { adapter: 'memory' });
    await expect(getDecrypted<CustomerData>(db2, id)).rejects.toThrow();
  });
});
