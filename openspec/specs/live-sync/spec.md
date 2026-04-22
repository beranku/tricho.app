# live-sync Specification

## Purpose

Continuous bi-directional replication between the device's PouchDB and the user's per-user CouchDB database, with built-in retry across offline/online transitions and a deterministic conflict resolver. Uses PouchDB's `db.sync(remote, { live: true, retry: true })` as the transport so all the checkpoint and restart work stays inside the library.

Source files: `src/sync/couch.ts`, `src/sync/couch-auth.ts`.

## Requirements

### Requirement: Live continuous sync with retry
`startSync` MUST call `db.sync(remote, { live: true, retry: true })` so replication runs until cancelled and automatically resumes after network interruptions.

#### Scenario: Offline → online resume
- GIVEN an active sync
- WHEN the network drops for 60 seconds and then recovers
- THEN sync resumes without explicit intervention
- AND the state machine reports `paused` while offline and `syncing` after recovery

### Requirement: Visible state machine
The sync state MUST be one of `idle | connecting | syncing | paused | error`; the state and an `error: string | null` MUST be observable via `subscribeSyncEvents`.

#### Scenario: UI reflects current state
- GIVEN a subscriber registered via `subscribeSyncEvents`
- WHEN the replication transitions between states
- THEN the subscriber receives a callback with the new state

### Requirement: Bearer JWT on every request
The PouchDB remote MUST be constructed with a custom `fetch` that attaches `Authorization: Bearer <jwt>` to every request. On 401, the fetch MUST trigger one transparent token refresh and retry once.

#### Scenario: Silent refresh on 401
- GIVEN a mid-sync request that returns 401 because the JWT expired
- WHEN the override `fetch` retries after calling the token store's refresh
- THEN the retry carries a fresh JWT
- AND the user sees no interruption

### Requirement: Deterministic newest-wins conflict resolution
When a document has `_conflicts`, the resolver MUST keep the revision with the largest `updatedAt` and soft-delete the losing revisions.

#### Scenario: Two offline writes converge
- GIVEN Device A and Device B offline, both write to doc X
- WHEN both reconnect and sync
- THEN the revision with the larger `updatedAt` becomes the current revision
- AND the other revisions are soft-deleted

### Requirement: Ciphertext is never merged semantically
Because payloads are opaque AEAD ciphertext, the resolver MUST NOT attempt field-level merge; it MUST pick one whole revision.

#### Scenario: No partial merge
- GIVEN two divergent revisions of a customer doc
- WHEN the resolver runs
- THEN exactly one of the two payloads survives, unmodified

### Requirement: Stop cancels the replication and resets state
`stopSync` MUST cancel the in-flight replication and transition the state to `idle`.

#### Scenario: Teardown
- GIVEN an active sync
- WHEN `stopSync` is called
- THEN no further `change`/`paused`/`active` events fire from that session
- AND `getSyncState().status === 'idle'`
