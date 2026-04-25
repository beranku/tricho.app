## ADDED Requirements

### Requirement: Photo monthBucket plaintext field
Photo-meta docs MUST carry a top-level plaintext `monthBucket: "YYYY-MM"` field set at first write from `takenAt` (UTC). The field MUST NOT change on subsequent edits or soft-deletes. Legacy docs missing the field MUST be backfillable from `updatedAt` via the one-shot migration script.

#### Scenario: storePhoto sets monthBucket from takenAt UTC
- **GIVEN** a client calling `storePhoto({takenAt: 2026-04-15T10:30:00Z})`
- **WHEN** the resulting PouchDB doc is read (raw, before decryption)
- **THEN** the top-level field `monthBucket === "2026-04"`
- **AND** the field is plaintext (visible to the server on sync)

#### Scenario: takenAt at month boundary uses UTC, not local
- **GIVEN** `takenAt = 2026-04-30T23:30:00Z` (which is May 1 in CET)
- **WHEN** `storePhoto` runs
- **THEN** `monthBucket === "2026-04"` (UTC bucketing, not local)

#### Scenario: soft-delete preserves monthBucket
- **GIVEN** an existing photo doc with `monthBucket: "2026-01"`
- **WHEN** the user soft-deletes the photo
- **THEN** the soft-deleted doc still has `monthBucket: "2026-01"`

### Requirement: Server-side daily snapshot job
A daily server-side cron MUST iterate paid users and produce a `.tricho-backup.zip` per (user, current-month). The job:
1. Reads `userdb-<hex>` via admin auth with `_all_docs?include_docs=true&attachments=true`.
2. Filters: skip `_local/` and `_design/`; keep all non-photo docs; keep photo-meta docs only when `monthBucket === currentMonth`.
3. Composes a ZIP via the shared composer (no decrypt).
4. On the 1st day of a new month, additionally re-snapshots and finalizes the previous month.
5. Applies retention: drop snapshots older than the user's `backupRetentionMonths`.

#### Scenario: Cron snapshots only the current month's photos
- **GIVEN** a paid user with photos in March, April, and May 2026
- **WHEN** the cron runs on 2026-04-15
- **THEN** the resulting `2026-04.tricho-backup.zip` contains only April photos plus all non-photo docs
- **AND** no March or May photos are in the ZIP

#### Scenario: Cron is idempotent
- **GIVEN** the cron has run once for `now = 2026-04-15`
- **WHEN** the cron runs again with the same `now`
- **THEN** the resulting state matches the first run (same blob bytes, same manifest)
- **AND** retention has not pruned any month it kept on the first pass

#### Scenario: Cron finalizes previous month on the 1st
- **GIVEN** the cron runs on 2026-05-01
- **WHEN** the run completes
- **THEN** a snapshot for `2026-04` exists with `finalized: true`
- **AND** a fresh draft for `2026-05` exists with `finalized: false`

#### Scenario: Free users skipped
- **GIVEN** a free user
- **WHEN** the cron iterates subscriptions
- **THEN** no monthly-backup doc is created for that user

### Requirement: Bytes-as-is invariant
The backup composition path (server and client) MUST NOT decrypt any payload or attachment. The on-disk encrypted shape (`payload` ciphertext + `_attachments` raw bytes) is copied 1:1 into the ZIP. AAD bindings on individual docs (`{vaultId, docId}` from `payload-encryption`) are the only integrity guarantee.

#### Scenario: ZIP contains no plaintext customer data
- **GIVEN** a user with a customer named "PavlinaUnique" in encrypted plaintext
- **WHEN** any backup ZIP (server or client) is produced for that user
- **THEN** scanning the ZIP bytes for "PavlinaUnique" returns no match

#### Scenario: Attachment bytes pass through unchanged
- **GIVEN** a photo with attachment ciphertext bytes B
- **WHEN** the backup ZIP is produced and the attachment file is extracted
- **THEN** the extracted bytes equal B byte-for-byte

### Requirement: Shared ZIP byte format
A shared ZIP byte format MUST be used for both server-produced cloud backups and client-produced local exports. The ZIP MUST contain:
- `manifest.json` — `{version: "1", vaultId, monthKey, generatedAt, source: "client"|"server", docCount, photoCount, attachmentCount}`
- `vault-state.json` — verbatim copy of the local `_local/vault-state` doc (without `_rev`)
- `docs.ndjson` — non-photo replicating docs, one per line, in wire shape
- `photos.ndjson` — photo-meta docs filtered to `monthKey`, one per line, in wire shape
- `attachments/<docId>/<name>.bin` — raw attachment bytes per doc

For identical logical inputs, the server-side composer and the client-side composer MUST produce byte-identical ZIPs (same compression, same fixed file timestamps, same NDJSON ordering).

