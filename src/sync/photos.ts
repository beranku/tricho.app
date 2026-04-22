/**
 * Encrypted photo attachment storage via PouchDB.
 *
 * The photo-meta doc is a normal encrypted document in the per-user DB. The
 * actual encrypted blob is attached via `db.putAttachment(photoId, 'blob', ...)`
 * and rides PouchDB replication to CouchDB. No separate object store, no
 * separate upload queue — replication retry handles offline/online.
 */

import type { VaultDb } from '../db/pouch';
import { putEncrypted, DOC_TYPES } from '../db/pouch';
import { generateDocId, type PhotoMetaData } from '../db/types';

const ATTACHMENT_NAME = 'blob';
const ATTACHMENT_TYPE = 'application/octet-stream';

export interface StorePhotoInput {
  meta: Omit<PhotoMetaData, 'createdAt'>;
  cipherBlob: Blob;
}

export interface StoredPhoto {
  id: string;
  meta: PhotoMetaData;
  updatedAt: number;
  size: number;
  deleted: boolean;
}

export async function storePhoto(db: VaultDb, input: StorePhotoInput): Promise<string> {
  const id = generateDocId(DOC_TYPES.PHOTO_META);
  const now = Date.now();
  const meta: PhotoMetaData = { ...input.meta, createdAt: now };

  // 1) Write the encrypted photo-meta doc.
  const { rev } = await putEncrypted<PhotoMetaData>(db, {
    _id: id,
    type: DOC_TYPES.PHOTO_META,
    updatedAt: now,
    deleted: false,
    data: meta,
  });

  // 2) Attach the encrypted blob to the doc. Replication ships attachments
  //    alongside their owning docs, so there's nothing separate to orchestrate.
  await db.pouch.putAttachment(id, ATTACHMENT_NAME, rev, input.cipherBlob, ATTACHMENT_TYPE);
  return id;
}

export async function listPhotoIds(db: VaultDb): Promise<string[]> {
  const result = await db.pouch.find({
    selector: { type: DOC_TYPES.PHOTO_META, updatedAt: { $gte: 0 } },
    sort: [{ type: 'desc' }, { updatedAt: 'desc' }],
  });
  return (result.docs as Array<{ _id: string; deleted?: boolean }>)
    .filter((d) => !d.deleted)
    .map((d) => d._id);
}

export async function getPhotoBlob(db: VaultDb, id: string): Promise<Blob> {
  const blob = (await db.pouch.getAttachment(id, ATTACHMENT_NAME)) as Blob;
  return blob;
}

export async function deletePhoto(db: VaultDb, id: string): Promise<void> {
  const existing = await db.pouch.get(id).catch(() => null);
  if (!existing) return;
  await db.pouch.put({ ...existing, deleted: true, updatedAt: Date.now() });
}
