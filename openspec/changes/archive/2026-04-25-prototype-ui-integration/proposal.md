## Why

`ui-prototype/` ships the final UI/UX vocabulary for Tricho.App — a paper-textured, Czech-language trichology diary built around two screens (daily schedule + client detail), a hand-drawn accent system, and persistent light/dark themes. Today's `AppShell` (`src/components/AppShell.tsx`) routes correctly through OAuth → vault create/restore → unlock, but the post-unlock view is an inline-styled placeholder (`<CustomerCRM>` + `<PhotoCapture>` in plain `<section>` boxes) that has no relationship to the prototype.

The encryption, sync, auth, and idle-lock layers underneath that placeholder are correct and immovable — `envelope-crypto`, `payload-encryption`, `local-database` (PouchDB-with-AAD), `live-sync`, `vault-keystore`, `passkey-prf-unlock`, `oauth-identity`, `jwt-session`, `idle-lock`, `recovery-secret`, `photo-attachments`. We need to graft the prototype onto those foundations without touching them. The prototype's own README assumes Dexie.js and Google-Fonts-CDN; both are wrong for this project (we run PouchDB and need offline-first self-hosted assets), so the integration is a translation, not a copy-paste.

## What Changes

- **Adopt the prototype's design system** as the project's UI vocabulary: paper-grain background, Fraunces/Geist/Caveat/Patrick-Hand typography, copper/teal/amber accent palette, hand-drawn SVG icons (sun, check, plus only — every other glyph is geometric), light/dark tokens, 0.22s cubic-bezier transitions.
- **Self-host the four font families** in `public/fonts/` (Fraunces, Geist, Caveat, Patrick Hand). Prototype's Google-Fonts CDN link is replaced by `@font-face` rules in `src/styles/base.css`. Required for offline PWA.
- **Astro + React Islands split** for the post-unlock UI. Static structure (phone frame, status bar, slots, detail cards, chips, day dividers, icons) becomes pure `.astro` components — zero browser JS. Interactivity (scroll-stuck state, scroll-to-today FAB, bottom-sheet open/close, camera card capture, theme toggle) becomes hydrated React islands.
- **Replace the unlocked view in `AppShell`** with two real screens routed by the URL: `/` → daily schedule (Phone A), `/clients/[id]` → client detail (Phone B). `AppShell` keeps its current state machine for auth/unlock/idle-lock and mounts the schedule once unlocked.
- **Bottom-sheet navigation** (left chrome → menu): clients list, statistics, archive, settings, theme toggle, sync status, logout. ESC and backdrop close, focus trap, body-scroll lock.
- **Czech formatting helpers** (`src/lib/format/{date,time,duration,pluralize}.ts`): "22. dubna" / "Dnes" / "Zítra", "09:10", "volno 1 h 35 min", "142 klientů" with three-form pluralization.
- **New domain capability: `appointment`** — richer than the existing `visit`. An appointment is `{ customerId, startAt, endAt, status: scheduled|active|done|free, serviceLabel, ... }`. Today's slots are derived by querying appointments for `startAt ∈ [today00:00, today24:00]` and filling gaps with synthetic free-slots. `visit` stays as the historical-record document type for completed work.
- **Allergen as first-class data**: chip with Caveat-amber typography, surfaced in client detail, attached to an appointment via `allergenIds: string[]`. Stored as encrypted plaintext like every other doc.
- **Photo angle semantics**: existing `PhotoMetaData.angle` (already optional) becomes a typed enum `before | detail | after` driving the cam-card label dropdown and the colour-tinted thumbnail strip below the camera.
- **Theme preference persistence** via a `_local/theme` PouchDB doc (not `localStorage`): survives idle-lock, lives only on the device, is never replicated. The `useTheme` hook subscribes to this doc and applies `data-theme="dark"` to `<html>`. **BREAKING (internal):** any current code reading `localStorage.theme` (none in production today) would need to migrate; one-shot migration on first load reads-and-deletes the legacy key.
- **PWA integration via `@vite-pwa/astro`**: the current `astro.config.mjs` registers no service worker even though the README claims one exists. Add the PWA plugin with the prototype's manifest values (Czech name, paper-cream theme color), self-hosted fonts in `globPatterns`, and `/offline` fallback. Service worker caches static assets only — never user data.
- **Idle-lock indicator** in the chrome: a small lock glyph next to the sync dot in the bottom sheet that reminds the user the vault is encrypted at rest.
- **Add nanostores + @nanostores/react** as a lightweight cross-island state bus (theme, sheet open/close, scroll position). Avoids a global React context provider that would force the static Astro tree to hydrate.
- **`@astrojs/react` upgrade trigger**: the project is already on `astro@^5.16` which pairs with `@astrojs/react@^4`; the prototype's `astro@^4 / @astrojs/react@^3` versions are downgraded onto our existing higher-version stack, not the other way around.

**Non-goals (explicitly out of scope, deferred to a follow-up change):** appointment editing flow, statistics page, archive page, full settings (subset only), client list page beyond a stub, calendar date-picker, push notifications, multi-device passkey enrollment UX, background-sync of pending edits beyond what `live-sync` already provides.

