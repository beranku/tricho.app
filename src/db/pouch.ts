/**
 * PouchDB wrapper with transparent payload encryption.
 *
 * Wraps a single PouchDB instance per unlocked vault. Documents go in as
 * plaintext `{ _id, type, updatedAt, deleted, data }` and are transparently
 * encrypted to `{ _id, type, updatedAt, deleted, payload }` on write. Reads
 * decrypt the payload back to `data`.
 *
 * The encryption key is held in memory here; callers pass a CryptoKey + key id
 * (the vault id, used as AAD context).
 */

import type PouchDBType from 'pouchdb-browser';
import {
  encryptPayloadForRxDB,
  decryptPayloadFromRxDB,
  isEncryptedPayload,
  type EncryptedPayload,
} from '../crypto/payload';
import { DOC_TYPES, type BaseEncryptedDoc, type DocType, type PlaintextDoc } from './types';

type PouchConstructor = typeof PouchDBType;

let pouchPromise: Promise<PouchConstructor> | null = null;

/**
 * Lazily imports PouchDB. Keeps `pouchdb-browser` out of the SSR/Node path
 * during Astro's static build (it references `self` at module init time).
 */
async function getPouch(): Promise<PouchConstructor> {
  if (pouchPromise) return pouchPromise;
  pouchPromise = (async () => {
    const [{ default: PouchDB }, { default: PouchFind }] = await Promise.all([
      import('pouchdb-browser'),
      import('pouchdb-find'),
    ]);
    PouchDB.plugin(PouchFind);
    return PouchDB as PouchConstructor;
  })();
  return pouchPromise;
}

const DB_PREFIX = 'tricho_';

export interface VaultDb {
  pouch: PouchDB.Database<BaseEncryptedDoc>;
  vaultId: string;
  dek: CryptoKey;
  dbName: string;
}

export interface OpenDbOptions {
  /** Override the default browser adapter — mainly for tests. */
  adapter?: string;
}

function dbNameFor(vaultId: string): string {
  return `${DB_PREFIX}${vaultId.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}`;
}

let instance: VaultDb | null = null;

export function getVaultDb(): VaultDb | null {
  return instance;
}

export async function openVaultDb(
  vaultId: string,
  dek: CryptoKey,
  options?: OpenDbOptions,
): Promise<VaultDb> {
  if (instance && instance.vaultId === vaultId) return instance;
  if (instance) await closeVaultDb();

  const dbName = dbNameFor(vaultId);
  const PouchDB = await getPouch();
  const pouch = new PouchDB<BaseEncryptedDoc>(dbName, {
    adapter: options?.adapter,
    auto_compaction: true,
  });

  // Indexes accelerate `queryDecrypted` by type — the server-visible fields are
  // non-sensitive (id/type/updatedAt) and so can be indexed without leaking anything.
  // Note: appointment.startAt is sensitive and lives only inside `payload`, so
  // schedule range queries cannot use a `[type, startAt]` index. They scan by
  // type via this index and filter client-side after decrypt instead.
  await pouch.createIndex({ index: { fields: ['type', 'updatedAt'] } }).catch(() => void 0);

  instance = { pouch, vaultId, dek, dbName };
  return instance;
}

export async function closeVaultDb(): Promise<void> {
  if (!instance) return;
  try {
    await instance.pouch.close();
  } finally {
    instance = null;
  }
}

export async function destroyVaultDb(): Promise<void> {
  if (!instance) return;
  try {
    await instance.pouch.destroy();
  } finally {
    instance = null;
  }
}

interface EncryptOpts {
  context: string;
  documentId: string;
}

async function encrypt<T>(db: VaultDb, data: T, opts: EncryptOpts): Promise<EncryptedPayload> {
  return encryptPayloadForRxDB(data, {
    dek: db.dek,
    keyId: db.vaultId,
    context: opts.context,
    documentId: opts.documentId,
  });
}

async function decrypt<T>(db: VaultDb, doc: BaseEncryptedDoc, context: string): Promise<T> {
  if (!isEncryptedPayload(doc.payload)) {
    throw new Error(`Document ${doc._id} has no encrypted payload`);
  }
  const result = await decryptPayloadFromRxDB<T>(doc.payload, {
    dek: db.dek,
    expectedKeyId: db.vaultId,
    context,
    documentId: doc._id,
  });
  return result.data;
}

export async function putEncrypted<T>(
  db: VaultDb,
  doc: Omit<PlaintextDoc<T>, '_rev'> & { _rev?: string; monthBucket?: string },
): Promise<{ id: string; rev: string }> {
  const payload = await encrypt(db, doc.data, { context: doc.type, documentId: doc._id });
  const wireDoc: BaseEncryptedDoc = {
    _id: doc._id,
    ...(doc._rev ? { _rev: doc._rev } : {}),
    type: doc.type,
    updatedAt: doc.updatedAt,
    deleted: doc.deleted,
    ...(doc.monthBucket ? { monthBucket: doc.monthBucket } : {}),
    payload,
  };
  const res = await db.pouch.put(wireDoc);
  return { id: res.id, rev: res.rev };
}

export async function getDecrypted<T>(db: VaultDb, id: string): Promise<PlaintextDoc<T> | null> {
  let row: PouchDB.Core.ExistingDocument<BaseEncryptedDoc>;
  try {
    row = await db.pouch.get(id);
  } catch (err: unknown) {
    if ((err as { status?: number } | null)?.status === 404) return null;
    throw err;
  }
  const data = await decrypt<T>(db, row, row.type);
  return {
    _id: row._id,
    _rev: row._rev,
    type: row.type,
    updatedAt: row.updatedAt,
    deleted: row.deleted,
    data,
  };
}

export interface QueryOpts {
  includeDeleted?: boolean;
  limit?: number;
}

export async function queryDecrypted<T>(
  db: VaultDb,
  type: DocType,
  opts: QueryOpts = {},
): Promise<PlaintextDoc<T>[]> {
  const result = await db.pouch.find({
    selector: { type, updatedAt: { $gte: 0 } },
    sort: [{ type: 'desc' }, { updatedAt: 'desc' }],
    limit: opts.limit,
  });
  const out: PlaintextDoc<T>[] = [];
  for (const row of result.docs as BaseEncryptedDoc[]) {
    if (!opts.includeDeleted && row.deleted) continue;
    const data = await decrypt<T>(db, row, row.type);
    out.push({
      _id: row._id,
      _rev: row._rev,
      type: row.type,
      updatedAt: row.updatedAt,
      deleted: row.deleted,
      data,
    });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export async function softDelete(db: VaultDb, id: string): Promise<void> {
  const existing = await db.pouch.get(id);
  await db.pouch.put({
    ...existing,
    deleted: true,
    updatedAt: Date.now(),
  });
}

export interface WatchHandle {
  cancel(): void;
}

export function watchChanges(
  db: VaultDb,
  handler: (change: { id: string; deleted: boolean; type?: DocType }) => void,
): WatchHandle {
  const feed = db.pouch
    .changes({ since: 'now', live: true, include_docs: true })
    .on('change', (change) => {
      const doc = change.doc as BaseEncryptedDoc | undefined;
      handler({
        id: change.id,
        deleted: Boolean(change.deleted),
        type: doc?.type,
      });
    });
  return { cancel: () => feed.cancel() };
}

export { DOC_TYPES };
