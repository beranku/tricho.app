/**
 * Trichology/hairdresser client record.
 * Stored encrypted in IndexedDB (Dexie.js).
 */
export interface Client {
  /** UUID v4 */
  id: string;
  /** First name */
  firstName: string;
  /** Last name */
  lastName: string;
  /** Optional phone (E.164 format) */
  phone?: string;
  /** Optional email */
  email?: string;
  /** ISO date string — when first created */
  createdAt: string;
  /** ISO date string — last modification (for sync) */
  updatedAt: string;
  /** List of known allergens by ID */
  allergenIds: string[];
  /** Short personal note (handwriting-rendered in UI) */
  note?: string;
}

/**
 * Display name with nbsp between first and last — used as template literal helper.
 */
export function clientDisplayName(client: Client): string {
  return `${client.firstName}\u00a0${client.lastName}`;
}
