# local-database Specification

## Purpose

The on-device data store: PouchDB wrapped with transparent per-document encryption. Consumers `put` plaintext shapes and `get`/`query` plaintext shapes; the wrapper encrypts on write and decrypts on read. `_local/…` documents stay device-local. Intended to be the only place in the app that holds user data at rest.

Source files: `src/db/pouch.ts`, `src/db/pouch.test.ts`, `src/db/types.ts`.
## Requirements
### Requirement: Transparent encryption on put
`putEncrypted` MUST wrap the caller's `data` in the `payload-encryption` envelope before calling `db.pouch.put`. The stored document MUST contain only `{_id, _rev?, type, updatedAt, deleted, payload}` on the wire.

#### Scenario: Inspecting a stored doc
- GIVEN a customer doc written via `putEncrypted`
- WHEN the raw PouchDB document is read
- THEN the doc has no `data` field at the top level
- AND the `payload` is the `envelope-crypto` shape

### Requirement: Transparent decryption on read
`getDecrypted` MUST return a `PlaintextDoc<T>` whose `data` is the original input. Missing docs MUST return `null`, not throw.

#### Scenario: Round-trip
- GIVEN a customer doc written via `putEncrypted`
- WHEN `getDecrypted(db, id)` is called
- THEN the returned `data` deep-equals the original

#### Scenario: Missing doc
- GIVEN an id that does not exist
- WHEN `getDecrypted` is called
- THEN it returns `null`

### Requirement: `_local/…` docs are not replicated
The system MUST use PouchDB's `_local/` id prefix for any per-device doc (notably `_local/server-identity`) so the sync layer never ships it across the wire.

#### Scenario: Sync ignores `_local/`
- GIVEN a device with a `_local/server-identity` doc
- WHEN a full sync completes
- THEN the CouchDB remote does not contain `_local/server-identity`

### Requirement: Queries accelerate type + updatedAt
The system MUST register a `pouchdb-find` index on `[type, updatedAt]` so list screens can paginate efficiently.

#### Scenario: Query newest-first by type
- GIVEN a vault with 100 customer docs
- WHEN `queryDecrypted<CustomerData>(db, 'customer')` is called with no limit
- THEN results are returned sorted by `updatedAt` descending
- AND no full-table scan is required (index used)

### Requirement: Soft-delete semantics
Deletion is represented by `deleted: true` on the doc. Queries MUST exclude deleted docs by default; `{ includeDeleted: true }` opt-in shows them.

#### Scenario: Soft delete
- GIVEN a customer doc
- WHEN `softDelete(db, id)` is called
- AND `queryDecrypted` is called without options
- THEN the doc does not appear in the results
- AND `queryDecrypted(..., { includeDeleted: true })` returns it

### Requirement: One vault open at a time
Opening a second vault MUST close the first to avoid mixing DEKs and document stores.

#### Scenario: Switch vaults
- GIVEN `openVaultDb("vaultA", dekA)` has been called
- WHEN `openVaultDb("vaultB", dekB)` is called
- THEN the previous PouchDB instance is closed
- AND subsequent operations target `vaultB`

### Requirement: `appointment` doc type registered

`DOC_TYPES` in `src/db/types.ts` MUST include `appointment` alongside the existing `customer`, `visit`, `photo-meta`, `vault-state`. The same encryption, soft-delete, and `_local/` semantics in this spec apply unchanged.

#### Scenario: Round-trip an appointment

- **GIVEN** an `AppointmentData` plaintext written via `putEncrypted(db, dek, vaultId, 'appointment', data)`
- **WHEN** `getDecrypted(db, id)` is called
- **THEN** the returned `data` deep-equals the original

### Requirement: No additional sensitive-field indexes

The system MUST NOT register any `pouchdb-find` index whose key fields include sensitive plaintext (e.g., `startAt`, `customerId`, `serviceLabel`). The only permitted type-keyed index is `[type, updatedAt]` per the `local-database` invariants above. Schedule queries against `appointment` MUST therefore scan all rows by type and filter post-decrypt; see `appointment-data` for the full contract.

Such an index would either require lifting the field out of `payload` (breaking zero-knowledge) or index nothing (because the field is not on the wire).

#### Scenario: Only one type-keyed index is registered

- **GIVEN** a freshly opened vault DB
- **WHEN** the design-doc list is inspected
- **THEN** exactly one `pouchdb-find` index over `[type, updatedAt]` exists
- **AND** no index references `startAt` or any other field that lives only in `payload`

