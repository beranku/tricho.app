/**
 * End-to-end (within the unit tier) tests for the appointment query path:
 *   wire shape — only `{_id, _rev, type, updatedAt, deleted, payload}` on disk
 *   round-trip — putEncrypted → queryAppointments returns plaintext
 *   AAD splice attack — rewriting one doc's payload with another's fails
 *   soft-delete — deleted docs disappear from query results
 *   customer-scoped query — returns only that customer's appointments
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import PouchDB from 'pouchdb-browser';
import PouchAdapterMemory from 'pouchdb-adapter-memory';
import {
  openVaultDb,
  destroyVaultDb,
  putEncrypted,
  softDelete,
} from '../../db/pouch';
import { generateAesGcmKey } from '../../crypto/envelope';
import {
  DOC_TYPES,
  generateDocId,
  type AppointmentData,
  type BaseEncryptedDoc,
} from '../../db/types';
import { queryAppointments, queryAppointmentsForCustomer } from './query';

PouchDB.plugin(PouchAdapterMemory);

const VAULT_ID = 'appt-test-vault';
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

function appt(start: number, end: number, customerId = 'customer:c1'): AppointmentData {
  return {
    customerId,
    startAt: start,
    endAt: end,
    status: 'scheduled',
    serviceLabel: 'Diagnostika',
    createdAt: 0,
  };
}

describe('appointment-data wire shape + queries', () => {
  let dek: CryptoKey;

  beforeEach(async () => {
    dek = await generateAesGcmKey(false);
  });
  afterEach(async () => {
    await destroyVaultDb().catch(() => void 0);
  });

  it('written appointment shows only {_id, _rev, type, updatedAt, deleted, payload} on disk', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    const id = generateDocId(DOC_TYPES.APPOINTMENT);
    const t0 = new Date(2026, 3, 25, 10, 0).getTime();
    await putEncrypted<AppointmentData>(db, {
      _id: id,
      type: DOC_TYPES.APPOINTMENT,
      updatedAt: Date.now(),
      deleted: false,
      data: appt(t0, t0 + HOUR),
    });
    const row = (await db.pouch.get(id)) as BaseEncryptedDoc & Record<string, unknown>;
    const allowedKeys = new Set(['_id', '_rev', 'type', 'updatedAt', 'deleted', 'payload']);
    for (const key of Object.keys(row)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
    expect(row.type).toBe(DOC_TYPES.APPOINTMENT);
    expect(typeof row.payload).toBe('object');
    // Plaintext fields MUST NOT be on the wire.
    expect((row as Record<string, unknown>).startAt).toBeUndefined();
    expect((row as Record<string, unknown>).customerId).toBeUndefined();
    expect((row as Record<string, unknown>).serviceLabel).toBeUndefined();
  });

  it('queryAppointments returns only appointments inside the [start, end) window', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    const t0 = new Date(2026, 3, 25, 10, 0).getTime();
    const yesterday = t0 - DAY;
    const tomorrow = t0 + DAY;

    for (const start of [yesterday, t0, tomorrow]) {
      await putEncrypted<AppointmentData>(db, {
        _id: generateDocId(DOC_TYPES.APPOINTMENT),
        type: DOC_TYPES.APPOINTMENT,
        updatedAt: Date.now(),
        deleted: false,
        data: appt(start, start + HOUR),
      });
    }

    const results = await queryAppointments(db, { start: t0 - 30 * 60_000, end: t0 + DAY - 60_000 });
    expect(results).toHaveLength(1);
    expect(results[0]?.startAt).toBe(t0);
  });

  it('queryAppointmentsForCustomer returns only that customer', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    const t0 = Date.now();
    await putEncrypted<AppointmentData>(db, {
      _id: generateDocId(DOC_TYPES.APPOINTMENT),
      type: DOC_TYPES.APPOINTMENT,
      updatedAt: Date.now(),
      deleted: false,
      data: appt(t0, t0 + HOUR, 'customer:a'),
    });
    await putEncrypted<AppointmentData>(db, {
      _id: generateDocId(DOC_TYPES.APPOINTMENT),
      type: DOC_TYPES.APPOINTMENT,
      updatedAt: Date.now(),
      deleted: false,
      data: appt(t0 + HOUR, t0 + 2 * HOUR, 'customer:b'),
    });

    const a = await queryAppointmentsForCustomer(db, 'customer:a');
    const b = await queryAppointmentsForCustomer(db, 'customer:b');
    expect(a).toHaveLength(1);
    expect(a[0]?.customerId).toBe('customer:a');
    expect(b).toHaveLength(1);
    expect(b[0]?.customerId).toBe('customer:b');
  });

  it('soft-deleted appointments are excluded from queries', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    const t0 = Date.now();
    const id = generateDocId(DOC_TYPES.APPOINTMENT);
    await putEncrypted<AppointmentData>(db, {
      _id: id,
      type: DOC_TYPES.APPOINTMENT,
      updatedAt: Date.now(),
      deleted: false,
      data: appt(t0, t0 + HOUR),
    });
    expect((await queryAppointments(db, { start: 0, end: t0 + DAY })).length).toBe(1);
    await softDelete(db, id);
    expect((await queryAppointments(db, { start: 0, end: t0 + DAY })).length).toBe(0);
  });

  it('AAD splice attack: substituting another doc payload fails decrypt', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    const t0 = Date.now();
    const idA = generateDocId(DOC_TYPES.APPOINTMENT);
    const idB = generateDocId(DOC_TYPES.APPOINTMENT);
    await putEncrypted<AppointmentData>(db, {
      _id: idA,
      type: DOC_TYPES.APPOINTMENT,
      updatedAt: Date.now(),
      deleted: false,
      data: appt(t0, t0 + HOUR),
    });
    await putEncrypted<AppointmentData>(db, {
      _id: idB,
      type: DOC_TYPES.APPOINTMENT,
      updatedAt: Date.now(),
      deleted: false,
      data: appt(t0 + HOUR, t0 + 2 * HOUR),
    });
    const a = (await db.pouch.get(idA)) as BaseEncryptedDoc;
    const b = (await db.pouch.get(idB)) as BaseEncryptedDoc;
    // Splice: rewrite B's payload to A's ciphertext.
    await db.pouch.put({ ...b, payload: a.payload });
    // Query must fail decrypting B (AAD bound to {vaultId, idB}, but ciphertext was for idA).
    await expect(queryAppointments(db, { start: 0, end: t0 + DAY })).rejects.toThrow();
  });

  it('only one type-keyed index is registered', async () => {
    const db = await openVaultDb(VAULT_ID, dek, { adapter: 'memory' });
    const ix = await db.pouch.getIndexes();
    // _all_docs is auto-created; user indexes should be exactly one (`type, updatedAt`).
    const userIndexes = ix.indexes.filter((i: { ddoc?: string }) => i.ddoc?.startsWith('_design'));
    expect(userIndexes.length).toBe(1);
    const fields = userIndexes[0]?.def?.fields;
    expect(JSON.stringify(fields)).toContain('"type"');
    expect(JSON.stringify(fields)).toContain('"updatedAt"');
    expect(JSON.stringify(fields)).not.toContain('"startAt"');
  });
});
