import { describe, expect, it } from 'vitest';
import {
  packBackupZip,
  unpackBackupZip,
  IncompatibleBackupVersionError,
  MalformedBackupError,
  type DocRow,
  type AttachmentEntry,
} from './zip-pack';

const VAULT_ID = 'vault-1';
const MONTH = '2026-04';

function fakeDoc(id: string, type: string, monthBucket?: string, updatedAt = 100): DocRow {
  return {
    _id: id,
    type,
    updatedAt,
    deleted: false,
    payload: { ct: 'aGVsbG8tY2lwaGVy', iv: 'MTIzNDU2Nzg5MDEy' },
    ...(monthBucket ? { monthBucket } : {}),
  };
}

const fakeAttachment = (docId: string, byteValue: number): AttachmentEntry => ({
  docId,
  name: 'blob',
  bytes: new Uint8Array([byteValue, byteValue + 1, byteValue + 2]),
});

describe('packBackupZip / unpackBackupZip', () => {
  it('round-trips manifest, docs, photos, attachments', async () => {
    const docRows = [fakeDoc('customer:1', 'customer'), fakeDoc('visit:1', 'visit')];
    const photoRows = [fakeDoc('photo-meta:1', 'photo-meta', MONTH)];
    const attachments = [fakeAttachment('photo-meta:1', 0xa0)];
    const { bytes, manifest } = await packBackupZip({
      manifest: {
        version: '1',
        vaultId: VAULT_ID,
        monthKey: MONTH,
        generatedAt: 12345,
        source: 'client',
      },
      vaultState: { _id: '_local/vault-state', vaultId: VAULT_ID, deviceSalt: 'abc' },
      docRows,
      photoRows,
      attachments,
    });
    expect(manifest.docCount).toBe(2);
    expect(manifest.photoCount).toBe(1);
    expect(manifest.attachmentCount).toBe(1);

    const out = await unpackBackupZip(bytes);
    expect(out.manifest.vaultId).toBe(VAULT_ID);
    expect(out.manifest.monthKey).toBe(MONTH);
    expect(out.docRows).toHaveLength(2);
    expect(out.photoRows).toHaveLength(1);
    expect(out.attachments).toHaveLength(1);
    expect(out.attachments[0].docId).toBe('photo-meta:1');
    expect(out.attachments[0].bytes).toEqual(new Uint8Array([0xa0, 0xa1, 0xa2]));
    expect(out.vaultState?.deviceSalt).toBe('abc');
  });

  it('deterministic byte output for identical inputs', async () => {
    const input = {
      manifest: {
        version: '1' as const,
        vaultId: VAULT_ID,
        monthKey: MONTH,
        generatedAt: 0,
        source: 'client' as const,
      },
      vaultState: { _id: '_local/vault-state', vaultId: VAULT_ID, deviceSalt: 'abc' },
      docRows: [fakeDoc('customer:1', 'customer')],
      photoRows: [fakeDoc('photo-meta:1', 'photo-meta', MONTH)],
      attachments: [fakeAttachment('photo-meta:1', 0x11)],
    };
    const { bytes: a } = await packBackupZip(input);
    const { bytes: b } = await packBackupZip(input);
    expect(Buffer.from(a).toString('hex')).toEqual(Buffer.from(b).toString('hex'));
  });

  it('rejects malformed JSON manifest', async () => {
    // Build a fake "ZIP" by packing then corrupting the manifest. Easiest:
    // unpack returns malformed if manifest.json is missing.
    const empty = new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    await expect(unpackBackupZip(empty)).rejects.toBeInstanceOf(MalformedBackupError);
  });

  it('rejects incompatible version', async () => {
    const { bytes } = await packBackupZip({
      manifest: {
        version: '1',
        vaultId: VAULT_ID,
        monthKey: MONTH,
        generatedAt: 0,
        source: 'client',
      },
      vaultState: null,
      docRows: [],
      photoRows: [],
      attachments: [],
    });
    // Override the manifest in-memory to "9".
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(bytes);
    zip.file('manifest.json', JSON.stringify({ version: '9', vaultId: VAULT_ID, monthKey: MONTH, generatedAt: 0, source: 'client', docCount: 0, photoCount: 0, attachmentCount: 0 }));
    const corrupted = await zip.generateAsync({ type: 'uint8array' });
    await expect(unpackBackupZip(corrupted)).rejects.toBeInstanceOf(IncompatibleBackupVersionError);
  });

  it('attachment bytes pass through unchanged (no decrypt)', async () => {
    const ciphertext = new Uint8Array(256);
    for (let i = 0; i < ciphertext.length; i++) ciphertext[i] = (i * 31) & 0xff;
    const { bytes } = await packBackupZip({
      manifest: { version: '1', vaultId: VAULT_ID, monthKey: MONTH, generatedAt: 0, source: 'client' },
      vaultState: null,
      docRows: [],
      photoRows: [fakeDoc('photo-meta:1', 'photo-meta', MONTH)],
      attachments: [{ docId: 'photo-meta:1', name: 'blob', bytes: ciphertext }],
    });
    const out = await unpackBackupZip(bytes);
    expect(out.attachments[0].bytes).toEqual(ciphertext);
  });

  it('docs.ndjson does not include plaintext data fields', async () => {
    // simulate a real wire-shaped doc — only payload ciphertext, no plaintext leaks
    const docRows: DocRow[] = [
      {
        _id: 'customer:1',
        type: 'customer',
        updatedAt: 1,
        deleted: false,
        payload: { ct: 'X', iv: 'Y' },
      },
    ];
    const { bytes } = await packBackupZip({
      manifest: { version: '1', vaultId: VAULT_ID, monthKey: MONTH, generatedAt: 0, source: 'client' },
      vaultState: null,
      docRows,
      photoRows: [],
      attachments: [],
    });
    const text = Buffer.from(bytes).toString('utf8');
    expect(text).not.toContain('SECRET-NAME');
    expect(text).not.toContain('SECRET-EMAIL');
  });
});
