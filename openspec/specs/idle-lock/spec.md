# idle-lock Specification

## Purpose

Clears in-memory secrets (the DEK and the JWT) after a period of user inactivity, returning the app to the unlock screen. Persistent state — the encrypted identity doc in PouchDB, the wrapped DEKs in the KeyStore — remains on disk, so the user can resume with one biometric tap without re-OAuth.

Source files: `src/sync/idle-lock.ts`.

## Requirements

### Requirement: 15-minute default timeout, configurable
The system MUST lock in memory after `timeoutMs` of no user interaction; the default MUST be 15 minutes; the value MUST be overridable at construction time.

#### Scenario: Default timeout
- GIVEN an `IdleLock` constructed without options
- WHEN no interaction occurs for 15 minutes
- THEN `onLock` fires exactly once

### Requirement: Activity events reset the timer
Timer reset events MUST include `mousedown`, `keydown`, `touchstart`, `scroll`, and `visibilitychange`.

#### Scenario: Keystroke resets timer
- GIVEN an `IdleLock` started with a 15-minute timeout
- WHEN the user presses a key 14 minutes in
- THEN the lock timer is restarted from zero

### Requirement: `onLock` clears volatile secrets
The caller's `onLock` callback is expected to stop sync, zero the DEK reference, and drop the JWT. The encrypted identity doc MUST NOT be deleted.

#### Scenario: Resume after lock
- GIVEN a vault that has auto-locked
- WHEN the user returns and taps to unlock with their passkey
- THEN the DEK is re-derived via PRF
- AND the encrypted `_local/server-identity` doc is decrypted to recover the refresh token
- AND sync resumes without OAuth

### Requirement: Safe stop + idempotence
`stop()` MUST be safe to call when the lock was never started and when already stopped; `start()` MUST be idempotent.

#### Scenario: Double start, double stop
- GIVEN a new `IdleLock`
- WHEN `start()` is called twice then `stop()` twice
- THEN no listeners are left attached
