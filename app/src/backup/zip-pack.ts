/**
 * Shared backup ZIP composer/parser. Used by:
 *   - Server cron (`infrastructure/couchdb/tricho-auth/billing/backup-snapshot.mjs`)
 *   - Client local-export (`src/backup/local-zip.ts`)
 *
 * Both produce a byte-identical ZIP for the same input, so the restore path
 * doesn't care where the ZIP came from. Encryption invariant: this module
 * NEVER decrypts. Inputs are bytes-as-they-are-on-disk; the AEAD ciphertext
 * inside `payload` and the binary attachment bytes are passed through.
 *
 * Layout inside ZIP:
 *   manifest.json      — { version, vaultId, monthKey, generatedAt, source,
 *                          docCount, photoCount, attachmentCount }
 *   vault-state.json   — verbatim copy of the local vault-state row (so a
 *                        fresh device can reconstruct the wrapped DEK before
 *                        the user supplies the Recovery Secret)
 *   docs.ndjson        — one non-photo doc per line (text data, complete
 *                        snapshot regardless of month)
 *   photos.ndjson      — one photo-meta doc per line (filtered to monthKey)
 *   attachments/<docId>/<name>.bin — raw encrypted attachment bytes
 */

import JSZip from 'jszip';

export const BACKUP_VERSION = '1';

export interface BackupManifest {
  version: typeof BACKUP_VERSION;
  vaultId: string;
  monthKey: string;
  generatedAt: number;
  source: 'client' | 'server';
  docCount: number;
  photoCount: number;
  attachmentCount: number;
}

export interface DocRow {
  _id: string;
  _rev?: string;
  type: string;
  updatedAt: number;
  deleted: boolean;
  monthBucket?: string;
  payload: { ct: string; iv: string };
}

export interface AttachmentEntry {
  docId: string;
  name: string;
  /** Raw encrypted bytes — exactly as stored on disk. */
  bytes: Uint8Array;
}

export interface VaultStateRow {
  _id: string;
  vaultId: string;
  deviceSalt: string;
  wrappedDekRs?: unknown;
  wrappedDekPrf?: unknown;
  version?: number;
  [key: string]: unknown;
}

export interface PackInput {
  manifest: Omit<BackupManifest, 'docCount' | 'photoCount' | 'attachmentCount'>;
  vaultState: VaultStateRow | null;
  docRows: DocRow[];
  photoRows: DocRow[];
  attachments: AttachmentEntry[];
}

export interface PackedBackup {
  bytes: Uint8Array;
  manifest: BackupManifest;
}

export async function packBackupZip(input: PackInput): Promise<PackedBackup> {
  const zip = new JSZip();
  const manifest: BackupManifest = {
    ...input.manifest,
    version: BACKUP_VERSION,
    docCount: input.docRows.length,
    photoCount: input.photoRows.length,
    attachmentCount: input.attachments.length,
  };
  zip.file('manifest.json', stableJson(manifest));
  if (input.vaultState) {
    zip.file('vault-state.json', stableJson(input.vaultState));
  }
  zip.file('docs.ndjson', toNdjson(input.docRows));
  zip.file('photos.ndjson', toNdjson(input.photoRows));
  for (const att of input.attachments) {
    zip.file(`attachments/${safePath(att.docId)}/${safePath(att.name)}.bin`, att.bytes);
  }
  // Deterministic byte output requires stable date.
  const FIXED_DATE = new Date(0);
  for (const file of Object.values(zip.files)) {
    file.date = FIXED_DATE;
  }
  // STORE compression so identical inputs produce byte-identical ZIPs across
  // node/browser. DEFLATE includes timestamp/CRC variability we don't need.
  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'STORE',
    streamFiles: false,
  });
  return { bytes, manifest };
}

export interface UnpackedBackup {
  manifest: BackupManifest;
  vaultState: VaultStateRow | null;
  docRows: DocRow[];
  photoRows: DocRow[];
  attachments: AttachmentEntry[];
}

export class IncompatibleBackupVersionError extends Error {
  constructor(public got: string) {
    super(`incompatible backup version: ${got}`);
    this.name = 'IncompatibleBackupVersionError';
  }
}

export class MalformedBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedBackupError';
  }
}

export async function unpackBackupZip(bytes: Uint8Array): Promise<UnpackedBackup> {
  const zip = await JSZip.loadAsync(bytes);
  const manifestRaw = await readTextOrNull(zip, 'manifest.json');
  if (!manifestRaw) throw new MalformedBackupError('missing manifest.json');
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    throw new MalformedBackupError('manifest.json invalid JSON');
  }
  if (manifest.version !== BACKUP_VERSION) {
    throw new IncompatibleBackupVersionError(manifest.version);
  }
  if (typeof manifest.vaultId !== 'string' || !manifest.vaultId) {
    throw new MalformedBackupError('manifest missing vaultId');
  }
  if (typeof manifest.monthKey !== 'string' || !manifest.monthKey) {
    throw new MalformedBackupError('manifest missing monthKey');
  }

  const vaultStateRaw = await readTextOrNull(zip, 'vault-state.json');
  const vaultState = vaultStateRaw ? (JSON.parse(vaultStateRaw) as VaultStateRow) : null;

  const docsRaw = (await readTextOrNull(zip, 'docs.ndjson')) ?? '';
  const photosRaw = (await readTextOrNull(zip, 'photos.ndjson')) ?? '';
  const docRows = parseNdjson(docsRaw);
  const photoRows = parseNdjson(photosRaw);

  const attachments: AttachmentEntry[] = [];
  for (const [path, file] of Object.entries(zip.files)) {
    if (!path.startsWith('attachments/')) continue;
    if (file.dir) continue;
    const m = path.match(/^attachments\/([^/]+)\/([^/]+)\.bin$/);
    if (!m) continue;
    const data = await file.async('uint8array');
    attachments.push({ docId: m[1], name: m[2], bytes: data });
  }
  return { manifest, vaultState, docRows, photoRows, attachments };
}

function stableJson(value: unknown): string {
  // Sort keys so the same logical object always produces the same byte string.
  return JSON.stringify(value, Object.keys(flattenKeys(value)).sort());
}

function flattenKeys(value: unknown, out: Record<string, true> = {}, prefix = ''): Record<string, true> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      out[k] = true;
      flattenKeys(v, out, `${prefix}${k}.`);
    }
  }
  return out;
}

function toNdjson(rows: DocRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n');
}

function parseNdjson(text: string): DocRow[] {
  if (!text.trim()) return [];
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DocRow);
}

async function readTextOrNull(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  if (!file) return null;
  return file.async('string');
}

function safePath(s: string): string {
  return String(s).replace(/[^a-zA-Z0-9_:.\-]/g, '_').slice(0, 200);
}
