/**
 * Client-side monthly backup ZIP generator.
 *
 * Bytes-as-is invariant: this code never decrypts. It iterates the local
 * PouchDB and copies the on-disk encrypted shape (`payload` ciphertext +
 * raw attachment binaries) into the shared ZIP layout. Restore needs the DEK
 * (via Recovery Secret or WebAuthn-PRF) to decrypt anything — but the ZIP
 * itself works without one.
 */
import type { VaultDb } from '../db/pouch';
import {
  packBackupZip,
  type DocRow,
  type AttachmentEntry,
  type VaultStateRow,
} from './zip-pack';
import { isValidMonthKey } from '../lib/format/utc-month';

export interface GenerateLocalBackupOpts {
  db: VaultDb;
  vaultId: string;
  monthKey: string;
  /** Override `Date.now()` for tests. */
  now?: number;
}

export interface GenerateLocalBackupResult {
  blob: Blob;
  bytes: Uint8Array;
  filename: string;
  manifest: { docCount: number; photoCount: number; attachmentCount: number };
}

export async function generateLocalBackupZip(
  opts: GenerateLocalBackupOpts,
): Promise<GenerateLocalBackupResult> {
  if (!isValidMonthKey(opts.monthKey)) {
    throw new Error(`invalid monthKey: ${opts.monthKey}`);
  }
  const all = await opts.db.pouch.allDocs<Record<string, unknown>>({
    include_docs: true,
    attachments: true,
    binary: true,
  } as never);

  const docRows: DocRow[] = [];
  const photoRows: DocRow[] = [];
  const attachments: AttachmentEntry[] = [];
  let vaultState: VaultStateRow | null = null;

  for (const row of all.rows) {
    const id = row.id;
    if (!id) continue;
    const doc = row.doc as Record<string, unknown> | undefined;
    if (!doc) continue;

    if (typeof id === 'string' && id.startsWith('_design/')) continue;

    if (typeof id === 'string' && id === '_local/vault-state') {
      vaultState = stripCouchInternals(doc) as VaultStateRow;
      continue;
    }
    if (typeof id === 'string' && id.startsWith('_local/')) continue;

    const baseRow: DocRow = {
      _id: String(doc._id),
      type: String(doc.type ?? ''),
      updatedAt: typeof doc.updatedAt === 'number' ? doc.updatedAt : 0,
      deleted: Boolean(doc.deleted),
      payload: (doc.payload ?? { ct: '', iv: '' }) as DocRow['payload'],
      ...(typeof doc.monthBucket === 'string' ? { monthBucket: doc.monthBucket } : {}),
    };

    if (doc.type === 'photo-meta') {
      const bucket =
        typeof doc.monthBucket === 'string'
          ? doc.monthBucket
          : deriveBucketFromUpdatedAt(baseRow.updatedAt);
      if (bucket !== opts.monthKey) continue;
      photoRows.push({ ...baseRow, monthBucket: bucket });
    } else {
      docRows.push(baseRow);
    }

    const a = (doc as { _attachments?: Record<string, { data: unknown; content_type?: string }> })._attachments;
    if (a) {
      for (const [name, entry] of Object.entries(a)) {
        const bytes = await coerceAttachmentBytes(entry.data);
        if (!bytes) continue;
        const isPhoto = doc.type === 'photo-meta';
        const included = isPhoto
          ? photoRows.some((r) => r._id === baseRow._id)
          : docRows.some((r) => r._id === baseRow._id);
        if (!included) continue;
        attachments.push({ docId: baseRow._id, name, bytes });
      }
    }
  }

  const { bytes } = await packBackupZip({
    manifest: {
      version: '1',
      vaultId: opts.vaultId,
      monthKey: opts.monthKey,
      generatedAt: opts.now ?? Date.now(),
      source: 'client',
    },
    vaultState,
    docRows,
    photoRows,
    attachments,
  });

  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' });
  return {
    blob,
    bytes,
    filename: `${opts.monthKey}.tricho-backup.zip`,
    manifest: {
      docCount: docRows.length,
      photoCount: photoRows.length,
      attachmentCount: attachments.length,
    },
  };
}

async function coerceAttachmentBytes(data: unknown): Promise<Uint8Array | null> {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    const ab = await data.arrayBuffer();
    return new Uint8Array(ab);
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
    return new Uint8Array(data);
  }
  if (typeof data === 'string') {
    return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  }
  return null;
}

function deriveBucketFromUpdatedAt(updatedAt: number): string {
  const d = new Date(updatedAt);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function stripCouchInternals(doc: Record<string, unknown>): Record<string, unknown> {
  const { _rev, ...rest } = doc;
  return rest;
}

/**
 * Trigger a download of a Blob in the browser. Idempotent — clicks an
 * invisible <a download> element and revokes the URL afterward.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
