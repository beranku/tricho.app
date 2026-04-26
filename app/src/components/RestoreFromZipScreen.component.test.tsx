import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PouchDB from 'pouchdb-browser';
import PouchAdapterMemory from 'pouchdb-adapter-memory';
import { RestoreFromZipScreen } from './RestoreFromZipScreen';
import { openVaultDb, destroyVaultDb, putEncrypted, DOC_TYPES } from '../db/pouch';
import { generateAesGcmKey } from '../crypto/envelope';
import { generateLocalBackupZip } from '../backup/local-zip';
import { setLocale } from '../i18n';

PouchDB.plugin(PouchAdapterMemory);

const VAULT_ID = 'test-vault-restore';

beforeEach(() => {
  setLocale('en');
});

describe('RestoreFromZipScreen', () => {
  it('accepts a backup ZIP file and reports success', async () => {
    const dek = await generateAesGcmKey(false);
    const sourceDb = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    vi.spyOn(sourceDb.pouch, 'putAttachment').mockResolvedValue({ ok: true, id: '', rev: '' } as never);
    await putEncrypted(sourceDb, {
      _id: 'customer:1',
      type: DOC_TYPES.CUSTOMER,
      updatedAt: 100,
      deleted: false,
      data: { firstName: 'A', lastName: 'B', createdAt: 0 },
    });
    const result = await generateLocalBackupZip({ db: sourceDb, vaultId: VAULT_ID, monthKey: '2026-04' });
    await destroyVaultDb();

    const restoreDb = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    vi.spyOn(restoreDb.pouch, 'putAttachment').mockResolvedValue({ ok: true, id: '', rev: '' } as never);
    const onRestored = vi.fn();
    render(
      <RestoreFromZipScreen
        db={restoreDb}
        expectedVaultId={VAULT_ID}
        onBack={() => undefined}
        onRestored={onRestored}
      />,
    );
    // jsdom's File implementation does not preserve Uint8Array bytes for File()
    // construction reliably; build via Blob to keep the ZIP intact, then mock
    // arrayBuffer to return the canonical bytes.
    const blob = new Blob([result.bytes as BlobPart], { type: 'application/zip' });
    const file = new File([blob], '2026-04.tricho-backup.zip', { type: 'application/zip' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.byteLength),
    });
    const input = screen.getByLabelText(/Choose backup file/i) as HTMLInputElement;
    await userEvent.upload(input, file);
    await userEvent.click(screen.getByRole('button', { name: /^Restore$/i }));
    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    await destroyVaultDb();
  });

  it('shows error when ZIP belongs to a different vault', async () => {
    const dek = await generateAesGcmKey(false);
    const sourceDb = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    vi.spyOn(sourceDb.pouch, 'putAttachment').mockResolvedValue({ ok: true, id: '', rev: '' } as never);
    await putEncrypted(sourceDb, {
      _id: 'customer:1',
      type: DOC_TYPES.CUSTOMER,
      updatedAt: 100,
      deleted: false,
      data: { firstName: 'A', lastName: 'B', createdAt: 0 },
    });
    const result = await generateLocalBackupZip({ db: sourceDb, vaultId: VAULT_ID, monthKey: '2026-04' });
    await destroyVaultDb();

    const otherDb = await openVaultDb('other-vault', dek, { adapter: 'memory' });
    render(
      <RestoreFromZipScreen db={otherDb} expectedVaultId="other-vault" onBack={() => undefined} onRestored={() => undefined} />,
    );
    const blob = new Blob([result.bytes as BlobPart], { type: 'application/zip' });
    const file = new File([blob], 'x.tricho-backup.zip', { type: 'application/zip' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.byteLength),
    });
    const input = screen.getByLabelText(/Choose backup file/i) as HTMLInputElement;
    await userEvent.upload(input, file);
    await userEvent.click(screen.getByRole('button', { name: /^Restore$/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    await destroyVaultDb();
  });
});
