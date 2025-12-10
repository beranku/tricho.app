// IndexedDB storage for photos

export interface PhotoRecord {
  id?: number;
  createdAt: number;
  blob: Blob;
  size: number;
}

const DB_NAME = 'pwa-camera-db';
const DB_VERSION = 1;
const STORE_NAME = 'photos';

let dbPromise: Promise<IDBDatabase | null> | null = null;

export function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  if (!('indexedDB' in window)) {
    console.warn('IndexedDB není k dispozici; galerie nebude fungovat.');
    return Promise.resolve(null);
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };
  });

  return dbPromise;
}

export async function savePhotoBlob(blob: Blob): Promise<number | undefined> {
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const record: PhotoRecord = { createdAt: Date.now(), blob, size: blob.size };
    const req = store.add(record);

    req.onsuccess = () => {
      resolve(req.result as number);
    };

    req.onerror = () => {
      reject(req.error);
    };
  });
}

export async function loadPhotos(): Promise<PhotoRecord[]> {
  const db = await openDb();
  if (!db) return [];

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      resolve(req.result || []);
    };

    req.onerror = () => {
      reject(req.error);
    };
  });
}

export async function deletePhoto(id: number): Promise<void> {
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);

    req.onsuccess = () => {
      resolve();
    };

    req.onerror = () => {
      reject(req.error);
    };
  });
}

export interface StorageTotals {
  count: number;
  bytes: number;
  avgBytes: number;
}

export function computeTotals(photos: PhotoRecord[]): StorageTotals {
  if (!photos || photos.length === 0) {
    return { count: 0, bytes: 0, avgBytes: 0 };
  }

  let totalBytes = 0;
  photos.forEach((p) => {
    const b = (p.blob && p.blob.size) || p.size || 0;
    totalBytes += b;
  });

  return {
    count: photos.length,
    bytes: totalBytes,
    avgBytes: totalBytes / photos.length,
  };
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  const fixed = val >= 100 ? val.toFixed(0) : val.toFixed(1);
  return fixed.replace('.', ',') + ' ' + units[i];
}
