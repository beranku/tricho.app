// Filesystem-backed storage for opaque backup blobs.
//
// Layout: <BACKUP_ROOT>/<canonicalUsername>/<snapshotId>.bin
//
// Atomic writes via tmp + rename. Per-user directory ensures cross-user
// isolation at the OS level.

import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

export class BackupStore {
  constructor({ root }) {
    this.root = root;
  }

  userDir(canonicalUsername) {
    return path.join(this.root, sanitize(canonicalUsername));
  }

  blobPath(canonicalUsername, snapshotId) {
    return path.join(this.userDir(canonicalUsername), `${sanitize(snapshotId)}.bin`);
  }

  monthPath(canonicalUsername, monthKey) {
    return path.join(this.userDir(canonicalUsername), `${sanitize(monthKey)}.tricho-backup.zip`);
  }

  async writeMonth({ canonicalUsername, monthKey, bytes }) {
    const dir = this.userDir(canonicalUsername);
    await fs.mkdir(dir, { recursive: true });
    const dest = this.monthPath(canonicalUsername, monthKey);
    const tmp = `${dest}.tmp.${process.pid}.${Date.now()}`;
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, dest);
    return { sizeBytes: bytes.length };
  }

  async readMonth({ canonicalUsername, monthKey }) {
    return fs.readFile(this.monthPath(canonicalUsername, monthKey));
  }

  openMonthReadStream({ canonicalUsername, monthKey }) {
    return createReadStream(this.monthPath(canonicalUsername, monthKey));
  }

  async deleteMonth({ canonicalUsername, monthKey }) {
    await fs.unlink(this.monthPath(canonicalUsername, monthKey)).catch(() => null);
  }

  async existsMonth({ canonicalUsername, monthKey }) {
    try {
      await fs.access(this.monthPath(canonicalUsername, monthKey));
      return true;
    } catch {
      return false;
    }
  }

  async writeBlob({ canonicalUsername, snapshotId, stream }) {
    const dir = this.userDir(canonicalUsername);
    await fs.mkdir(dir, { recursive: true });
    const dest = this.blobPath(canonicalUsername, snapshotId);
    const tmp = `${dest}.tmp.${process.pid}.${Date.now()}`;
    let bytes = 0;
    await pipeline(
      stream,
      async function* (source) {
        for await (const chunk of source) {
          bytes += chunk.length;
          yield chunk;
        }
      },
      createWriteStream(tmp),
    );
    await fs.rename(tmp, dest);
    return { sizeBytes: bytes };
  }

  /** Returns a Buffer (small enough for v1) or throws if missing. */
  async readBlob({ canonicalUsername, snapshotId }) {
    const dest = this.blobPath(canonicalUsername, snapshotId);
    return fs.readFile(dest);
  }

  openReadStream({ canonicalUsername, snapshotId }) {
    return createReadStream(this.blobPath(canonicalUsername, snapshotId));
  }

  async deleteBlob({ canonicalUsername, snapshotId }) {
    const dest = this.blobPath(canonicalUsername, snapshotId);
    await fs.unlink(dest).catch(() => null);
  }

  async exists({ canonicalUsername, snapshotId }) {
    try {
      await fs.access(this.blobPath(canonicalUsername, snapshotId));
      return true;
    } catch {
      return false;
    }
  }
}

function sanitize(s) {
  // canonicalUsername is `g_<32hex>` / `a_<32hex>` and snapshotId is a UUID
  // or hex string from the client; strict allowlist defends against any
  // malformed value sneaking past validation upstream.
  return String(s).replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
}

/**
 * Retention policy: keep the N most-recent snapshots plus 1 monthly anchor
 * (oldest snapshot of each calendar month) up to M months. Returns the
 * snapshotIds to DELETE. The function is pure (no IO) so it can be unit-tested.
 *
 * @param {Array<{snapshotId:string, createdAt:number}>} manifests sorted by createdAt
 * @param {{recentN?: number, monthsM?: number}} opts
 */
export function applyRetention(manifests, { recentN = 7, monthsM = 12 } = {}) {
  if (manifests.length === 0) return [];
  // Sort newest-first.
  const sorted = [...manifests].sort((a, b) => b.createdAt - a.createdAt);
  const keep = new Set();
  for (let i = 0; i < Math.min(recentN, sorted.length); i++) keep.add(sorted[i].snapshotId);

  // Monthly anchors: for each calendar month (UTC), keep the oldest
  // snapshot whose createdAt falls in it. Up to M months.
  const monthBuckets = new Map();
  for (const m of sorted) {
    const d = new Date(m.createdAt);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const existing = monthBuckets.get(key);
    if (!existing || m.createdAt < existing.createdAt) monthBuckets.set(key, m);
  }
  const monthKeys = [...monthBuckets.keys()].sort().reverse().slice(0, monthsM);
  for (const k of monthKeys) keep.add(monthBuckets.get(k).snapshotId);

  return sorted.filter((m) => !keep.has(m.snapshotId)).map((m) => m.snapshotId);
}
