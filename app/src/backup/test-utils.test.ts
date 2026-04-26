import { describe, expect, it } from 'vitest';
import { packBackupZip } from './zip-pack';
import { assertNoPlaintextLeak, assertCiphertextOnly } from './test-utils';

describe('assertNoPlaintextLeak', () => {
  it('passes when needle is absent', async () => {
    const { bytes } = await packBackupZip({
      manifest: { version: '1', vaultId: 'v', monthKey: '2026-04', generatedAt: 0, source: 'client' },
      vaultState: null,
      docRows: [
        { _id: 'customer:1', type: 'customer', updatedAt: 1, deleted: false, payload: { ct: 'X', iv: 'Y' } },
      ],
      photoRows: [],
      attachments: [],
    });
    expect(() => assertNoPlaintextLeak(bytes, ['SECRET-NAME'])).not.toThrow();
  });

  it('fails when needle is present', async () => {
    const { bytes } = await packBackupZip({
      manifest: { version: '1', vaultId: 'v', monthKey: '2026-04', generatedAt: 0, source: 'client' },
      vaultState: { _id: '_local/vault-state', vaultId: 'v', deviceSalt: 'SECRET-SALT' },
      docRows: [],
      photoRows: [],
      attachments: [],
    });
    expect(() => assertNoPlaintextLeak(bytes, ['SECRET-SALT'])).toThrow();
  });
});

describe('assertCiphertextOnly', () => {
  it('passes when all rows have AEAD payload', async () => {
    const { bytes } = await packBackupZip({
      manifest: { version: '1', vaultId: 'v', monthKey: '2026-04', generatedAt: 0, source: 'client' },
      vaultState: null,
      docRows: [
        { _id: 'customer:1', type: 'customer', updatedAt: 1, deleted: false, payload: { ct: 'aGVsbG8=', iv: 'MTIzNDU2Nzg5MDEy' } },
      ],
      photoRows: [],
      attachments: [],
    });
    await expect(assertCiphertextOnly(bytes)).resolves.toBeUndefined();
  });

  it('fails when a row has empty payload (regression guard)', async () => {
    const { bytes } = await packBackupZip({
      manifest: { version: '1', vaultId: 'v', monthKey: '2026-04', generatedAt: 0, source: 'client' },
      vaultState: null,
      docRows: [
        { _id: 'customer:1', type: 'customer', updatedAt: 1, deleted: false, payload: { ct: '', iv: '' } },
      ],
      photoRows: [],
      attachments: [],
    });
    await expect(assertCiphertextOnly(bytes)).rejects.toThrow();
  });
});
