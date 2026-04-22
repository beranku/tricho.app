/**
 * Tests for KeyStore IndexedDB module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  openKeyStoreDb,
  closeKeyStoreDb,
  deleteKeyStoreDb,
  createVaultState,
  getVaultState,
  getVaultStateByUserId,
  getVaultStateByCredentialId,
  updateVaultState,
  deleteVaultState,
  listVaultStates,
  hasVaultForUser,
  updateWrappedDekPrf,
  updateWrappedDekRs,
  updateDualWrappedDek,
  hasDualWrappedDek,
  getDualWrappedDek,
  createWrappedKeyData,
  updateCredentialId,
  confirmRecoverySecret,
  recordUnlock,
  clearAllVaultStates,
  createDefaultMetadata,
  generateVaultId,
  type VaultState,
  type WrappedKeyData,
  type DualWrapParams,
} from './keystore';

/**
 * Creates a mock VaultState for testing
 */
function createMockVaultState(overrides?: Partial<VaultState>): VaultState {
  const vaultId = generateVaultId();
  return {
    vaultId,
    deviceSalt: 'mock-device-salt-base64url',
    wrappedDekPrf: null,
    wrappedDekRs: null,
    credentialId: null,
    userId: 'test-user-123',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    rsConfirmed: false,
    metadata: createDefaultMetadata(),
    ...overrides,
  };
}

/**
 * Creates a mock WrappedKeyData for testing
 */
