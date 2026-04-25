## ADDED Requirements

### Requirement: Sign-in probes for an existing vault on the server
On sign-in, when the device has no local vault but holds an OAuth identity (a valid `couchdbUsername` + JWT), the client SHALL probe the per-user CouchDB for a `vault-state` document via an authenticated HTTP GET against `<couchdbUrl>/userdb-<hex(username)>/vault-state`. The probe SHALL NOT require an open PouchDB or a derived DEK. The result MUST drive routing as follows:

- 200 with a `vault-state` document → route to a join-vault flow that prompts for the Recovery Secret and unwraps the DEK locally.
- 404 (or any non-success status) → fall through to the existing create-vault flow.

The probe MUST NOT silently retry, MUST NOT block sign-in beyond a short timeout (≤ 5 s), and MUST log probe failures to the console for diagnostics.

#### Scenario: Existing user signs in on a new device
- **GIVEN** the user has a `vault-state` doc in their per-user CouchDB (Device 1 already uploaded it)
- **AND** the user signs in on Device 2 which has no local vault
- **WHEN** the sign-in flow completes and the AppShell mounts
- **THEN** the probe returns 200 with the `vault-state` doc
- **AND** the UI routes to the join-vault flow, NOT the create-vault flow

#### Scenario: Brand-new user signs in for the first time
- **GIVEN** a user who has never used TrichoApp on any device
- **WHEN** they sign in
- **THEN** the probe returns 404
- **AND** the UI routes to the create-vault flow

#### Scenario: Probe failure does not block sign-in
- **GIVEN** a user with no local vault and a transient CouchDB outage
- **WHEN** they sign in
- **THEN** the probe fails (timeout or network error)
- **AND** the AppShell logs the failure to the console
- **AND** the UI routes to the create-vault flow (matching the brand-new-user behavior; the user can re-attempt by reloading once CouchDB is back)

### Requirement: Join-vault flow uses RS only and never silently falls through to create-vault
When the user has been routed to the join-vault flow, a wrong Recovery Secret MUST surface a user-visible error and MUST NOT route the user back to the create-vault flow. Forking the user's data into a parallel vault on a wrong-RS event would be a silent data-divergence bug; the join flow MUST refuse the unlock and let the user retry or back out.

#### Scenario: Wrong RS surfaces an error and stays on the join screen
- **GIVEN** the join-vault flow is showing and the user has typed an RS that does not unwrap the server-side `wrappedDekRs`
- **WHEN** the unwrap fails with an AEAD error
- **THEN** the join screen shows a user-visible error
- **AND** the screen stays on join-vault — it does not transition to create-vault

#### Scenario: User can back out of join-vault to OAuth
- **GIVEN** the join-vault flow is showing
- **WHEN** the user explicitly chooses to sign out / start over
- **THEN** the OAuth result is cleared and the user returns to the OAuth screen
- **AND** no local vault has been created
