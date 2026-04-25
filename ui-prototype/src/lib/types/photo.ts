/**
 * Predefined labels for photo categorization
 * (shown in camera dropdown).
 */
export type PhotoLabel =
  | 'celek'
  | 'temeno-detail'
  | 'vlasova-linie'
  | 'spanky'
  | 'volny';

/**
 * Diagnostic photo stored encrypted in IndexedDB.
 * Binary data never leaves the device unencrypted.
 */
export interface Photo {
  /** UUID v4 */
  id: string;
  /** FK → Client.id */
  clientId: string;
  /** FK → Appointment.id (optional — photos without appointment are archived) */
  appointmentId?: string;
  /** Encrypted blob (AES-GCM, key derived from user passphrase) */
  encryptedBlob: Blob;
  /** IV used for encryption (stored with blob for decryption) */
  iv: Uint8Array;
  /** Category label */
  label: PhotoLabel;
  /** Optional free-form note */
  note?: string;
  /** ISO datetime — capture time */
  capturedAt: string;
  /** ISO datetime — last modification */
  updatedAt: string;
  /** Whether UV mode was enabled during capture */
  uvMode: boolean;
  /** Whether flash was enabled during capture */
  flashMode: boolean;
}

/** Display labels in Czech for UI */
export const PHOTO_LABEL_DISPLAY: Record<PhotoLabel, string> = {
  'celek': 'Celek',
  'temeno-detail': 'Temeno · detail',
  'vlasova-linie': 'Vlasová linie',
  'spanky': 'Spánky',
  'volny': 'Volný'
};
