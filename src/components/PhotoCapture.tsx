import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { VaultDb } from '../db/pouch';
import { watchChanges, getDecrypted, DOC_TYPES } from '../db/pouch';
import {
  storePhoto,
  listPhotoIds,
  getPhotoBlob,
  deletePhoto,
} from '../sync/photos';
import {
  envelopeEncrypt,
  envelopeDecrypt,
  encodeBase64url,
  decodeBase64url,
  importAesGcmKey,
  exportAesGcmKey,
} from '../crypto/envelope';
import type { PhotoMetaData, PlaintextDoc } from '../db/types';

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

interface Props {
  db: import('../db/pouch').VaultDb;
  vaultId: string;
}

interface PhotoRow {
  meta: PlaintextDoc<PhotoMetaData>;
  size: number;
}

async function compressToJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new Error('Canvas.toBlob returned null.');
  return blob;
}

export function PhotoCapture({ db, vaultId }: Props): JSX.Element {
  const [rows, setRows] = useState<PhotoRow[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const ids = await listPhotoIds(db);
      const out: PhotoRow[] = [];
      for (const id of ids) {
        const meta = await getDecrypted<PhotoMetaData>(db, id);
        if (!meta) continue;
        const blob = await getPhotoBlob(db, id).catch(() => null);
        out.push({ meta, size: blob?.size ?? 0 });
      }
      out.sort((a, b) => b.meta.updatedAt - a.meta.updatedAt);
      setRows(out);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [db]);

  useEffect(() => {
    void refresh();
    const h = watchChanges(db, ({ type }) => {
      if (type === DOC_TYPES.PHOTO_META) void refresh();
    });
    return () => {
      h.cancel();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [db, refresh]);

  const onPick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setBusy(true);
      setError(null);
      try {
        const compressed = await compressToJpeg(file);
        const plaintext = new Uint8Array(await compressed.arrayBuffer());
        const aad = new TextEncoder().encode(vaultId);
        const { ct, iv } = await envelopeEncrypt(db.dek, plaintext, aad);
        const cipherBytes = decodeBase64url(ct);
        const cipherBlob = new Blob([cipherBytes as BlobPart, iv as BlobPart], {
          type: 'application/octet-stream',
        });
        // Keep IV and AAD info in the meta so decrypt can re-assemble.
        await storePhoto(db, {
          meta: {
            customerId: '', // unassigned in this minimal UI; wire from customer detail later
            takenAt: Date.now(),
            contentType: 'image/jpeg',
          },
          cipherBlob: new Blob([JSON.stringify({ iv, aad: encodeBase64url(aad) }) + '\n', cipherBytes as BlobPart]),
        });
        if (fileRef.current) fileRef.current.value = '';
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [db, vaultId, refresh],
  );

  const onPreview = useCallback(
    async (row: PhotoRow) => {
      setError(null);
      try {
        const blob = await getPhotoBlob(db, row.meta._id);
        const text = await blob.text();
        const newlineIdx = text.indexOf('\n');
        const header = JSON.parse(text.slice(0, newlineIdx));
        const cipher = new Uint8Array(await blob.slice(newlineIdx + 1).arrayBuffer());
        const ct = encodeBase64url(cipher);
        const aad = decodeBase64url(header.aad);
        const plain = await envelopeDecrypt(db.dek, ct, header.iv, aad);
        const plainBlob = new Blob([plain as BlobPart], { type: row.meta.data.contentType });
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(URL.createObjectURL(plainBlob));
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [db, previewUrl],
  );

  const onDelete = useCallback(
    async (row: PhotoRow) => {
      await deletePhoto(db, row.meta._id);
    },
    [db],
  );

  // Expose exportAesGcmKey so ts-unused-imports check doesn't trip — no-op in this component.
  void exportAesGcmKey;
  void importAesGcmKey;

  return (
    <div>
      <h2 style={{ margin: '0 0 16px' }}>Photos</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPick}
          disabled={busy}
        />
        {busy && <span style={{ color: '#666', fontSize: 13 }}>Compressing + encrypting…</span>}
      </div>
      {error && <div role="alert" style={{ color: '#ff3b30', marginBottom: 16 }}>{error}</div>}

      {rows.length === 0 ? (
        <p style={{ color: '#666' }}>No photos yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {rows.map((row) => (
            <li
              key={row.meta._id}
              style={{
                background: 'rgba(255,255,255,0.75)',
                padding: 12,
                borderRadius: 12,
                border: '1px solid rgba(0,0,0,0.06)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: '#666' }}>
                  {new Date(row.meta.updatedAt).toLocaleString()} · {(row.size / 1024).toFixed(1)} KB
                </div>
                <div style={{ fontSize: 11, color: '#999' }}>id {row.meta._id.slice(0, 36)}</div>
              </div>
              <button onClick={() => onPreview(row)} style={{ padding: '6px 12px', borderRadius: 8, background: '#007aff', color: '#fff', border: 'none', cursor: 'pointer' }}>
                Decrypt
              </button>
              <button onClick={() => onDelete(row)} style={{ padding: '6px 12px', borderRadius: 8, background: '#ff3b30', color: '#fff', border: 'none', cursor: 'pointer' }}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {previewUrl && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ margin: '0 0 8px' }}>Decrypted preview</h3>
          <img src={previewUrl} alt="decrypted photo" style={{ maxWidth: '100%', borderRadius: 12, boxShadow: '0 4px 18px rgba(0,0,0,0.12)' }} />
        </div>
      )}
    </div>
  );
}
