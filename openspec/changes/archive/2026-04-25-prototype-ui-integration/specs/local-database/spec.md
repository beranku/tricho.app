## ADDED Requirements

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
