import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PouchDB from 'pouchdb-browser';
import PouchAdapterMemory from 'pouchdb-adapter-memory';
import { BackupExportScreen } from './BackupExportScreen';
import { openVaultDb, destroyVaultDb, putEncrypted, DOC_TYPES } from '../db/pouch';
import { generateAesGcmKey } from '../crypto/envelope';
import { storePhoto } from '../sync/photos';
import { setLocale } from '../i18n';

PouchDB.plugin(PouchAdapterMemory);

const VAULT_ID = 'test-vault-export';

beforeEach(() => {
  setLocale('en');
});

describe('BackupExportScreen', () => {
  it('lists months found in local data, defaults to newest', async () => {
    const dek = await generateAesGcmKey(false);
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    vi.spyOn(db.pouch, 'putAttachment').mockResolvedValue({ ok: true, id: '', rev: '' } as never);
    await storePhoto(db, {
      meta: { customerId: 'c1', takenAt: Date.UTC(2026, 1, 5), contentType: 'image/jpeg' },
      cipherBlob: new Blob([new Uint8Array(8) as BlobPart]),
    });
    await storePhoto(db, {
      meta: { customerId: 'c1', takenAt: Date.UTC(2026, 3, 8), contentType: 'image/jpeg' },
      cipherBlob: new Blob([new Uint8Array(8) as BlobPart]),
    });
    render(<BackupExportScreen db={db} vaultId={VAULT_ID} onBack={() => undefined} />);
    await waitFor(() => expect(screen.getByLabelText(/Choose month/i)).toBeInTheDocument());
    const select = screen.getByLabelText(/Choose month/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain('2026-04');
    expect(options).toContain('2026-02');
    await destroyVaultDb();
  });

  it('triggers a download blob via the document body', async () => {
    const dek = await generateAesGcmKey(false);
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    vi.spyOn(db.pouch, 'putAttachment').mockResolvedValue({ ok: true, id: '', rev: '' } as never);
    await putEncrypted(db, {
      _id: 'customer:1',
      type: DOC_TYPES.CUSTOMER,
      updatedAt: Date.UTC(2026, 3, 5),
      deleted: false,
      data: { firstName: 'A', lastName: 'B', createdAt: 0 },
    });

    // Stub URL.createObjectURL — not implemented in jsdom.
    if (typeof (URL as { createObjectURL?: unknown }).createObjectURL !== 'function') {
      (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:fake-url';
      (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
    }
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-url');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickSpy = vi.fn();
    HTMLAnchorElement.prototype.click = clickSpy;

    render(<BackupExportScreen db={db} vaultId={VAULT_ID} onBack={() => undefined} />);
    await waitFor(() => expect(screen.getByLabelText(/Choose month/i)).toBeInTheDocument());
    const downloadBtn = screen.getByRole('button', { name: /Download ZIP/i });
    await userEvent.click(downloadBtn);
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(createSpy).toHaveBeenCalled();
    createSpy.mockRestore();
    revokeSpy.mockRestore();
    await destroyVaultDb();
  });
});
