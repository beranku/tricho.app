# sync-walkthrough-e2e

## Why

The e2e suite already covers individual sync primitives (`cross-device-sync.spec.ts`, `offline-sync.spec.ts`, `device-limit.spec.ts`, `local-backup-zip.spec.ts`) but does not exercise the user-shaped *journeys* that string those primitives together. Sister change `subscription-walkthrough-e2e` did this for billing UI; this change does the same for sync — the second leg of Tricho's value proposition.

Five scenarios are missing as runnable specs:

1. **Device pairing first-run walk** — Device A creates a vault; Device B joins with the same RS; both reach the unlocked shell and observe each other.
2. **Real-time edit propagation** — A change on A reaches B and a change on B reaches A within the sync timeout.
3. **Cancel → grace-expiry → sync gates** — A paid user cancels; the server flips to expired-past-grace; the next sync cycle surfaces `GatedSheet` (not silent failure).
4. **Local ZIP → fresh-device restore** — Device A exports a `.tricho-backup.zip`; Device B with no server vault restores from it via the wizard's restore-zip flow and reads the imported customer.
5. **Cloud backup → fresh-device init** — A paid user lists `/auth/backup/months`, downloads a month, and the same restore surface accepts those bytes.

Without these walks, regressions in the *seam* between auth, sync, and the encrypted-backup capability slip past per-primitive tests.

## What Changes

- **e2e-testing capability** gains five named walkthroughs as MUST-have specs. Each lists the participating modules and the success criteria.
- **AppShell `__trichoE2E` bridge** gains read-side hooks: `getCustomer(id)` already exists; add `editCustomer(id, patch)` so the realtime spec can flip a doc on a specific device. Already-present `subscribeSyncEvents` is reused.
- **Test-surface testids** added to `BackupExportScreen.tsx` and `RestoreFromZipScreen.tsx` so the walks don't depend on Czech copy.
- **Optional admin endpoint** `POST /auth/billing/admin/run-backup-cron` (gated on `BILLING_ADMIN_TOKEN`) so the cloud-backup walk can deterministically materialise a month without sleeping for the daily cron. If the endpoint already exists, this change is a no-op for tricho-auth.

No behavioural changes to production code — the AppShell bridge additions remain gated on `localStorage['tricho-e2e-bridge'] === '1'`, the testids are inert, and the admin endpoint is gated on the same token already used by the bank-transfer admin path.

## Impact

- Affected specs: `e2e-testing` (additions only).
- Affected source: `app/src/components/AppShell.tsx`, `app/src/components/BackupExportScreen.tsx`, `app/src/components/RestoreFromZipScreen.tsx`, optionally `infrastructure/couchdb/tricho-auth/routes.mjs` + `billing/backup-cron.mjs`.
- New files: `app/tests/e2e/device-pair-walk.spec.ts`, `cross-device-realtime-walk.spec.ts`, `cancel-then-gated-walk.spec.ts`, `local-zip-restore-walk.spec.ts`, `cloud-backup-init-walk.spec.ts`, plus a `app/tests/e2e/fixtures/sync-flows.ts` helper layer.
- No risk to production users: bridge + testids are gated/inert, admin endpoint is token-gated.
