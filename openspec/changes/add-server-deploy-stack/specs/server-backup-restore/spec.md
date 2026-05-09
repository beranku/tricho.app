## ADDED Requirements

### Requirement: Daily encrypted off-site backup via restic

The deploy host MUST run a daily host-side cron job (NOT inside any container) that backs up `/srv/tricho/<env>/couchdb/data/` for every deployed environment AND `/srv/tricho/edge/acme/` to an off-site repository (Backblaze B2, rsync.net, or a functionally equivalent provider). The backup tool MUST be `restic` invoked with a host-local password file at `/etc/tricho/restic.pw` (mode `0600`, owned by root). Restic MUST encrypt at rest using its default xchacha20-poly1305; the destination MUST be reached over TLS. The cron schedule MUST keep the restic password file out of process arguments and out of any log destination — `restic` MUST be invoked with `--password-file`, never `--password-command` that echoes, never via env-var inlined in `bash -c`.

#### Scenario: A daily snapshot exists

- **GIVEN** a deploy host that has been running for >24 hours
- **WHEN** the operator runs `restic --repo <repo> --password-file /etc/tricho/restic.pw snapshots`
- **THEN** the listing contains at least one snapshot from the past 26 hours
- **AND** the snapshot's `paths` field includes the CouchDB data path for every deployed environment

#### Scenario: Backup contents are encrypted

- **GIVEN** an attacker who obtains the off-site repository contents (e.g., compromised B2 credentials) but NOT the restic password
- **WHEN** they attempt to read any data file
- **THEN** all files are encrypted; no plaintext metadata is recoverable
- **AND** `vaultId`, `docId`, `_users` table contents, OAuth `sub` values, and CouchDB `local.ini` admin hash are not legible

#### Scenario: Snapshots failing to upload alert the operator

- **GIVEN** the restic destination is unreachable (network outage, expired credential)
- **WHEN** the daily cron runs and the upload fails
- **THEN** the cron exits non-zero
- **AND** the operator receives a notification (email or Telegram via the project's existing channel) within one business day

### Requirement: Backup retention policy holds at least 30 daily, 12 monthly snapshots

The restic repository MUST be configured with a `forget --prune` policy that retains at least 30 daily snapshots, 12 monthly snapshots, and 2 yearly snapshots. The policy MUST run as part of the daily backup job (after the snapshot upload). The policy MUST NOT delete snapshots produced by the monthly restore drill until they are at least 7 days old.

#### Scenario: A 25-day-old snapshot still exists

- **GIVEN** a deploy host with daily backups running uninterrupted for 60 days
- **WHEN** the operator lists snapshots and filters to >25 days old, <30 days old
- **THEN** at least one snapshot is present in that window

#### Scenario: A 13-month-old snapshot is still pruned to one per month

- **GIVEN** 60 daily snapshots over 60 consecutive days
- **WHEN** the policy is applied
- **THEN** snapshots beyond 30 days are reduced to one per month
- **AND** snapshots within 30 days are preserved daily

### Requirement: Backups MUST be acknowledged as containing sensitive plaintext metadata

The runbook (`docs/server-deploy.md`) and the backup script's header comment MUST explicitly state that the backup contains plaintext metadata — `vaultId`, `docId`, OAuth `sub` claims, the CouchDB `_users` table, sizes, revision counts — even though user payloads are ciphertext. The runbook MUST treat the restic password and the off-site credentials as material with the same sensitivity as the SOPS age private keys: stored only on the deploy host, mode `0600`, root-owned, never committed, never echoed to any log.

#### Scenario: Runbook explicitly classifies backup sensitivity

- **GIVEN** `docs/server-deploy.md`
- **WHEN** a reader searches for the section about backup sensitivity
- **THEN** a clearly labeled section explains that backups contain plaintext metadata and MUST be treated as sensitive
- **AND** the section explicitly disclaims the project's "zero-knowledge" claim as applying to payload bodies, not metadata

### Requirement: Monthly automated restore drill validates backups

The deploy host MUST run a monthly cron job that automatically validates restorability:

1. Spin up a throwaway compose project with `COMPOSE_PROJECT_NAME=tricho-restoretest` from `infrastructure/server/sync/compose.yml`.
2. Restore the most recent restic snapshot of `tricho-sync-prod`'s CouchDB data into the throwaway project's data path.
3. Start CouchDB in the throwaway project; query `/_up`, `/_all_dbs`, and a representative `/userdb-<hex>/_design/...` view to confirm internal integrity.
4. Tear down the throwaway project and delete its data.
5. On any failure, alert the operator via the project's notification channel.

The drill MUST run on the same host as production but in a way that cannot interfere with `tricho-sync-prod` or `tricho-sync-dev` (different `COMPOSE_PROJECT_NAME`, different data path under `/srv/tricho/restoretest/...`, no Traefik labels).

#### Scenario: Drill green-path completes within 30 minutes

- **GIVEN** a fresh monthly drill on a host with the typical CouchDB data size
- **WHEN** the cron starts
- **THEN** the throwaway project comes up, validates, and tears down in ≤30 minutes
- **AND** no container, volume, or network from the throwaway project remains afterwards
- **AND** `tricho-sync-prod` and `tricho-sync-dev` were untouched throughout

#### Scenario: Drill detects a corrupt snapshot

- **GIVEN** a corrupted (or partial-upload) restic snapshot promoted to "most recent"
- **WHEN** the drill restores and starts CouchDB
- **THEN** CouchDB fails to reach `/_up=200` within the timeout
- **AND** the cron exits non-zero
- **AND** the operator receives an alert that names the failing snapshot ID
- **AND** the existing production snapshot retention is unaffected

#### Scenario: Drill cannot reach into the production project

- **GIVEN** the drill running its compose project
- **WHEN** the operator inspects the drill's network and volume binds
- **THEN** no `tricho-sync-prod`-prefixed network or volume is referenced
- **AND** no host path under `/srv/tricho/prod/` is mounted into any drill container

### Requirement: Optional CouchDB replication target as a warm-standby (defer-permitted)

The capability SHOULD support, but is not required to implement in v1, a continuous CouchDB `_replicator`-driven one-way replication from each production CouchDB to a warm-standby host. When implemented, the standby MUST be reachable only from the production host's IP (firewalled), MUST run the same `tricho-auth`-fronted topology so payloads remain ciphertext + entitlement-gated, and MUST NOT be reachable from the public internet. When NOT implemented in v1, the runbook MUST document this as an explicit gap and reference the recovery RPO that restic alone provides.

#### Scenario: Replication target, when present, is firewalled

- **GIVEN** a deployed warm-standby
- **WHEN** an external client attempts a TCP connection to the standby's CouchDB port
- **THEN** the connection is refused (or dropped) before TLS negotiation
- **AND** only the production host's IP appears in the firewall allowlist

#### Scenario: Without replication, the runbook makes the gap visible

- **GIVEN** v1 ships without a warm-standby
- **WHEN** the operator reads `docs/server-deploy.md`
- **THEN** a section names the absence of replication
- **AND** the recovery RPO with restic alone (≤24 h) is stated explicitly
- **AND** the conditions under which the operator should consider adding the standby are listed
