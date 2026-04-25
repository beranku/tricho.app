/**
 * Restore a vault from a `.tricho-backup.zip`. Works both for ZIPs produced
 * locally on the client and for ZIPs streamed from the cloud monthly endpoint
 * — they share the same byte format.
 *
 * Bytes-as-is invariant: this code does not decrypt. It writes the encrypted
 * shape back into PouchDB; the existing read path decrypts lazily when the
 * UI fetches a doc.
 */
import type { VaultDb } from '../db/pouch';
import { unpackBackupZip, type DocRow, type AttachmentEntry } from './zip-pack';

export interface RestoreReport {
  appliedDocs: number;
  appliedPhotos: number;
  skippedNewerLocal: number;
  attachments: number;
  vaultStateRestored: boolean;
  manifest: {
    monthKey: string;
    vaultId: string;
    docCount: number;
    photoCount: number;
    attachmentCount: number;
    generatedAt: number;
  };
}

export interface RestoreOpts {
  db: VaultDb;
  /** ZIP bytes from a File pickup OR from the cloud download endpoint. */
  bytes: Uint8Array;
  /** Optional override — by default we use manifest.vaultId. */
  expectedVaultId?: string;
}

export class VaultIdMismatchError extends Error {
  constructor(public expected: string, public found: string) {
    super(`backup vaultId ${found} does not match local vaultId ${expected}`);
    this.name = 'VaultIdMismatchError';
  }
}

export async function restoreFromZipBytes(opts: RestoreOpts): Promise<RestoreReport> {
  const unpacked = await unpackBackupZip(opts.bytes);
  if (opts.expectedVaultId && unpacked.manifest.vaultId !== opts.expectedVaultId) {
    throw new VaultIdMismatchError(opts.expectedVaultId, unpacked.manifest.vaultId);
  }

  let vaultStateRestored = false;
  if (unpacked.vaultState) {
    const existing = await opts.db.pouch
      .get('_local/vault-state')
      .catch(() => null as unknown);
    const next = { ...unpacked.vaultState, _id: '_local/vault-state' };
    if (existing && (existing as { _rev?: string })._rev) {
      (next as { _rev?: string })._rev = (existing as { _rev: string })._rev;
    }
    await opts.db.pouch.put(next as never);
    vaultStateRestored = true;
  }

  let appliedDocs = 0;
  let appliedPhotos = 0;
  let skippedNewerLocal = 0;
  for (const row of unpacked.docRows) {
    const applied = await applyDoc(opts.db, row);
    if (applied === 'applied') appliedDocs += 1;
    else skippedNewerLocal += 1;
  }
  for (const row of unpacked.photoRows) {
    const applied = await applyDoc(opts.db, row);
    if (applied === 'applied') appliedPhotos += 1;
    else skippedNewerLocal += 1;
  }

  // Attach raw attachments to their docs. They're already encrypted at rest.
  for (const att of unpacked.attachments) {
    await attachAttachment(opts.db, att);
  }

  return {
    appliedDocs,
    appliedPhotos,
    skippedNewerLocal,
    attachments: unpacked.attachments.length,
    vaultStateRestored,
    manifest: {
      monthKey: unpacked.manifest.monthKey,
      vaultId: unpacked.manifest.vaultId,
      docCount: unpacked.manifest.docCount,
      photoCount: unpacked.manifest.photoCount,
      attachmentCount: unpacked.manifest.attachmentCount,
      generatedAt: unpacked.manifest.generatedAt,
    },
  };
}

async function applyDoc(db: VaultDb, row: DocRow): Promise<'applied' | 'skipped'> {
  const existing = (await db.pouch.get(row._id).catch(() => null)) as
    | { _rev: string; updatedAt?: number }
    | null;
  if (existing && (existing.updatedAt ?? 0) > row.updatedAt) {
    // Newest-wins: local doc is more recent, keep it.
    return 'skipped';
  }
  const next: Record<string, unknown> = {
    _id: row._id,
    type: row.type,
    updatedAt: row.updatedAt,
    deleted: row.deleted,
    payload: row.payload,
  };
  if (row.monthBucket) next.monthBucket = row.monthBucket;
  if (existing?._rev) next._rev = existing._rev;
  await db.pouch.put(next as never);
  return 'applied';
}

async function attachAttachment(db: VaultDb, att: AttachmentEntry): Promise<void> {
  const doc = (await db.pouch.get(att.docId).catch(() => null)) as
    | { _rev: string }
    | null;
  if (!doc) return;
  const blob = new Blob([att.bytes as BlobPart], { type: 'application/octet-stream' });
  await db.pouch.putAttachment(att.docId, att.name, doc._rev, blob, 'application/octet-stream');
}

export async function readZipFromFile(file: File): Promise<Uint8Array> {
  const ab = await file.arrayBuffer();
  return new Uint8Array(ab);
}
