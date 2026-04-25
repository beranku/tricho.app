# Architecture Changes — current state

Snapshot of the end-to-end-encrypted architecture on this branch. Read this before [`DEVELOPER.md`](./DEVELOPER.md); that older guide still describes the pre-v2 stack (CouchDB replication via RxDB, then Supabase).

## Tenets

- Offline-first PWA. Everything works offline; sync is opt-in.
- End-to-end encryption. The server only ever sees ciphertext.
- Recovery Secret (RS) is the durable fallback that reconstructs vault access without any server state.
- WebAuthn + PRF is the day-to-day unlock method when the authenticator supports it.

## Stack

| Concern | Implementation |
|---|---|
| Local database | **PouchDB** (`pouchdb-browser`, `pouchdb-find`) — IndexedDB-backed, lazy-loaded |
| Server database | **CouchDB 3** — one `couchdb:3` container |
| Sync transport | `db.sync(remote, { live: true, retry: true })` — continuous bi-directional replication with auto-retry |
| Per-user isolation | CouchDB `couch_peruser` — each authenticated user gets a private `userdb-<hex>` database |
| Auth | CouchDB cookie sessions (`POST /_session` → `AuthSession` cookie) |
| User provisioning | Tiny Node admin proxy (`infrastructure/couchdb/auth-proxy/server.mjs`) — the only thing holding CouchDB admin creds |
| Photo storage | CouchDB attachments on the photo-meta doc (encrypted blobs replicate with the doc) |
| Key wrapping | Dual-wrap DEK: `wrappedDekPrf` (WebAuthn PRF path) + `wrappedDekRs` (Recovery Secret path) in IndexedDB `tricho_keystore` |

## Document shape

Everything in the per-user database is of shape:

```ts
{
  _id: string,          // "<type>:<uuid>"
  _rev: string,         // PouchDB MVCC revision
  type: 'customer' | 'visit' | 'appointment' | 'photo-meta' | 'vault-state',
  updatedAt: number,    // ms since epoch, used for conflict resolution
  deleted: boolean,     // soft-delete flag
  payload: {            // opaque AES-256-GCM ciphertext
    ct: string,         // base64url
    iv: string,         // base64url
    kid: string,        // vault id (key identifier)
    v: 1,               // schema version
    aad: string,        // context used as additional-authenticated-data
  }
}
```

The only doc that deviates is `vault-state` — it holds the already-wrapped DEK directly, because the wrap is itself opaque ciphertext.

## Modules map

