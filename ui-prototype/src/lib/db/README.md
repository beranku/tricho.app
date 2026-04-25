# IndexedDB (Dexie.js) — Schema & Repository

Tento adresář je vyhrazený pro Dexie.js DB vrstvu. V V1 UI skeletonu je
prázdný — typy jsou definované v `src/lib/types/`, ale persistentní
storage bude implementován v následujícím cyklu.

## Plánované soubory

```
src/lib/db/
├── schema.ts           # Dexie table definitions
├── index.ts            # Singleton DB instance
├── clients.repo.ts     # CRUD pro Client
├── appointments.repo.ts# CRUD pro Appointment + free-slot gap computation
├── photos.repo.ts      # CRUD pro Photo (encrypted blobs)
└── sync.ts             # Future: replication layer
```

## Schema sketch (k implementaci)

```typescript
import Dexie, { type Table } from 'dexie';
import type { Client, Appointment, Photo, Allergen } from '../types';

export class TrichoDB extends Dexie {
  clients!: Table<Client, string>;
  appointments!: Table<Appointment, string>;
  photos!: Table<Photo, string>;
  allergens!: Table<Allergen, string>;

  constructor() {
    super('tricho');
    this.version(1).stores({
      clients: 'id, lastName, firstName, updatedAt',
      appointments: 'id, clientId, startAt, status, updatedAt, [clientId+startAt]',
      photos: 'id, clientId, appointmentId, capturedAt',
      allergens: 'id'
    });
  }
}

export const db = new TrichoDB();
```

## Encryption layer

Photo blobs musí být šifrované AES-GCM před uložením. Klíč odvozen z user
passphrase (PBKDF2) a držen v paměti jen během session.

Doporučená knihovna: [Noble secp256k1 + AES-GCM](https://github.com/paulmillr/noble-ciphers)
nebo native Web Crypto API pro AES-GCM.

## Sync strategy

Budoucí rozhodnutí — porovnaných v dřívější rešerši:
- **Dexie + PowerSync + Supabase** (modernější, lepší mobile)
- **PouchDB + CouchDB replication** (prověřená stabilita)

V1 UI neovlivňuje — komponenty čtou přes repo abstraction.
