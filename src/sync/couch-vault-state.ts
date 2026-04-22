/**
 * Multi-device DEK sharing via a well-known doc in the per-user DB.
 *
 * The doc `_id = 'vault-state'` holds `{ deviceSalt, wrappedDekRs, version }`.
 * Both fields are already protected (wrapped_dek_rs is opaque ciphertext; the
 * salt is per-vault random). It replicates through the same PouchDB sync as
 * the rest of the user's data — no separate RPC.
 *
 * Device 1 (primary): uploads the doc on `enableSync`.
 * Device 2 (secondary): reads the doc, prompts the user for RS, unwraps the
 * shared DEK locally, then continues sync with the same DEK.
 */

import type { VaultDb } from '../db/pouch';
import type { WrappedKeyData } from '../db/keystore';

export const VAULT_STATE_DOC_ID = 'vault-state';

export interface VaultStateDoc {
  _id: typeof VAULT_STATE_DOC_ID;
  _rev?: string;
  type: 'vault-state';
  updatedAt: number;
  deviceSalt: string;
  wrappedDekRs: WrappedKeyData;
  version: number;
}

export async function uploadVaultState(
  db: VaultDb,
  payload: { deviceSalt: string; wrappedDekRs: WrappedKeyData; version: number },
): Promise<void> {
  // Cast through unknown: the vault-state doc shares the same DB as encrypted
  // docs but has a different shape (no `payload` field — wrappedDekRs is
  // already opaque ciphertext produced by envelopeEncrypt).
  const existing = await (db.pouch as unknown as PouchDB.Database<VaultStateDoc>)
    .get(VAULT_STATE_DOC_ID)
    .catch(() => null);
  const doc: VaultStateDoc = {
    _id: VAULT_STATE_DOC_ID,
    ...(existing?._rev ? { _rev: existing._rev } : {}),
    type: 'vault-state',
    updatedAt: Date.now(),
    deviceSalt: payload.deviceSalt,
    wrappedDekRs: payload.wrappedDekRs,
    version: payload.version,
  };
  await (db.pouch as unknown as PouchDB.Database<VaultStateDoc>).put(doc);
}

export async function downloadVaultState(db: VaultDb): Promise<VaultStateDoc | null> {
  try {
    return await (db.pouch as unknown as PouchDB.Database<VaultStateDoc>).get(VAULT_STATE_DOC_ID);
  } catch (err) {
    if ((err as { status?: number } | null)?.status === 404) return null;
    throw err;
  }
}