## Capabilities

### New Capabilities
- `ui-design-system`: design tokens (light + dark), typography rules, paper-grain texture, hand-drawn icon vocabulary, transition timings, self-hosted font loading.
- `daily-schedule`: Phone-A view — sticky chrome buttons, today's day-header with weather sun, future/past day sections, slot variants (active / done / free / scheduled), FAB-secondary "scroll to today", initial-scroll-to-today behaviour, FAB add-appointment.
- `client-detail`: Phone-B view — back/ellipsis chrome, current-head with countdown + allergen meta, cam-card with capture + label dropdown, thumbnail strip, detail card with service chips, product chips, note, next-term row.
- `bottom-sheet-navigation`: bottom sheet driven by `<BottomSheet>` island — open via menu button, navigation rows, sync-status row, theme toggle row, ESC + backdrop close, focus trap, body-scroll lock.
- `theme-preference`: persistent light/dark theme stored in a `_local/theme` PouchDB doc, applied via `data-theme` on `<html>`, exposed through nanostore + `useTheme` hook.
- `czech-formatting`: pure helpers for Czech date / time / duration / pluralization formatting; deterministic, locale-independent of the host.
- `appointment-data`: `appointment` doc type, scheduling-window query (`[type, startAt]` index), free-slot synthesis, status transitions (`scheduled → active → done`), allergen reference field.

### Modified Capabilities
- `local-database`: add `appointment` to `DOC_TYPES` and a secondary `pouchdb-find` index on `[type, startAt]` so daily-schedule queries don't full-scan. No change to encryption, soft-delete, or `_local/` semantics.
- `photo-attachments`: tighten `PhotoMetaData.angle` to a typed enum (`before | detail | after`), add an optional `label: string` for hand-written cam-card chip values. Wire shape (encrypted-payload + opaque attachment) is unchanged; this is a plaintext-side schema refinement only.

## Impact

**Affected code:**
- `src/components/AppShell.tsx` — strip the inline-styled unlocked branch; mount the new daily-schedule page instead. Auth/unlock/idle-lock state machine untouched.
- `src/components/CustomerCRM.tsx`, `src/components/PhotoCapture.tsx` — replaced wholesale by the new component tree; remove after the new screens reach parity, not before.
- `src/db/types.ts` — add `appointment` doc type, `AppointmentData` interface, tighten `PhotoMetaData.angle`.
- `src/db/pouch.ts` — register the new `[type, startAt]` index next to the existing `[type, updatedAt]` one.
- `src/layouts/Layout.astro` — import the new global stylesheet, set `<html data-theme>` from a server-rendered default (light), wire viewport-fit + theme-color from the design tokens.
- `astro.config.mjs` — add `@vite-pwa/astro` integration with the prototype's manifest + workbox config; preserve the existing Traefik HMR shim.
- `src/pages/index.astro`, **new** `src/pages/clients/[id].astro`, **new** `src/pages/offline.astro`.
- **New trees**: `src/components/astro/`, `src/components/islands/`, `src/lib/format/`, `src/lib/store/`, `src/styles/{tokens,typography,base,global}.css`, `public/fonts/`.

**Dependencies added:**
- `@vite-pwa/astro` (build-time PWA SW + manifest)
- `nanostores`, `@nanostores/react` (cross-island state)

**Dependencies removed:** none.

**Tests:**
- Unit: `src/lib/format/*.test.ts` (Czech date/time/duration/pluralize edge cases — esp. plural forms 1 / 2-4 / 5+).
- Component: islands (`PhoneScroll`, `BottomSheet`, `CameraCard`, `ThemeToggle`, `FabSecondary`).
- Backend: appointment-index query plan (extend existing `local-database` tests).
- E2E: launch → unlock → today scroll-pinned → open bottom sheet → toggle theme → navigate to client → capture photo → return to schedule.

**Zero-knowledge invariants — explicit check:**
- All new domain data (appointments, allergens, photo labels) flows through the existing `putEncrypted` / `getDecrypted` / `payload-encryption` path. The server still sees only `{_id, _rev, type, updatedAt, deleted, payload}` — no new plaintext fields.
- Theme preference is a `_local/...` doc, which `local-database` already guarantees is never replicated.
- Self-hosted fonts and the service-worker bundle contain no user data, only static assets.
- The cam-card writes encrypted blobs through the existing `storePhoto` (`src/sync/photos.ts`) — its AAD binding (vaultId + docId) is unchanged.

**Rollback:** the change is additive at the spec layer (two existing capabilities take small deltas; the rest are new). To roll back the UI, the previous `AppShell` `unlocked` branch can be restored from git and the new component trees deleted; PouchDB indexes are forward-compatible (an unused index is free), and the `appointment` doc type, if any have been written, deserializes to `unknown` plaintext that the rolled-back UI simply ignores. Service worker can be unregistered by bumping `registerType` to a no-op build.
