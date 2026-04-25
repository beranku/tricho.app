// Server-side counterpart to src/backup/zip-pack.ts. Same byte format, same
// invariants. The two implementations stay in lock-step; the
// billing-backup-snapshot integration test asserts byte-for-byte equality
// of ZIPs produced from identical inputs by the two paths.

import { createRequire } from 'node:module';

const requireFromHere = createRequire(import.meta.url);
const JSZip = requireFromHere('jszip');

export const BACKUP_VERSION = '1';

export async function packBackupZip(input) {
  const zip = new JSZip();
  const manifest = {
    ...input.manifest,
    version: BACKUP_VERSION,
    docCount: input.docRows.length,
    photoCount: input.photoRows.length,
    attachmentCount: input.attachments.length,
  };
  zip.file('manifest.json', stableJson(manifest));
  if (input.vaultState) zip.file('vault-state.json', stableJson(input.vaultState));
  zip.file('docs.ndjson', toNdjson(input.docRows));
  zip.file('photos.ndjson', toNdjson(input.photoRows));
  for (const att of input.attachments) {
    zip.file(`attachments/${safePath(att.docId)}/${safePath(att.name)}.bin`, att.bytes);
  }
  const FIXED_DATE = new Date(0);
  for (const file of Object.values(zip.files)) {
    file.date = FIXED_DATE;
  }
  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'STORE',
    streamFiles: false,
  });
  return { bytes, manifest };
}

function stableJson(value) {
  return JSON.stringify(value, Object.keys(flattenKeys(value)).sort());
}

function flattenKeys(value, out = {}, prefix = '') {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      out[k] = true;
      flattenKeys(v, out, `${prefix}${k}.`);
    }
  }
  return out;
}

function toNdjson(rows) {
  return rows.map((r) => JSON.stringify(r)).join('\n');
}

function safePath(s) {
  return String(s).replace(/[^a-zA-Z0-9_:.\-]/g, '_').slice(0, 200);
}
