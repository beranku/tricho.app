# photo-attachments Specification

## Purpose

Encrypted photo blobs stored as PouchDB attachments on the owning photo-meta document. Uses `db.putAttachment(photoId, "blob", ...)` so the attachment travels with the doc through normal replication — no separate object store, no separate upload queue. Retry, backpressure, and checkpointing are handled by PouchDB/CouchDB's native attachment-replication machinery.

Source files: `src/sync/photos.ts`, `src/sync/photos.test.ts`, `src/db/types.ts`.

## Requirements

### Requirement: Attachment name and MIME
The attachment stored on a photo-meta doc MUST be named `"blob"` and use MIME `"application/octet-stream"` so CouchDB treats it as opaque binary.

#### Scenario: Inspect an uploaded photo
- GIVEN a photo stored via `storePhoto`
- WHEN the raw doc is fetched with `?attachments=true` against CouchDB
- THEN exactly one attachment named `blob` exists on the doc
- AND its content-type is `application/octet-stream`

### Requirement: Meta doc encrypts through `payload-encryption`
The photo-meta document's `payload` MUST be the standard `envelope-crypto` ciphertext. Only the attachment binary is separately stored (and is itself already AEAD-ciphertext produced by the client before upload).

#### Scenario: Server sees two layers of opacity
- GIVEN a stored photo
- WHEN both the doc and its attachment are fetched with admin creds
- THEN `payload` is opaque AEAD ciphertext
- AND the attachment is opaque AEAD ciphertext
- AND neither is JPEG/PNG bytes directly

### Requirement: Soft-delete removes it from lists
`deletePhoto(db, id)` MUST mark the doc `deleted: true` and bump `updatedAt`. Attachment blob MAY linger until PouchDB compaction; list queries MUST exclude deleted docs.

#### Scenario: Soft-delete visibility
- GIVEN a photo returned by `listPhotoIds`
- WHEN `deletePhoto` runs
- THEN a subsequent `listPhotoIds` does not include it

### Requirement: Ride normal replication
Uploads and downloads of photo attachments MUST NOT use a separate transport. They MUST ride the `live-sync` replication so offline/online and retry are handled automatically.

#### Scenario: Offline capture
- GIVEN an offline device
- WHEN a user captures and stores a photo
- THEN the encrypted attachment is saved locally
- AND once the device comes online, it replicates via the normal sync stream
