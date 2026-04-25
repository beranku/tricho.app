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
The PouchDB remote MUST be constructed with a custom `fetch` that attaches `Authorization: Bearer <jwt>` to every request. On `401`, the fetch MUST trigger one transparent token refresh and retry once. On `402`, the fetch MUST throw a typed `PlanExpiredError` carrying `{paidUntil, gracePeriodEndsAt, reason}` and MUST NOT retry; the AppShell catches the error and routes the user to the Plan screen.

#### Scenario: Silent refresh on 401
- GIVEN a mid-sync request that returns `401` because the JWT expired
- WHEN the override `fetch` retries after calling the token store's refresh
- THEN the retry carries a fresh JWT
- AND the user sees no interruption

#### Scenario: 402 stops sync and routes to Plan screen
- GIVEN a sync request that returns `402 plan_expired`
- WHEN the override `fetch` runs
- THEN it throws `PlanExpiredError`
- AND no retry is attempted
- AND the AppShell receives the error and navigates to the Plan screen

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

### Requirement: Entitlement gate at the edge of CouchDB
Every request to `/userdb-*/*` MUST pass through `tricho-auth`'s entitlement proxy. The proxy MUST validate the bearer JWT, look up the caller's subscription, and forward to CouchDB iff `entitlements.includes("sync")` AND `paidUntil >= now() - gracePeriodSeconds`. Otherwise, the proxy MUST return `402 plan_expired` with body `{error: "plan_expired", reason: "sync_entitlement_missing", paidUntil, gracePeriodEndsAt}`.

#### Scenario: Free user blocked at the proxy
- GIVEN a free user holding a valid JWT
- WHEN they make a `GET /userdb-<hex>/_changes` request
- THEN the proxy returns `402`
- AND the request never reaches CouchDB

#### Scenario: Paid user passes through
- GIVEN a paid user with active entitlements
- WHEN they make a sync request
- THEN the proxy forwards to CouchDB and returns CouchDB's response unchanged

#### Scenario: Paid user in grace window passes through with banner header
- GIVEN a paid user with `paidUntil = now() - 2 * 86400`, in 7-day grace
- WHEN they make a sync request
- THEN the proxy forwards to CouchDB
- AND the proxy adds a `tricho-grace-ends-at` header with the grace-window deadline
- AND the client surfaces a renewal banner

### Requirement: Cancel sync on 402
On receiving a `PlanExpiredError`, the sync state machine MUST transition to a new `gated` state, MUST NOT auto-retry, and MUST stop background polling until the user explicitly resumes (typically after re-paying). The local PouchDB MUST be left intact — no data is deleted on entitlement loss.

#### Scenario: Plan expired transitions sync to gated
- GIVEN an active sync
- WHEN a `_changes` request returns `402 plan_expired`
- THEN `getSyncState().status === "gated"`
- AND no further sync requests fire from that session

#### Scenario: Local data preserved when sync gates
- GIVEN a paid user whose plan just expired beyond grace
- WHEN sync transitions to `gated`
- THEN PouchDB on the device retains all customer / appointment / photo docs
- AND the client can continue to read and write locally

#### Scenario: Resume on re-pay
- GIVEN a `gated` sync state and a successful re-payment
- WHEN the client receives the updated subscription via `GET /auth/subscription`
- AND the user explicitly taps "Resume sync"
- THEN sync transitions to `connecting` and resumes

