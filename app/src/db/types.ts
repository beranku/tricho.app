/**
 * Document types shared across the PWA.
 *
 * PouchDB is schemaless; validation lives in TypeScript types + lightweight
 * input validators called from the UI. The wire shape is always
 * `{ _id, _rev?, type, updatedAt, deleted, payload }` where `payload` is an
 * opaque AES-GCM ciphertext — the server never sees plaintext.
 */

import type { EncryptedPayload } from '../crypto/payload';

export const DOC_TYPES = {
  CUSTOMER: 'customer',
  VISIT: 'visit',
  APPOINTMENT: 'appointment',
  PHOTO_META: 'photo-meta',
  VAULT_STATE: 'vault-state',
} as const;

export type DocType = (typeof DOC_TYPES)[keyof typeof DOC_TYPES];

export interface BaseEncryptedDoc {
  _id: string;
  _rev?: string;
  type: DocType;
  updatedAt: number;
  deleted: boolean;
  payload: EncryptedPayload;
  /**
   * Calendar-month bucket "YYYY-MM" derived from the doc's primary timestamp
   * at write time. Set on photo-meta docs from `takenAt`; absent on other
   * doc types (server treats undefined as "include in textual snapshot").
   * The bucket is stable — once set, edits MUST NOT change it.
   */
  monthBucket?: string;
}

export interface PlaintextDoc<T> {
  _id: string;
  _rev?: string;
  type: DocType;
  updatedAt: number;
  deleted: boolean;
  data: T;
}

export interface CustomerData {
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  notes?: string;
  gender?: 'male' | 'female' | 'other';
  birthDate?: string;
  createdAt: number;
  tags?: string[];
  /** Allergen ids (encrypted plaintext) — surfaced as Caveat-amber chips. */
  allergenIds?: string[];
}

export interface VisitData {
  customerId: string;
  date: number;
  services?: string[];
  products?: string[];
  notes?: string;
  price?: number;
  createdAt: number;
}

export type AppointmentStatus = 'scheduled' | 'active' | 'done';

export interface AppointmentData {
  customerId: string;
  /** Unix ms — start of the appointment slot. */
  startAt: number;
  /** Unix ms — end of the appointment slot. */
  endAt: number;
  /** Persisted status; `currentStatus(appt, now)` shadows this from time. */
  status: AppointmentStatus;
  /** Czech service label, e.g. "Diagnostika", "Konzultace". */
  serviceLabel: string;
  /** Allergen ids referenced from the customer's allergen list. */
  allergenIds?: string[];
  /** Product ids actually applied during the appointment. */
  productIds?: string[];
  notes?: string;
  createdAt: number;
}

export type PhotoAngle = 'before' | 'detail' | 'after';

export interface PhotoMetaData {
  customerId: string;
  visitId?: string;
  /** Optional back-reference to a specific appointment instance. */
  appointmentId?: string;
  takenAt: number;
  contentType: string;
  /** Typed enum (was free-form string). Legacy values normalise to 'detail' in UI. */
  angle?: PhotoAngle;
  /** Hand-written cam-card chip text — Czech UTF-8, ≤24 chars. */
  label?: string;
  notes?: string;
  createdAt: number;
}

export function validateCustomerData(data: unknown): asserts data is CustomerData {
  if (!data || typeof data !== 'object') throw new Error('Customer data must be an object');
  const d = data as Record<string, unknown>;
  if (typeof d.firstName !== 'string' || !d.firstName.length) {
    throw new Error('firstName required');
  }
  if (typeof d.lastName !== 'string' || !d.lastName.length) {
    throw new Error('lastName required');
  }
}

export function validateVisitData(data: unknown): asserts data is VisitData {
  if (!data || typeof data !== 'object') throw new Error('Visit data must be an object');
  const d = data as Record<string, unknown>;
  if (typeof d.customerId !== 'string' || !d.customerId.length) {
    throw new Error('customerId required');
  }
  if (typeof d.date !== 'number') throw new Error('date required');
}

const APPOINTMENT_STATUSES: ReadonlySet<string> = new Set(['scheduled', 'active', 'done']);

export function validateAppointmentData(data: unknown): asserts data is AppointmentData {
  if (!data || typeof data !== 'object') throw new Error('Appointment data must be an object');
  const d = data as Record<string, unknown>;
  if (typeof d.customerId !== 'string' || !d.customerId.length) {
    throw new Error('customerId required');
  }
  if (typeof d.startAt !== 'number' || !Number.isFinite(d.startAt)) {
    throw new Error('startAt must be a number');
  }
  if (typeof d.endAt !== 'number' || !Number.isFinite(d.endAt)) {
    throw new Error('endAt must be a number');
  }
  if (d.endAt <= d.startAt) {
    throw new Error('endAt must be > startAt');
  }
  if (typeof d.status !== 'string' || !APPOINTMENT_STATUSES.has(d.status)) {
    throw new Error('status must be scheduled | active | done');
  }
  if (typeof d.serviceLabel !== 'string') {
    throw new Error('serviceLabel required');
  }
}

export function generateDocId(type: DocType): string {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  return `${type}:${id}`;
}
