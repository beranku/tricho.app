## ADDED Requirements

### Requirement: Client-detail route loads a single customer's plaintext

The route `/clients/[id]` MUST resolve `[id]` to a `customer` document via `getDecrypted(db, id)` and render the `<ClientDetail>` view with the customer's plaintext name in the chrome title. If the customer is not found, the view MUST render a "Klient nenalezen" placeholder, never the wrong customer's data.

#### Scenario: Successful load

- **GIVEN** a customer doc with id `customer:abc` and `data.firstName = "Klára"`, `data.lastName = "Dvořáková"`
- **WHEN** the user navigates to `/clients/customer:abc`
- **THEN** the chrome title displays `Klára Dvořáková` (Fraunces, opsz 36)
- **AND** the back button navigates to `/`

#### Scenario: Missing customer

- **GIVEN** there is no doc with id `customer:missing`
- **WHEN** the user navigates to `/clients/customer:missing`
- **THEN** the page renders `Klient nenalezen`
- **AND** no other customer's data is visible on the page

### Requirement: Current-head row shows active appointment countdown

When the customer has an active appointment (`status: "active"`, `startAt ≤ now < endAt`), the `<CurrentHead>` row MUST render the service label in teal-strong Fraunces, the allergen badge (if any) in Caveat amber, and the remaining time as `zbývá X min` in Geist ink-3.

#### Scenario: Countdown is rendered

- **GIVEN** an active appointment ending in 45 minutes with `serviceLabel: "Diagnostika"` and `allergenIds: ["amoniak"]`
- **WHEN** the client detail mounts
- **THEN** the current-head row contains `Diagnostika`
- **AND** it contains `Amoniak`
- **AND** it contains the text `zbývá 45 min`

### Requirement: Cam-card captures encrypted photos via existing path

The `<CameraCard>` component MUST stream `getUserMedia` into a video element, capture frames to a `<canvas>`, encode JPEG via `canvas.toBlob`, and call the existing `storePhoto(db, vaultId, dek, blob, meta)` function (`src/sync/photos.ts`). The `meta` MUST include `customerId`, `takenAt`, `contentType: "image/jpeg"`, the selected `angle`, and the optional `label` from the cam-card chip dropdown.

#### Scenario: Capture writes encrypted attachment

- **GIVEN** an unlocked vault and a customer detail page mounted
- **WHEN** the user taps the cam-card capture button with angle `before`
- **THEN** `storePhoto` is called once
- **AND** the resulting photo-meta doc has `data.angle === "before"`
- **AND** the resulting attachment is opaque ciphertext (per `photo-attachments`)
- **AND** no plaintext JPEG bytes are sent to the server

#### Scenario: Permission denied surfaces an error

- **GIVEN** the user has previously denied camera permission
- **WHEN** the cam-card mounts
- **THEN** the cam-card shows a permission-denied message
- **AND** the capture button is disabled

### Requirement: Cam-card label dropdown selects angle

The cam-card label chip MUST allow selecting one of three angles: `before` (Czech: `Před`), `detail`, `after` (Czech: `Po`). The selection MUST be applied to the next captured photo. The currently-selected option MUST be visually marked.

#### Scenario: Selecting "Po" changes the next angle

- **GIVEN** the cam-card open with angle `before` active
- **WHEN** the user opens the dropdown and selects `Po`
- **AND** taps the capture button
- **THEN** the new photo-meta doc has `data.angle === "after"`

### Requirement: Thumbnail strip lists this customer's photos

Below the cam-card, a horizontal thumbnail strip MUST list the customer's photos newest-first via `queryDecrypted(db, 'photo-meta', { selector: { customerId: id } })`. Each thumbnail MUST display the photo's hand-written `label` (Patrick Hand) over a tinted gradient placeholder until the encrypted blob is decrypted on demand.

#### Scenario: Thumbnails render labels

- **GIVEN** the customer has three photos with labels `Před`, `Detail`, `Po`
- **WHEN** the client detail mounts
- **THEN** three thumbnails appear with those labels in order of `takenAt` descending

### Requirement: Detail card shows services, products, note, next-term

The `<DetailCard>` MUST render four sections separated by `var(--line-soft)` dividers:
1. Service chips (each chip = `serviceLabel` from past appointments + the special `+` add-chip).
2. Product chips (each = product name; checked state for products applied during the latest appointment).
3. Note (Patrick-Hand prose body — customer's `data.notes`).
4. Next-term row — earliest future scheduled appointment for this customer, formatted as Czech date.

#### Scenario: Next-term shows earliest future appointment

- **GIVEN** the customer has scheduled appointments on `2026-05-08` and `2026-06-15`
- **WHEN** the client detail mounts
- **THEN** the next-term row shows `8. května`
- **AND** it does NOT show `15. června`

#### Scenario: No next term

- **GIVEN** the customer has no future-scheduled appointment
- **WHEN** the client detail mounts
- **THEN** the next-term row shows `Termín neplánován` in ink-4

### Requirement: Allergen chips highlight in amber

Allergen chips on the detail card MUST render with Caveat font, amber colour, and a `chip-allergen` modifier class so screen readers announce them as warnings. Tapping a chip opens a sheet with the chemical name + safety notes (placeholder content acceptable).

#### Scenario: Allergen chip is amber-coded

- **GIVEN** a customer with `allergenIds: ["ppd"]`
- **WHEN** the client detail mounts
- **THEN** a chip with text `PPD` appears in the allergens section
- **AND** its colour resolves to `var(--amber)`
- **AND** its font-family resolves starting with `Caveat`
