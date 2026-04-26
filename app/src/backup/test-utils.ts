/**
 * Test helpers for backup ZIPs. Used to assert the encryption invariants
 * (D18) hold across all backup paths — local export and cloud snapshot.
 */
import { unpackBackupZip, type DocRow } from './zip-pack';

/**
 * Fail if any of the supplied plaintext strings appear anywhere in the ZIP
 * bytes. Use to verify that customer names, notes, etc. don't leak into a
 * backup blob.
 */
export function assertNoPlaintextLeak(zipBytes: Uint8Array, knownPlaintexts: string[]): void {
  const text = Buffer.from(zipBytes).toString('utf8');
  for (const needle of knownPlaintexts) {
    if (!needle) continue;
    if (text.includes(needle)) {
      throw new Error(`assertNoPlaintextLeak: leaked plaintext "${needle}" found in ZIP`);
    }
  }
}

/**
 * Fail if any doc row in the ZIP has an empty/missing AEAD `payload`. The
 * existence-check is the closest we can come to "is this ciphertext" without
 * possessing the DEK.
 */
export async function assertCiphertextOnly(zipBytes: Uint8Array): Promise<void> {
  const out = await unpackBackupZip(zipBytes);
  for (const row of [...out.docRows, ...out.photoRows] as DocRow[]) {
    if (!row.payload || typeof row.payload.ct !== 'string' || !row.payload.ct.length) {
      throw new Error(`assertCiphertextOnly: doc ${row._id} missing AEAD payload`);
    }
    if (typeof row.payload.iv !== 'string' || !row.payload.iv.length) {
      throw new Error(`assertCiphertextOnly: doc ${row._id} missing IV`);
    }
  }
}
