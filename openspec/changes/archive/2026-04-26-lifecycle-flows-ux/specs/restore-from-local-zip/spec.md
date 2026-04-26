## ADDED Requirements

### Requirement: ZIP restore is reachable both pre-unlock and post-unlock

The application SHALL provide two entry points to the ZIP restore surface:

1. **Pre-unlock**, as a Step 3 sub-flow of the welcome wizard, available when `flow="restore-zip"` is selected.
2. **Post-unlock**, as a Settings entry "Obnovit ze zálohy" → routes to `view: 'restore-zip'`.

Both entry points MUST mount the same `RestoreFromZipScreen` component with the same `onBack` and `onRestored` semantics. The `view: 'restore-zip'` enum value in `AppShell.tsx` MUST be reachable via at least one `setView('restore-zip')` call.

#### Scenario: Settings entry routes to restore-zip view
- **GIVEN** the user is `view === 'unlocked'` with the Settings sheet open
- **WHEN** the user taps "Obnovit ze zálohy"
- **THEN** `view === 'restore-zip'`
- **AND** the `RestoreFromZipScreen` is rendered with the current `db` and `vaultId` props

#### Scenario: Welcome wizard restore-zip flow reaches the restore surface
- **GIVEN** the user is on Step 3 of the welcome wizard with `flow="restore-zip"` selected
- **WHEN** the user advances past `pick-zip` and `verify-rs` substeps
- **THEN** `RestoreFromZipScreen` is mounted with the freshly-created vault's `db` and `vaultId`

### Requirement: Pre-unlock restore creates a vault from RS before applying ZIP bytes

The pre-unlock ZIP restore flow MUST first create or join a vault using the Recovery Secret (the existing `flow="existing"` server-vault-state path or, if no server state, the `flow="new"` create path with the user-provided RS) and only then write the ZIP-derived docs into that vault's PouchDB. The application MUST NOT attempt to import ZIP docs into a vault that has not been keyed; the AAD on each doc payload requires `vaultId` to be known.

#### Scenario: Restoring from ZIP with no server state requires the original RS
- **GIVEN** a brand-new device with no `tricho-keystore`, no server `vault-state`, and a `.tricho-backup.zip` file from a previous device
- **WHEN** the user picks the ZIP and provides the original RS
- **THEN** a new local `vault-state` is created with `vaultId` matching the ZIP's `vault-state.json`
- **AND** the ZIP's docs are written into the new vault
- **AND** the user is then routed to the WebAuthn (or PIN-setup) substep to register a daily unlock for this device

#### Scenario: ZIP vault-id mismatch is rejected
- **GIVEN** an in-progress restore where the ZIP's `manifest.json` has `vaultId: "vault-A"` but the current vault is `vault-B`
- **WHEN** `restoreFromZipBytes` runs
- **THEN** `VaultIdMismatchError` is raised
- **AND** the user sees a humanised error "Tahle záloha patří jinému trezoru."
- **AND** no docs are written

### Requirement: User-visible restore summary

After a successful restore, the surface MUST display a friendly summary: how many documents were applied, the `monthKey` of the snapshot, the time elapsed, and a single primary CTA. The summary MUST mention the original device hint when present in the ZIP manifest's `source` and `generatedAt` fields.

#### Scenario: Successful restore shows summary
- **GIVEN** a successful `restoreFromZipBytes` returning `{appliedDocs: 312, appliedPhotos: 47, manifest: {monthKey: "2026-04", generatedAt: 1714000000000, source: "client"}}`
- **WHEN** the surface renders the success state
- **THEN** the user sees "Obnoveno 359 záznamů z dubna 2026."
- **AND** the timestamp is rendered relative to "now" (e.g. "stáhnuto před 3 dny")
- **AND** a single primary button "Otevřít aplikaci" is the only action

### Requirement: Multi-month restore is opt-in and visible

When the user picks multiple ZIP files (e.g. one per month for a year of history), the surface MUST list the picked files with month, doc count, and total bytes BEFORE the restore action runs. The user MUST explicitly confirm the multi-month restore. The restore MUST run sequentially in chronological order (oldest first) and MUST roll back the entire batch if any file fails to apply.

#### Scenario: Picking three months previews all three
- **GIVEN** the user has picked `2026-02.tricho-backup.zip`, `2026-03.tricho-backup.zip`, `2026-04.tricho-backup.zip`
- **WHEN** the picker reads the files
- **THEN** the surface lists all three rows with month label, doc count, photo count, byte size
- **AND** the action button label reflects the multi-file restore ("Obnovit 3 měsíce")

#### Scenario: Mid-batch failure rolls back
- **GIVEN** a multi-month restore where the second of three files raises `IncompatibleBackupVersionError`
- **WHEN** the failure is detected
- **THEN** the docs from the first file are reverted (soft-delete or revision rollback)
- **AND** no docs from the second or third file are applied
- **AND** the user sees an alert "Záloha je z novější verze aplikace. Aktualizuj aplikaci a zkus to znovu."

### Requirement: Restore surface forbids ambiguous file types

The file picker MUST accept only `.zip` and `.tricho-backup.zip` filenames. Any other extension MUST be silently filtered out at pick time. If, after filtering, zero files remain, the user MUST see a hint "Vyber soubor končící .tricho-backup.zip" and the action button MUST stay disabled.

#### Scenario: Picking a JSON file is silently filtered
- **GIVEN** the user picks both `april.tricho-backup.zip` and `notes.json`
- **WHEN** the picker reads `e.target.files`
- **THEN** only `april.tricho-backup.zip` is accepted into the staged list
- **AND** `notes.json` is not visible in the surface

#### Scenario: Picking only an unrelated file shows the hint
- **GIVEN** the user picks `notes.json` (no other files)
- **WHEN** the picker reads the file list
- **THEN** the staged list is empty
- **AND** the hint "Vyber soubor končící .tricho-backup.zip" is rendered
- **AND** the action button is disabled
