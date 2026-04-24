/**
 * In-memory PouchDB factory for tests that need the encrypted DB wrapper
 * but don't want real IndexedDB persistence between cases.
 */

import PouchDB from 'pouchdb-browser';
import PouchAdapterMemory from 'pouchdb-adapter-memory';
import { openVaultDb, putEncrypted, type VaultDb } from '../../db/pouch';
import type { VaultFixture } from './vault';

let pluginRegistered = false;
function ensurePlugin(): void {
  if (pluginRegistered) return;
  PouchDB.plugin(PouchAdapterMemory);
  pluginRegistered = true;
}

export async function inMemoryPouch(vault: VaultFixture): Promise<VaultDb> {
  ensurePlugin();
  return openVaultDb(vault.vaultId, vault.dek, { adapter: 'memory' });
}

export async function seedCustomer(
  db: VaultDb,
  overrides: Partial<{
    id: string;
    name: string;
    phone: string;
    email: string;
  }> = {},
): Promise<string> {
  const id = overrides.id ?? `customer:${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await putEncrypted(db, {
    _id: id,
    type: 'customer',
    updatedAt: Date.now(),
    deleted: false,
    data: {
      name: overrides.name ?? 'Test Customer',
      phone: overrides.phone ?? '+420123456789',
      email: overrides.email ?? 'test@example.com',
    },
  });
  return id;
}
