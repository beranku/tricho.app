/**
 * Decrypt-and-return helpers for appointments in a time window or for a
 * specific customer.
 *
 * Architecture note: `appointment.startAt` is sensitive plaintext that lives
 * only inside the encrypted `payload` (per the zero-knowledge invariant in
 * `payload-encryption`). It is NOT on the wire, so it cannot be indexed.
 * Schedule queries scan all appointments via the `[type, updatedAt]` index
 * and filter by `startAt` client-side after decrypt. For a single-user
 * trichology practice (≤ thousands of appointments over years) this is fast
 * enough — the decrypt cost is dominated by I/O latency anyway.
 */
import type { VaultDb } from '../../db/pouch';
import { DOC_TYPES, type AppointmentData, type BaseEncryptedDoc } from '../../db/types';
import { decryptPayloadFromRxDB } from '../../crypto/payload';

export interface AppointmentRecord extends AppointmentData {
  id: string;
  rev: string;
}

export interface QueryWindow {
  start: number;
  end: number;
}

async function decryptAllAppointments(db: VaultDb): Promise<AppointmentRecord[]> {
  const result = await db.pouch.find({
    selector: { type: DOC_TYPES.APPOINTMENT, updatedAt: { $gte: 0 } },
    sort: [{ type: 'desc' }, { updatedAt: 'desc' }],
  });
  const out: AppointmentRecord[] = [];
  for (const row of result.docs as BaseEncryptedDoc[]) {
    if (row.deleted) continue;
    const { data } = await decryptPayloadFromRxDB<AppointmentData>(row.payload, {
      dek: db.dek,
      expectedKeyId: db.vaultId,
      context: row.type,
      documentId: row._id,
    });
    out.push({ ...data, id: row._id, rev: row._rev! });
  }
  return out;
}

export async function queryAppointments(db: VaultDb, window: QueryWindow): Promise<AppointmentRecord[]> {
  const all = await decryptAllAppointments(db);
  return all
    .filter((a) => a.startAt >= window.start && a.startAt < window.end)
    .sort((a, b) => a.startAt - b.startAt);
}

export async function queryAppointmentsForCustomer(db: VaultDb, customerId: string): Promise<AppointmentRecord[]> {
  const all = await decryptAllAppointments(db);
  return all
    .filter((a) => a.customerId === customerId)
    .sort((a, b) => a.startAt - b.startAt);
}