#### Scenario: Client and server produce identical ZIPs for identical input
- **GIVEN** the same set of doc rows + photo rows + attachments + manifest
- **WHEN** server cron and client local-export each compose a ZIP
- **THEN** the resulting bytes are byte-identical

#### Scenario: Manifest includes source field
- **GIVEN** a server-produced ZIP
- **WHEN** the manifest is read
- **THEN** `manifest.source === "server"`
- **AND** for a client-produced ZIP `manifest.source === "client"`

### Requirement: Cloud monthly endpoints
`GET /auth/backup/months` MUST return the caller's month list (always allowed; free users get whatever was previously generated). `GET /auth/backup/months/:yyyy-mm` MUST stream the ZIP, gated on `entitlements.includes("backup")`.

#### Scenario: List endpoint returns months newest-first
- **GIVEN** a paid user with snapshots for 2026-01..2026-04
- **WHEN** they `GET /auth/backup/months`
- **THEN** the response is `200`
- **AND** months are sorted newest-first by monthKey

#### Scenario: Free user can list (recovery surface) but not download
- **GIVEN** a free user with prior cloud snapshots from a previous paid period
- **WHEN** they `GET /auth/backup/months`
- **THEN** the response is `200` with the manifest list
- **WHEN** they `GET /auth/backup/months/2025-08`
- **THEN** the response is `402 plan_expired`

#### Scenario: Paid user downloads a ZIP
- **GIVEN** a paid user with `entitlements: ["sync","backup"]` and snapshot `2026-04`
- **WHEN** they `GET /auth/backup/months/2026-04`
- **THEN** the response is `200 application/zip`
- **AND** the body is the cloud-produced ZIP

#### Scenario: Wrong owner blocked
- **GIVEN** a user requesting another user's monthKey
- **WHEN** the request runs
- **THEN** the response is `404` (presence-hiding)

### Requirement: Local ZIP export available to all users
The client MUST expose a `generateLocalBackupZip({db, vaultId, monthKey})` API that produces the shared ZIP format from local PouchDB without server interaction. The Plan screen and Settings MUST surface a UI entry point for this regardless of subscription tier (including free).

#### Scenario: Free user can pack a local ZIP
- **GIVEN** a free user with local data in 2026-04
- **WHEN** they invoke "Download local backup" for `2026-04`
- **THEN** a ZIP file is produced and a download is triggered
- **AND** no network call is required to compose the ZIP

#### Scenario: Local ZIP composer never decrypts
- **GIVEN** a customer doc with plaintext name "PavlinaUnique" in `data.firstName`
- **WHEN** `generateLocalBackupZip` runs
- **THEN** "PavlinaUnique" does NOT appear in the resulting ZIP bytes

### Requirement: Retention by tier
`applyMonthlyRetention(manifests, retentionMonths)` MUST keep the newest `retentionMonths` snapshots and return the older monthKeys for deletion. The cron MUST apply retention after every run.

#### Scenario: Pro user retains 12 months
- **GIVEN** a pro user with 14 monthly snapshots
- **WHEN** retention runs with `retentionMonths = 12`
- **THEN** the 2 oldest snapshots are returned for deletion
- **AND** the 12 newest are retained

#### Scenario: Max user retains 60 months
- **GIVEN** a max user with 65 monthly snapshots
- **WHEN** retention runs with `retentionMonths = 60`
- **THEN** the 5 oldest are returned for deletion

### Requirement: Restore is a single code path
`restoreFromZipBytes(opts)` MUST accept ZIP bytes from any source (local file picker or cloud download). The function MUST:
1. Validate manifest version. Throw `IncompatibleBackupVersionError` on mismatch.
2. Validate `vaultId` against `expectedVaultId`. Throw `VaultIdMismatchError` on mismatch.
3. Optionally restore `_local/vault-state` if the local DB is missing it.
4. Replay docs newest-wins: a local doc with strictly higher `updatedAt` survives a backup row.
5. Re-attach raw encrypted attachment bytes to their docs.

The function MUST NOT decrypt any doc payload — restore writes the same encrypted shape into PouchDB that lives there during normal sync. Decryption happens lazily on subsequent reads.

#### Scenario: Restore round-trips a customer doc
- **GIVEN** a vault with `customer:1` and a generated ZIP
- **WHEN** the vault is wiped and the ZIP is restored
- **THEN** `customer:1` is in PouchDB with the same `payload`

#### Scenario: Newest-wins on restore
- **GIVEN** a local doc `customer:1` with `updatedAt = 9999`
- **AND** a backup row for `customer:1` with `updatedAt = 100`
- **WHEN** restore runs
- **THEN** the local version is preserved
- **AND** the report shows `skippedNewerLocal === 1`

#### Scenario: VaultIdMismatchError on cross-vault import
- **GIVEN** a backup ZIP with `manifest.vaultId === "v1"`
- **WHEN** restore runs with `expectedVaultId === "v2"`
- **THEN** a `VaultIdMismatchError` is thrown
- **AND** PouchDB is not modified
