import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import PouchDB from 'pouchdb-browser';
import PouchAdapterMemory from 'pouchdb-adapter-memory';
import { openVaultDb, destroyVaultDb } from '../db/pouch';
import { uploadVaultState, downloadVaultState, VAULT_STATE_DOC_ID } from './couch-vault-state';
import { generateAesGcmKey } from '../crypto/envelope';
import { createWrappedKeyData } from '../db/keystore';

PouchDB.plugin(PouchAdapterMemory);

const VAULT_ID = 'test-vault-state';

describe('vault-state doc', () => {
  let dek: CryptoKey;

  beforeEach(async () => {
    dek = await generateAesGcmKey(false);
  });

  afterEach(async () => {
    await destroyVaultDb().catch(() => void 0);
  });

  it('round-trips vault state through the per-user DB', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    const wrapped = createWrappedKeyData('ciphertext-b64', 'iv-b64', 1);
    await uploadVaultState(db, { deviceSalt: 'salt-b64', wrappedDekRs: wrapped, version: 1 });
    const downloaded = await downloadVaultState(db);
    expect(downloaded?._id).toBe(VAULT_STATE_DOC_ID);
    expect(downloaded?.deviceSalt).toBe('salt-b64');
    expect(downloaded?.wrappedDekRs.ct).toBe('ciphertext-b64');
    expect(downloaded?.version).toBe(1);
  });

  it('overwrites via _rev on subsequent uploads', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    const w1 = createWrappedKeyData('c1', 'i1', 1);
    const w2 = createWrappedKeyData('c2', 'i2', 2);
    await uploadVaultState(db, { deviceSalt: 's', wrappedDekRs: w1, version: 1 });
    await uploadVaultState(db, { deviceSalt: 's', wrappedDekRs: w2, version: 2 });
    const current = await downloadVaultState(db);
    expect(current?.version).toBe(2);
    expect(current?.wrappedDekRs.ct).toBe('c2');
  });

  it('returns null when no vault-state doc exists', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    expect(await downloadVaultState(db)).toBeNull();
  });
});