function createMockWrappedKey(overrides?: Partial<WrappedKeyData>): WrappedKeyData {
  return {
    ct: 'mock-ciphertext-base64url',
    iv: 'mock-iv-base64url',
    alg: 'AES-256-GCM',
    version: 1,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('KeyStore', () => {
  beforeEach(async () => {
    // Clean up before each test
    await deleteKeyStoreDb();
  });

  afterEach(async () => {
    // Clean up after each test
    await closeKeyStoreDb();
  });

  describe('Database Operations', () => {
    it('should open the database successfully', async () => {
      const db = await openKeyStoreDb();
      expect(db).not.toBeNull();
      expect(db?.name).toBe('tricho_keystore');
    });

    it('should return the same database instance on multiple opens', async () => {
      const db1 = await openKeyStoreDb();
      const db2 = await openKeyStoreDb();
      expect(db1).toBe(db2);
    });

    it('should close the database successfully', async () => {
      await openKeyStoreDb();
      await closeKeyStoreDb();
      // Opening again should create a new connection
      const db = await openKeyStoreDb();
      expect(db).not.toBeNull();
    });

    it('should delete the database successfully', async () => {
      await openKeyStoreDb();
      await deleteKeyStoreDb();
      // Should be able to recreate
      const db = await openKeyStoreDb();
      expect(db).not.toBeNull();
    });
  });

  describe('Vault State CRUD', () => {
    it('should create a new vault state', async () => {
      const vault = createMockVaultState();
      await createVaultState(vault);

      const retrieved = await getVaultState(vault.vaultId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.vaultId).toBe(vault.vaultId);
      expect(retrieved?.userId).toBe(vault.userId);
    });

    it('should reject duplicate vault IDs', async () => {
      const vault = createMockVaultState();
      await createVaultState(vault);

      await expect(createVaultState(vault)).rejects.toThrow('already exists');
    });

    it('should retrieve vault state by vault ID', async () => {
      const vault = createMockVaultState();
      await createVaultState(vault);

      const retrieved = await getVaultState(vault.vaultId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.vaultId).toBe(vault.vaultId);
    });

    it('should return null for non-existent vault ID', async () => {
      const retrieved = await getVaultState('non-existent-id');
      expect(retrieved).toBeNull();
    });

    it('should retrieve vault state by user ID', async () => {
      const vault = createMockVaultState({ userId: 'unique-user-id' });
      await createVaultState(vault);

      const retrieved = await getVaultStateByUserId('unique-user-id');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.userId).toBe('unique-user-id');
    });

    it('should return null for non-existent user ID', async () => {
      const retrieved = await getVaultStateByUserId('non-existent-user');
      expect(retrieved).toBeNull();
    });

    it('should retrieve vault state by credential ID', async () => {
      const vault = createMockVaultState({ credentialId: 'test-credential-123' });
      await createVaultState(vault);

      const retrieved = await getVaultStateByCredentialId('test-credential-123');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.credentialId).toBe('test-credential-123');
    });

    it('should update vault state', async () => {
      const vault = createMockVaultState();
      await createVaultState(vault);

      await updateVaultState(vault.vaultId, { rsConfirmed: true });

      const retrieved = await getVaultState(vault.vaultId);
      expect(retrieved?.rsConfirmed).toBe(true);
      // updatedAt should be at least the original time (can be equal if test runs fast)
      expect(retrieved?.updatedAt).toBeGreaterThanOrEqual(vault.updatedAt);
    });

    it('should reject update for non-existent vault', async () => {
      await expect(updateVaultState('non-existent', { rsConfirmed: true })).rejects.toThrow(
        'not found'
      );
    });

    it('should delete vault state', async () => {
      const vault = createMockVaultState();
      await createVaultState(vault);

      await deleteVaultState(vault.vaultId);

      const retrieved = await getVaultState(vault.vaultId);
      expect(retrieved).toBeNull();
    });

    it('should list all vault states', async () => {
      const vault1 = createMockVaultState({ userId: 'user-1' });
      const vault2 = createMockVaultState({ userId: 'user-2' });
      await createVaultState(vault1);
      await createVaultState(vault2);

      const vaults = await listVaultStates();
      expect(vaults).toHaveLength(2);
    });

    it('should check if vault exists for user', async () => {
      const vault = createMockVaultState({ userId: 'check-user' });
      await createVaultState(vault);

      expect(await hasVaultForUser('check-user')).toBe(true);
      expect(await hasVaultForUser('other-user')).toBe(false);
    });

    it('should clear all vault states', async () => {
      await createVaultState(createMockVaultState({ userId: 'user-1' }));
      await createVaultState(createMockVaultState({ userId: 'user-2' }));

      await clearAllVaultStates();

      const vaults = await listVaultStates();
      expect(vaults).toHaveLength(0);
    });
  });

  describe('Wrapped DEK Operations', () => {
    it('should update wrapped DEK for PRF', async () => {
      const vault = createMockVaultState();
      await createVaultState(vault);

      const wrappedKey = createMockWrappedKey();
      await updateWrappedDekPrf(vault.vaultId, wrappedKey);

      const retrieved = await getVaultState(vault.vaultId);
      expect(retrieved?.wrappedDekPrf).not.toBeNull();
      expect(retrieved?.wrappedDekPrf?.ct).toBe(wrappedKey.ct);
      expect(retrieved?.wrappedDekPrf?.alg).toBe('AES-256-GCM');
    });

    it('should update wrapped DEK for RS', async () => {
      const vault = createMockVaultState();
      await createVaultState(vault);

      const wrappedKey = createMockWrappedKey();
      await updateWrappedDekRs(vault.vaultId, wrappedKey);

      const retrieved = await getVaultState(vault.vaultId);
      expect(retrieved?.wrappedDekRs).not.toBeNull();
      expect(retrieved?.wrappedDekRs?.ct).toBe(wrappedKey.ct);
    });

    it('should support dual DEK wrapping', async () => {
      const vault = createMockVaultState();
      await createVaultState(vault);

      const prfWrapped = createMockWrappedKey({ ct: 'prf-ciphertext' });
      const rsWrapped = createMockWrappedKey({ ct: 'rs-ciphertext' });

      await updateWrappedDekPrf(vault.vaultId, prfWrapped);
      await updateWrappedDekRs(vault.vaultId, rsWrapped);

      const retrieved = await getVaultState(vault.vaultId);
      expect(retrieved?.wrappedDekPrf?.ct).toBe('prf-ciphertext');
      expect(retrieved?.wrappedDekRs?.ct).toBe('rs-ciphertext');
    });

    it('should update dual wrapped DEK atomically', async () => {
      const vault = createMockVaultState();
      await createVaultState(vault);

      const prfWrapped = createMockWrappedKey({ ct: 'prf-ct-atomic' });
      const rsWrapped = createMockWrappedKey({ ct: 'rs-ct-atomic' });

      await updateDualWrappedDek(vault.vaultId, {
        wrappedDekPrf: prfWrapped,
        wrappedDekRs: rsWrapped,
      });

      const retrieved = await getVaultState(vault.vaultId);
      expect(retrieved?.wrappedDekPrf?.ct).toBe('prf-ct-atomic');
      expect(retrieved?.wrappedDekRs?.ct).toBe('rs-ct-atomic');
      expect(retrieved?.wrappedDekPrf?.alg).toBe('AES-256-GCM');
      expect(retrieved?.wrappedDekRs?.alg).toBe('AES-256-GCM');
    });

    it('should reject dual wrap with invalid PRF wrapped key', async () => {
      const vault = createMockVaultState();
      await createVaultState(vault);

      const invalidPrf = { ct: '', iv: 'valid-iv', alg: 'AES-256-GCM' as const, version: 1, createdAt: Date.now() };
      const validRs = createMockWrappedKey();

      await expect(
        updateDualWrappedDek(vault.vaultId, {
          wrappedDekPrf: invalidPrf,
          wrappedDekRs: validRs,
        })
      ).rejects.toThrow('Invalid PRF wrapped key');
    });

    it('should reject dual wrap with invalid RS wrapped key', async () => {
      const vault = createMockVaultState();
      await createVaultState(vault);

      const validPrf = createMockWrappedKey();
      const invalidRs = { ct: 'valid', iv: '', alg: 'AES-256-GCM' as const, version: 1, createdAt: Date.now() };

      await expect(
        updateDualWrappedDek(vault.vaultId, {
          wrappedDekPrf: validPrf,
          wrappedDekRs: invalidRs,
        })
      ).rejects.toThrow('Invalid RS wrapped key');
    });

    it('should reject dual wrap with unsupported algorithm', async () => {
      const vault = createMockVaultState();
      await createVaultState(vault);

      const invalidAlgKey = { ct: 'ct', iv: 'iv', alg: 'AES-128-GCM' as 'AES-256-GCM', version: 1, createdAt: Date.now() };
      const validRs = createMockWrappedKey();

      await expect(
        updateDualWrappedDek(vault.vaultId, {
          wrappedDekPrf: invalidAlgKey,
          wrappedDekRs: validRs,
        })
      ).rejects.toThrow('unsupported algorithm');
    });

    it('should check if dual wrapped DEK is complete', async () => {
      const vault = createMockVaultState();
      await createVaultState(vault);

      // Initially, no wrapped DEKs
      expect(await hasDualWrappedDek(vault.vaultId)).toBe(false);

      // Add only PRF wrap
      await updateWrappedDekPrf(vault.vaultId, createMockWrappedKey());
      expect(await hasDualWrappedDek(vault.vaultId)).toBe(false);

      // Add RS wrap to complete dual wrapping
      await updateWrappedDekRs(vault.vaultId, createMockWrappedKey());
      expect(await hasDualWrappedDek(vault.vaultId)).toBe(true);
    });

    it('should return false for hasDualWrappedDek on non-existent vault', async () => {
      expect(await hasDualWrappedDek('non-existent')).toBe(false);
    });

    it('should get dual wrapped DEK when complete', async () => {
      const vault = createMockVaultState();
      await createVaultState(vault);

      const prfWrapped = createMockWrappedKey({ ct: 'prf-get-test' });
      const rsWrapped = createMockWrappedKey({ ct: 'rs-get-test' });

      await updateDualWrappedDek(vault.vaultId, {
        wrappedDekPrf: prfWrapped,
        wrappedDekRs: rsWrapped,
      });

      const dualWrap = await getDualWrappedDek(vault.vaultId);
      expect(dualWrap).not.toBeNull();
      expect(dualWrap?.wrappedDekPrf.ct).toBe('prf-get-test');
      expect(dualWrap?.wrappedDekRs.ct).toBe('rs-get-test');
    });

    it('should return null for getDualWrappedDek when incomplete', async () => {
      const vault = createMockVaultState();
      await createVaultState(vault);

      // Only PRF wrap present
      await updateWrappedDekPrf(vault.vaultId, createMockWrappedKey());

      const dualWrap = await getDualWrappedDek(vault.vaultId);
      expect(dualWrap).toBeNull();
    });

    it('should return null for getDualWrappedDek on non-existent vault', async () => {
      const dualWrap = await getDualWrappedDek('non-existent');
      expect(dualWrap).toBeNull();
    });

    it('should create wrapped key data with proper metadata', () => {
      const beforeCreate = Date.now();
      const wrappedKey = createWrappedKeyData('test-ct', 'test-iv');
      const afterCreate = Date.now();

      expect(wrappedKey.ct).toBe('test-ct');
      expect(wrappedKey.iv).toBe('test-iv');
      expect(wrappedKey.alg).toBe('AES-256-GCM');
      expect(wrappedKey.version).toBe(1);
      expect(wrappedKey.createdAt).toBeGreaterThanOrEqual(beforeCreate);
      expect(wrappedKey.createdAt).toBeLessThanOrEqual(afterCreate);
    });

    it('should create wrapped key data with custom version', () => {
      const wrappedKey = createWrappedKeyData('test-ct', 'test-iv', 2);
      expect(wrappedKey.version).toBe(2);
    });
  });

  describe('Credential Operations', () => {
    it('should update credential ID', async () => {
      const vault = createMockVaultState();
      await createVaultState(vault);

      await updateCredentialId(vault.vaultId, 'new-credential-id');

      const retrieved = await getVaultState(vault.vaultId);
      expect(retrieved?.credentialId).toBe('new-credential-id');
    });
  });

  describe('Recovery Secret Operations', () => {
    it('should confirm recovery secret', async () => {
      const vault = createMockVaultState({ rsConfirmed: false });
      await createVaultState(vault);

      await confirmRecoverySecret(vault.vaultId);

      const retrieved = await getVaultState(vault.vaultId);
      expect(retrieved?.rsConfirmed).toBe(true);
    });
  });

  describe('Unlock Tracking', () => {
    it('should record PRF unlock', async () => {
      const vault = createMockVaultState();
      await createVaultState(vault);

      await recordUnlock(vault.vaultId, 'prf');

      const retrieved = await getVaultState(vault.vaultId);
      expect(retrieved?.metadata.lastUnlockMethod).toBe('prf');
      expect(retrieved?.metadata.lastUnlockedAt).not.toBeNull();
    });

    it('should record RS unlock', async () => {
      const vault = createMockVaultState();
      await createVaultState(vault);

      await recordUnlock(vault.vaultId, 'rs');

      const retrieved = await getVaultState(vault.vaultId);
      expect(retrieved?.metadata.lastUnlockMethod).toBe('rs');
    });

    it('should reject unlock recording for non-existent vault', async () => {
      await expect(recordUnlock('non-existent', 'prf')).rejects.toThrow('not found');
    });
  });

  describe('Utility Functions', () => {
    it('should generate unique vault IDs', () => {
      const id1 = generateVaultId();
      const id2 = generateVaultId();
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
      expect(id1.length).toBeGreaterThan(0);
    });

    it('should create default metadata', () => {
      const metadata = createDefaultMetadata();
      expect(metadata.lastUnlockedAt).toBeNull();
      expect(metadata.lastUnlockMethod).toBeNull();
      expect(typeof metadata.userAgent).toBe('string');
      expect(typeof metadata.platform).toBe('string');
    });
  });

  describe('KeyStore Isolation', () => {
    it('should use separate database name from RxDB', async () => {
      const db = await openKeyStoreDb();
      // tricho_keystore should be separate from the main trichoapp RxDB
      expect(db?.name).toBe('tricho_keystore');
      expect(db?.name).not.toBe('trichoapp');
    });

    it('should have vault_state object store', async () => {
      const db = await openKeyStoreDb();
      expect(db?.objectStoreNames.contains('vault_state')).toBe(true);
    });
  });
});
