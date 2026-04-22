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

export interface PhotoMetaData {
  customerId: string;
  visitId?: string;
  takenAt: number;
  contentType: string;
  angle?: string;
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

export function generateDocId(type: DocType): string {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  return `${type}:${id}`;
}
