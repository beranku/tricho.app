// Server-side composition of a monthly backup ZIP for one user × one month.
//
// Bytes-as-is invariant: this code never decrypts. It reads `_all_docs` from
// the user's CouchDB database with attachments inline, filters photo-meta
// docs by `monthBucket`, and packs the result via the same ZIP layout the
// client uses. The encryption layer is untouched.
//
// The `meta` argument is the Meta admin client; it provides `couchdbUrl`
// and `auth` for direct fetches against CouchDB.

import { packBackupZip } from './zip-pack.mjs';
import {
  tierOf,
  backupRetentionMonthsOf,
} from './plans.mjs';

export function couchUsernameToDbName(canonicalUsername) {
  // Mirrors src/sync/couch-auth.ts#userDbUrlFor — UTF-8 hex of the username.
  return (
    'userdb-' +
    Array.from(new TextEncoder().encode(canonicalUsername))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
}

async function fetchAllDocs(meta, dbName) {
  const url = `${meta.couchdbUrl}/${dbName}/_all_docs?include_docs=true&attachments=true`;
  const res = await fetch(url, {
    headers: { authorization: meta.auth, accept: 'application/json' },
  });
  if (res.status === 404) return { rows: [] };
  if (!res.ok) throw new Error(`fetch ${dbName} failed (${res.status})`);
  return res.json();
}

function decodeAttachmentBytes(value) {
  // CouchDB returns inline attachments as base64 in `data`.
  if (!value || typeof value !== 'object') return null;
  if (typeof value.data === 'string') return Buffer.from(value.data, 'base64');
  return null;
}

/**
 * Compose a monthly backup ZIP for a user.
 *
 * @param {{
 *   meta: any,
 *   canonicalUsername: string,
 *   monthKey: string,
 *   vaultId?: string,
 *   now?: number,
 * }} args
 * @returns {Promise<{ bytes: Uint8Array, manifest: any, docCount: number, photoCount: number, attachmentCount: number }>}
 */
export async function computeMonthlyBackup({ meta, canonicalUsername, monthKey, vaultId = null, now = Date.now() }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
    throw new Error(`invalid monthKey: ${monthKey}`);
  }
  const dbName = couchUsernameToDbName(canonicalUsername);
  const all = await fetchAllDocs(meta, dbName);
  const docRows = [];
  const photoRows = [];
  const attachments = [];
  let resolvedVaultId = vaultId;
  let vaultState = null;

  for (const row of all.rows ?? []) {
    const doc = row.doc;
    if (!doc) continue;
    const id = doc._id;
    if (typeof id !== 'string') continue;
    if (id.startsWith('_design/')) continue;
    if (id.startsWith('_local/')) {
      // server replicates _local? typically not, but if seen — capture vault-state hint
      if (id === '_local/vault-state') {
        vaultState = stripCouchInternals(doc);
        if (!resolvedVaultId && typeof doc.vaultId === 'string') resolvedVaultId = doc.vaultId;
      }
      continue;
    }

    const baseRow = {
      _id: doc._id,
      type: doc.type,
      updatedAt: doc.updatedAt ?? 0,
      deleted: Boolean(doc.deleted),
      payload: doc.payload,
      ...(doc.monthBucket ? { monthBucket: doc.monthBucket } : {}),
    };

    if (doc.type === 'photo-meta') {
      // Filter by monthBucket; if undefined, fall back to updatedAt month for
      // legacy docs missing the field.
      const bucket = doc.monthBucket ?? deriveBucketFromUpdatedAt(doc.updatedAt);
      if (bucket !== monthKey) continue;
      photoRows.push({ ...baseRow, monthBucket: bucket });
    } else if (doc.type === 'vault-state') {
      // The vault-state replicating doc lives at the top level for some
      // installations; capture it for the backup.
      if (!resolvedVaultId && typeof doc.payload === 'object') resolvedVaultId = doc.vaultId ?? null;
      docRows.push(baseRow);
    } else {
      // All other types: include in textual snapshot regardless of month.
      docRows.push(baseRow);
    }

    if (doc._attachments && typeof doc._attachments === 'object') {
      for (const [name, value] of Object.entries(doc._attachments)) {
        const bytes = decodeAttachmentBytes(value);
        if (!bytes) continue;
        // Keep attachments only for photo docs that survived the filter, OR
        // for non-photo docs that are also included.
        const isPhoto = doc.type === 'photo-meta';
        const included = isPhoto
          ? photoRows.some((r) => r._id === doc._id)
          : docRows.some((r) => r._id === doc._id);
        if (!included) continue;
        attachments.push({ docId: doc._id, name, bytes });
      }
    }
  }

  const { bytes, manifest } = await packBackupZip({
    manifest: {
      vaultId: resolvedVaultId ?? canonicalUsername,
      monthKey,
      generatedAt: now,
      source: 'server',
    },
    vaultState,
    docRows,
    photoRows,
    attachments,
  });

  return {
    bytes,
    manifest,
    docCount: docRows.length,
    photoCount: photoRows.length,
    attachmentCount: attachments.length,
  };
}

function deriveBucketFromUpdatedAt(updatedAt) {
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return '';
  const d = new Date(updatedAt);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function stripCouchInternals(doc) {
  const { _rev, ...rest } = doc;
  return rest;
}

/**
 * Apply retention to a sorted-newest-first list of monthly-backup manifests.
 * Returns the monthKeys to DELETE.
 *
 * Pure function — no IO.
 */
export function applyMonthlyRetention(manifests, retentionMonths) {
  if (retentionMonths <= 0) return manifests.map((m) => m.monthKey);
  const sorted = [...manifests].sort((a, b) => (b.monthKey ?? '').localeCompare(a.monthKey ?? ''));
  const keep = new Set(sorted.slice(0, retentionMonths).map((m) => m.monthKey));
  return sorted.filter((m) => !keep.has(m.monthKey)).map((m) => m.monthKey);
}

export { tierOf, backupRetentionMonthsOf };
