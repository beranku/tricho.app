## ADDED Requirements

### Requirement: Plaintext monthBucket on photo-meta docs
Photo-meta docs MUST carry a top-level plaintext `monthBucket: "YYYY-MM"` field set at write time from the encrypted `takenAt` value (UTC). The field MUST be:
- present on every newly written photo-meta doc
- frozen — never changed by edits, soft-deletes, or revisions
- derived using UTC, not local time

The field is intentionally non-secret. The server already sees `updatedAt` at millisecond granularity; `monthBucket` aggregates strictly less information and serves as the sole field the server uses to bucket photos into monthly cloud backups without ever decrypting `payload`.

#### Scenario: New photo-meta doc has monthBucket
- **GIVEN** a client calling `storePhoto` with `takenAt = 2026-04-15T10:30:00Z`
- **WHEN** the resulting doc is read raw from PouchDB
- **THEN** `doc.monthBucket === "2026-04"`
- **AND** the field appears at the top level (not inside `payload`)

#### Scenario: Soft-delete preserves monthBucket
- **GIVEN** a photo-meta doc with `monthBucket: "2026-01"`
- **WHEN** the photo is soft-deleted via `deletePhoto`
- **THEN** the soft-deleted revision still has `monthBucket: "2026-01"`

#### Scenario: UTC bucketing
- **GIVEN** a `takenAt = 2026-04-30T23:30:00Z` (May 1 in CET)
- **WHEN** `storePhoto` runs
- **THEN** `monthBucket === "2026-04"` (UTC, not local)

#### Scenario: Legacy doc without monthBucket
- **GIVEN** a pre-migration photo-meta doc without `monthBucket`
- **WHEN** the server cron filters photos for a calendar month
- **THEN** the cron falls back to deriving the bucket from `updatedAt`
- **AND** a one-shot migration script CAN backfill the field via the same fallback formula
