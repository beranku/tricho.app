## MODIFIED Requirements

### Requirement: Meta doc encrypts through `payload-encryption`
The photo-meta document's `payload` MUST be the standard `envelope-crypto` ciphertext. Only the attachment binary is separately stored (and is itself already AEAD-ciphertext produced by the client before upload). The `PhotoMetaData` plaintext SHALL include:

- `customerId: string` (required)
- `visitId?: string` (optional, when the photo was taken during a visit)
- `appointmentId?: string` (optional, when the photo was taken during an appointment scheduled via `appointment-data`)
- `takenAt: number` (Unix ms)
- `contentType: string` (e.g. `image/jpeg`)
- `angle?: 'before' | 'detail' | 'after'` (typed enum; previously a free-form string)
- `label?: string` (optional hand-written cam-card chip text — Czech UTF-8, ≤24 chars)
- `notes?: string`
- `createdAt: number`

Existing photos with a non-enum `angle` value MUST decrypt without error; the UI normalises unknown values to `detail` for display.

#### Scenario: Server sees two layers of opacity

- GIVEN a stored photo
- WHEN both the doc and its attachment are fetched with admin creds
- THEN `payload` is opaque AEAD ciphertext
- AND the attachment is opaque AEAD ciphertext
- AND neither is JPEG/PNG bytes directly

#### Scenario: Angle enum on a fresh write

- GIVEN a cam-card capture with selected angle `before`
- WHEN `storePhoto` writes the meta doc
- THEN the decrypted `data.angle` equals `'before'`
- AND the doc's plaintext shape passes a TypeScript-narrowed check `data.angle in {'before','detail','after'} | undefined`

#### Scenario: Legacy photo with free-form angle

- GIVEN a meta doc written before this change with `angle: 'detailed-back'`
- WHEN the client decrypts it for display
- THEN no error is thrown
- AND the rendered thumbnail label falls back to `Detail`

## ADDED Requirements

### Requirement: Optional appointment back-reference

A photo-meta doc MAY carry `appointmentId: string` to bind the photo to a specific appointment instance. When present, the field MUST be part of the encrypted plaintext only and MUST NEVER appear on the wire as a plain top-level field.

#### Scenario: Photo bound to appointment

- **GIVEN** an active appointment with id `appointment:xyz`
- **WHEN** the cam-card captures during that appointment
- **THEN** the resulting photo-meta has `data.appointmentId === 'appointment:xyz'`
- **AND** the server-visible row contains no `appointmentId` field outside `payload`

### Requirement: Hand-written label field

A photo-meta doc MAY carry `label: string`. When present, the label MUST be ≤24 UTF-8 characters; `storePhoto` MUST truncate longer inputs at write time. The cam-card label dropdown writes this field; the thumbnail strip displays it in Patrick-Hand typography over the gradient placeholder. The label MUST be encrypted as part of the standard plaintext (it lives inside `payload` like every other domain field).

#### Scenario: Label longer than 24 chars is truncated at write time

- **GIVEN** a user-typed label of 40 chars
- **WHEN** `storePhoto` is called with that label
- **THEN** the persisted `data.label` is exactly 24 chars
- **AND** the persisted `data.label` ends with the user's first 24 chars (no ellipsis appended at write time)
