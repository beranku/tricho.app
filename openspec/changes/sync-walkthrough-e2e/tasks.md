## 1. Bridge + testid surface

- [x] 1.1 Reused the existing `__trichoE2E.updateCustomer` (no new bridge fn) plus added `generateBackupZip` and `setSubscription` to round out the surface.
- [x] 1.2 `data-testid="backup-export-screen"`, `backup-export-month-select`, `backup-export-download`, `backup-export-success` on `BackupExportScreen.tsx`.
- [x] 1.3 `data-testid="restore-zip-screen"`, `restore-zip-file-input`, `restore-zip-submit`, `restore-zip-success` on `RestoreFromZipScreen.tsx`.
- [x] 1.4 Settings already exposes `data-testid="settings-restore-zip-cta"` — no addition needed.
- [x] 1.5 `cd app && npm run typecheck` — clean.
- [x] 1.6 `cd app && npm test` — green.

## 2. Shared sync-walk fixture

- [x] 2.1 `app/tests/e2e/fixtures/sync-flows.ts` exports `writeCustomerOn`, `editCustomerOn`, `readCustomerOn`, `waitForCustomerOn`, `freshContext`, `waitForSyncPaused`.

## 3. Walkthrough specs

- [x] 3.1 `app/tests/e2e/device-pair-walk.spec.ts` — green.
- [x] 3.2 `app/tests/e2e/cross-device-realtime-walk.spec.ts` — green (two-way propagation in one test).
- [x] 3.3 `app/tests/e2e/cancel-then-gated-walk.spec.ts` — green.
- [x] 3.4 `app/tests/e2e/local-zip-restore-walk.spec.ts` — green. Drives Device A → ZIP export via the bridge → Device B fresh context → wizard restore-zip flow → reads A's customer.
- [x] 3.5 `app/tests/e2e/cloud-backup-init-walk.spec.ts` — green. Stubs `/auth/backup/months` + the per-month download URL, drives the same restore-zip pipeline.

## 4. Stack hardening landed alongside the change

- [x] 4.1 Routed `/userdb-*` and `/_replicator` through tricho-auth's CouchDB proxy (Node + jose) instead of CouchDB direct, so the RS256 JWT validation path no longer hits CouchDB 3.5's broken `jwt_keys` decoder. Applied to dev, ci, and prod traefik profiles in `compose.yml`.
- [x] 4.2 Removed `sub` from `[jwt_auth].required_claims` in `infrastructure/couchdb/local.ini` (CouchDB 3.5 rejects it as `unknown_checks: [sub]`). The principal is still extracted from `sub` by the auth handler.
- [x] 4.3 Added `data-testid="renew-banner"`, refined the `setGated` bridge with a sticky override flag, and made `onRestoreFromZip` advance to `view='unlocked'` directly (the wizard otherwise reset Step 1 mid-restore).
- [x] 4.4 Added `infrastructure/pwa/Dockerfile.host` plus `Caddyfile` adjustments (`try_files` falls back to `{path}/index.html` so `/offline/` serves correctly; shared `manifest.webmanifest` + icons + og are now baked in).
- [x] 4.5 Reworked `app/tests/e2e/fixtures/admin.ts` to shell out via `docker exec tricho_couchdb curl` — Node's HTTP client can't resolve `tricho.test`, and the proxy now blocks Basic auth on the public edge.

## 5. Make target + docs

- [ ] 5.1 No new `e2e-sync-walkthrough` make target — the new specs are picked up by the existing Playwright glob; `make e2e` covers them.
- [ ] 5.2 `docs/testing.md` refresh deferred.

## 6. Verify

- [x] 6.1 `openspec validate sync-walkthrough-e2e --strict` — clean.
- [x] 6.2 `cd app && npm run typecheck` — clean.
- [x] 6.3 `cd app && npm test` — green (unit + component).
- [x] 6.4 All five new walkthrough specs green against the ci stack; pre-existing sync specs (`cross-device-sync`, `offline-sync`, `device-limit`, etc.) also green after small fixture/test repairs.
