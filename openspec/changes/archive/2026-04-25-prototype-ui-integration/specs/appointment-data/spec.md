## ADDED Requirements

### Requirement: `appointment` is a typed encrypted document

The system MUST add `'appointment'` to `DOC_TYPES` in `src/db/types.ts` and define an `AppointmentData` interface with shape `{ customerId: string, startAt: number, endAt: number, status: 'scheduled' | 'active' | 'done', serviceLabel: string, allergenIds?: string[], productIds?: string[], notes?: string, createdAt: number }`. Like every other domain doc, `appointment` MUST persist via `putEncrypted` so its plaintext appears only in `payload` ciphertext on the wire.

#### Scenario: Server sees only ciphertext

- **GIVEN** an `appointment` doc written via `putEncrypted`
- **WHEN** the raw row is fetched from CouchDB with admin credentials
- **THEN** the row contains `_id`, `_rev`, `type === 'appointment'`, `updatedAt`, `deleted`, and `payload`
- **AND** `payload` is opaque AEAD ciphertext
- **AND** no plaintext field for `customerId`, `startAt`, or `serviceLabel` is present

### Requirement: Schedule queries scan-by-type then filter on decrypt

Schedule queries (`queryAppointments`, `queryAppointmentsForCustomer`) MUST select all `appointment` docs by type via the `[type, updatedAt]` index from `local-database`, decrypt each row through the standard `payload-encryption` path, and filter / sort the decrypted results by `startAt` client-side. The system MUST NOT expose `startAt` as a top-level (non-payload) field, MUST NOT register an index that names `startAt`, and MUST NOT depend on a server-side range query over `startAt`.

`appointment.startAt` is plaintext-only and lives inside the encrypted `payload` per `payload-encryption`; it is not on the wire and therefore cannot be indexed without violating zero-knowledge. Trading a O(log N + k) range query for a O(N_appointments) decrypt is acceptable for a single-user practice (≤ 10⁵ appointments over years; decrypt is ~µs per row in Web Crypto).

#### Scenario: No `startAt` field on the wire

- **GIVEN** an `appointment` written via `putEncrypted`
- **WHEN** the raw row is fetched from CouchDB with admin credentials
- **THEN** the row's only data-bearing field is `payload`
- **AND** `startAt` does NOT appear at the top level

#### Scenario: Schedule range filter is correct

- **GIVEN** a vault with 50 appointments spread across 30 days
- **WHEN** `queryAppointments(db, { start: t0, end: t1 })` runs for a 1-day window
- **THEN** every returned appointment has `startAt ∈ [t0, t1)`
- **AND** appointments with `startAt` outside the window are excluded

### Requirement: Validators reject malformed appointments

A `validateAppointmentData(data)` helper MUST exist alongside the existing `validateCustomerData` / `validateVisitData`, asserting `data is AppointmentData`. It MUST throw on:
- non-string `customerId` or empty string
- non-number `startAt`, `endAt`
- `endAt <= startAt`
- `status` outside the three allowed values
- non-string `serviceLabel`

#### Scenario: Reject inverted interval

- **GIVEN** an input with `startAt: 100`, `endAt: 100`
- **WHEN** `validateAppointmentData(input)` is called
- **THEN** an error is thrown matching `endAt must be > startAt`

### Requirement: Free-slot synthesis is deterministic and pure

A pure function `synthesizeSlots(appointments: AppointmentData[], dayStart: number, dayEnd: number, businessHours: { start: number, end: number }): Slot[]` MUST emit a chronological mixed list of appointments and free-slot pseudo-objects. Free-slots MUST be inserted between the previous appointment's `endAt` and the next appointment's `startAt`, and at the start/end of business hours, when the gap is `≥ minGapMinutes` (default 15). Free-slot objects MUST NOT have a PouchDB `_id` and MUST NOT be writeable.

#### Scenario: Gap below threshold suppressed

- **GIVEN** two appointments ending at `09:30` and starting at `09:40`, with `minGapMinutes = 15`
- **WHEN** `synthesizeSlots` runs
- **THEN** no free-slot is emitted for the 10-minute gap

#### Scenario: Day-start free-slot

- **GIVEN** business hours start at `08:00` and the first appointment is at `09:00`
- **WHEN** `synthesizeSlots` runs
- **THEN** a single free-slot is emitted for `08:00` with duration `60 min`

### Requirement: Status transitions reflect time

A pure function `currentStatus(appointment, now): 'scheduled' | 'active' | 'done'` MUST derive status from time, **shadowing** the persisted `status` field for read-only views:
- `now < startAt` → `scheduled`
- `startAt ≤ now < endAt` → `active`
- `now ≥ endAt` → `done`

The persisted `status` field is a `done`/aborted marker for explicit user actions (e.g. early cancellation). When persisted `status === 'done'` and `now < endAt`, `done` MUST win (user explicitly closed it).

#### Scenario: Active by clock

- **GIVEN** an appointment with `startAt = now − 10min`, `endAt = now + 50min`, persisted `status: 'scheduled'`
- **WHEN** `currentStatus(appt, now)` is called
- **THEN** the result is `active`

#### Scenario: Closed early

- **GIVEN** an appointment with `startAt = now − 10min`, `endAt = now + 50min`, persisted `status: 'done'`
- **WHEN** `currentStatus(appt, now)` is called
- **THEN** the result is `done`

### Requirement: AAD binding holds for appointments

Like every encrypted doc, an appointment payload's AEAD MUST bind to `{vaultId, docId}`. Splice attacks MUST fail per `payload-encryption`.

#### Scenario: Splice fails

- **GIVEN** appointments A and B in the same vault with payloads pA and pB
- **WHEN** an attacker substitutes B's `payload` with pA
- **AND** the client attempts to decrypt B
- **THEN** decryption fails with an AEAD error
