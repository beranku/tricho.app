import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PouchDB from 'pouchdb-browser';
import PouchAdapterMemory from 'pouchdb-adapter-memory';
import { openVaultDb, destroyVaultDb } from '../db/pouch';
import {
  uploadVaultState,
  downloadVaultState,
  fetchVaultStateOverHttp,
  VAULT_STATE_DOC_ID,
  type VaultStateDoc,
} from './couch-vault-state';
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
    await uploadVaultState(db, { vaultId: VAULT_ID, deviceSalt: 'salt-b64', wrappedDekRs: wrapped, version: 1 });
    const downloaded = await downloadVaultState(db);
    expect(downloaded?._id).toBe(VAULT_STATE_DOC_ID);
    expect(downloaded?.vaultId).toBe(VAULT_ID);
    expect(downloaded?.deviceSalt).toBe('salt-b64');
    expect(downloaded?.wrappedDekRs.ct).toBe('ciphertext-b64');
    expect(downloaded?.version).toBe(1);
  });

  it('overwrites via _rev on subsequent uploads', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    const w1 = createWrappedKeyData('c1', 'i1', 1);
    const w2 = createWrappedKeyData('c2', 'i2', 2);
    await uploadVaultState(db, { vaultId: VAULT_ID, deviceSalt: 's', wrappedDekRs: w1, version: 1 });
    await uploadVaultState(db, { vaultId: VAULT_ID, deviceSalt: 's', wrappedDekRs: w2, version: 2 });
    const current = await downloadVaultState(db);
    expect(current?.version).toBe(2);
    expect(current?.wrappedDekRs.ct).toBe('c2');
  });

  it('returns null when no vault-state doc exists', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    expect(await downloadVaultState(db)).toBeNull();
  });
});

describe('fetchVaultStateOverHttp', () => {
  const sampleDoc: VaultStateDoc = {
    _id: VAULT_STATE_DOC_ID,
    _rev: '1-abc',
    type: 'vault-state',
    updatedAt: 1700000000000,
    vaultId: 'vault-shared-001',
    deviceSalt: 'salt-b64',
    wrappedDekRs: createWrappedKeyData('ct-b64', 'iv-b64', 1),
    version: 1,
  };

  it('returns the parsed doc on HTTP 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(sampleDoc), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const got = await fetchVaultStateOverHttp('alice@example.com', 'jwt-test', fetchImpl as unknown as typeof fetch);
    expect(got?.deviceSalt).toBe('salt-b64');
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining(`/${VAULT_STATE_DOC_ID}`),
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer jwt-test' }) }),
    );
  });

  it('returns null on HTTP 404', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"error":"not_found"}', { status: 404 }));
    expect(await fetchVaultStateOverHttp('u', 'j', fetchImpl as unknown as typeof fetch)).toBeNull();
  });

  it('throws on HTTP 500', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('boom', { status: 500, statusText: 'Server Error' }));
    await expect(fetchVaultStateOverHttp('u', 'j', fetchImpl as unknown as typeof fetch)).rejects.toThrow(/HTTP 500/);
  });

  it('throws when the response is not a vault-state doc', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ _id: 'something-else' }), { status: 200 }),
    );
    await expect(fetchVaultStateOverHttp('u', 'j', fetchImpl as unknown as typeof fetch)).rejects.toThrow(/not a vault-state/);
  });

  it('throws when the response is missing vaultId', async () => {
    const { vaultId: _omit, ...withoutVaultId } = sampleDoc;
    void _omit;
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(withoutVaultId), { status: 200 }),
    );
    await expect(fetchVaultStateOverHttp('u', 'j', fetchImpl as unknown as typeof fetch)).rejects.toThrow(/not a vault-state/);
  });
});