| Concern | Module | Lines |
|---|---|---|
| Symmetric primitives | `src/crypto/envelope.ts` | 306 |
| Document payload encryption | `src/crypto/payload.ts` | 511 |
| Vault state (dual-wrap, RS confirmation flag) | `src/db/keystore.ts` | 644 |
| PouchDB wrapper + transparent encrypt/decrypt | `src/db/pouch.ts` | 171 |
| Doc types + form validators | `src/db/types.ts` | 98 |
| RS generation / confirmation / rotation | `src/auth/recovery.ts` | 811 |
| WebAuthn passkey + PRF | `src/auth/webauthn.ts` | 133 |
| CouchDB auth + session cookies | `src/sync/couch-auth.ts` | 113 |
| Live replication + conflict resolution | `src/sync/couch.ts` | 141 |
| Multi-device vault state | `src/sync/couch-vault-state.ts` | 63 |
| Encrypted photo attachments | `src/sync/photos.ts` | 75 |
| App shell + hash router | `src/components/AppShell.tsx` | ~480 |
| Unlock / create-vault UI | `src/components/LoginScreen.tsx`, `RSConfirmation.tsx` | (unchanged) |
| Settings (sync toggle, RS rotation) | `src/components/SettingsScreen.tsx` | 135 |
| Sync state HUD | `src/components/SyncStatus.tsx` | 81 |
| Daily-schedule view (Phone A) | `src/components/islands/DailySchedule.tsx` | ~480 |
| Client-detail view (Phone B) | `src/components/islands/ClientDetail.tsx` | ~430 |
| Cam-card (encrypted photo capture) | `src/components/islands/CameraCard.tsx` | ~330 |
| Bottom-sheet nav | `src/components/islands/BottomSheet.tsx`, `MenuSheet.tsx` | ~280 |
| Pure Astro presentation | `src/components/astro/**/*.astro` | (zero-JS, SSR'd) |
| Czech formatting helpers | `src/lib/format/{date,time,duration,pluralize}.ts` | ~120 |
| Cross-island state | `src/lib/store/{theme,sheet,phoneScroll}.ts` (nanostores) | ~140 |
| Appointment domain helpers | `src/lib/appointment/{status,slots,query}.ts` | ~140 |

## Unlock flow

1. Browser loads `/` → `AppShell` hydrates, lists vault states from the KeyStore IndexedDB.
2. If a vault exists: user unlocks via passkey (PRF) or by entering the Recovery Secret.
3. PRF path: `getPrfOutput(credentialId, vaultId)` → HKDF-SHA256 with the vault's `deviceSalt` → KEK → unwrap `wrappedDekPrf` → DEK in memory.
4. RS path: user enters Base32 RS → HKDF-SHA256 with `deviceSalt` → KEK → unwrap `wrappedDekRs` → DEK in memory.
5. AppShell imports the DEK as a `CryptoKey`, opens the per-vault PouchDB via `openVaultDb(vaultId, dekKey)`, and passes the handle to the CRM/photo components.

## Sync flow

1. At vault creation, AppShell provisions a CouchDB account via the auth-proxy (`POST /provision { username, password }`) and caches the password in `sessionStorage` for subsequent logins on this device.
2. `POST /_session` gets the `AuthSession` cookie; PouchDB replication includes it by using the `fetch` override in `src/sync/couch-auth.ts` with `credentials: 'include'`.
3. `db.sync(remote, { live: true, retry: true })` runs continuously. Offline → online resumes automatically; the state machine in `src/sync/couch.ts` reflects `idle / connecting / syncing / paused / error` to the UI.
4. Conflicts: docs with `_conflicts` are resolved deterministically by picking the highest `updatedAt` revision; losers are soft-deleted. Ciphertext is opaque so we can't merge semantically.
5. Photos ride the same replication — the cipher blob is an attachment on the photo-meta doc.

## Zero-knowledge properties

- `payload` fields are AES-GCM ciphertext; the server holds no key material.
- AAD binds the ciphertext to the owning document id — a ciphertext cannot be spliced from one doc into another.
- The session cookie is the only credential the browser carries across the wire; it only lets the user access their own private `userdb-*`.
- `wrappedDekRs` travels inside a `vault-state` doc because the RS never touches the server — the wrap is useless without it.

## Running

The full stack — CouchDB, tricho-auth, Traefik, PWA — boots via a single root `compose.yml` + `Makefile`. See the root `README.md` → "Running the stack" for the authoritative walkthrough. The key entry points:

```sh
make dev         # local development behind Traefik on http://tricho.localhost
make prod-local  # production-equivalent local run (Let's Encrypt + Caddy)
make ci          # self-signed TLS + mock OIDC, for running Playwright
make e2e         # boot ci profile + run the E2E suite
```

Secrets live SOPS-encrypted under `secrets/<profile>.sops.yaml`; see `secrets/README.md` for the age-based workflow. CouchDB's JWT public key is handed over automatically via a shared Docker volume — no more manual paste into `local.ini`.

The pre-Makefile two-file compose flow (`infrastructure/couchdb/docker-compose.yml` + `infrastructure/traefik/docker-compose.yml`) stays functional during rollout but is deprecated; READMEs there redirect here.

## UI architecture (post `prototype-ui-integration`)

The post-unlock surface is split into pure Astro components (zero-JS, SSR'd) and React islands (hydrated `client:*`):

- **Astro components** under `src/components/astro/` — `PhoneFrame`, `StatusBar`, `Slot`/`SlotDone`/`SlotActive`/`SlotFree`, `DayHeaderToday`, `DayDivider`, `DetailCard`, `Chip`, hand-drawn + geometric icons. These compile to HTML; their JS payload is zero.
- **React islands** under `src/components/islands/` — `AppShell`'s post-unlock state hosts a hash router (`#/clients/:id`) that mounts `DailySchedule` (Phone A) or `ClientDetail` (Phone B). `BottomSheet`, `CameraCard`, `ThemeToggle`, `PhoneScroll`, `FabSecondary` provide interactivity. Cross-island state lives in `nanostores` (~1KB) so each island hydrates independently.
- **Theme persistence** uses a dedicated `tricho_app_prefs` PouchDB (separate from the unlocked vault) with a single `_local/theme` doc. The `_local/` prefix guarantees non-replication (per `local-database`); the doc is plaintext (theme is a non-sensitive display preference). An inline bootstrap script in `Layout.astro` reads the doc before paint to avoid a light→dark flash.
- **PWA** — `@vite-pwa/astro` generates `dist/sw.js` precaching JS/CSS/HTML/SVG/woff2/manifest with workbox `CacheFirst` strategies for fonts and images. Self-hosted Fraunces / Geist / Caveat / Patrick Hand under `public/fonts/` (latin + latin-ext subsets); zero runtime fetches to Google Fonts.

### Appointment query path (zero-knowledge note)

`appointment.startAt` is sensitive plaintext that lives only inside the encrypted `payload` — it is **not** on the wire and cannot be indexed. Schedule queries scan all `appointment` docs by type via the existing `[type, updatedAt]` index, decrypt each row, then filter by `startAt` client-side. Trading a O(log N + k) range query for O(N_appointments) decrypts is acceptable for a single-user practice and preserves the zero-knowledge invariant.

## Known follow-ups

- Social login (Google/Apple) is not wired — account identity is just a per-vault CouchDB credential. A JWT bridge through the auth-proxy could be added later.
- Photos are attachments on their meta doc; if a practice accumulates thousands of large photos, move to an S3-backed attachment proxy.
- Appointment editing flow, statistics page, archive page, full settings, calendar date-picker, weather data — deferred from `prototype-ui-integration` to a follow-up change.
