## Context

The prototype (`ui-prototype/tricho-prototyp-v2.html` + `tricho-north-star.md` + `tricho-impl-README.md`) was authored independently from the rest of the codebase. It assumes Dexie.js, Google Fonts CDN, `astro@4` + `@astrojs/react@3`, and a fresh component tree. The existing project (`src/`) runs on `astro@5.16` + `@astrojs/react@4`, uses PouchDB with envelope encryption (AAD-bound to `{vaultId, docId}`), syncs to per-user CouchDB through a JWT-bearing fetch, and routes the UI through `AppShell` after a passkey-PRF or Recovery-Secret unlock. Crypto, sync, auth, and idle-lock are all spec-locked and must not change behaviour.

The integration question is therefore not "how do we build this UI?" — the prototype already answers that — but "how do we land the prototype on top of an immovable security foundation while keeping every byte of user data encrypted at rest and on the wire?" The risk is that a naive port introduces plaintext leaks (e.g. in `localStorage`, in URL query strings, in service-worker caches) or weakens AAD bindings.

The current placeholder UI (`AppShell`'s `unlocked` branch with inline-styled `<CustomerCRM>` and `<PhotoCapture>`) is good enough to verify the crypto path end-to-end but bears no relationship to the prototype. It is replaceable wholesale once a parity bar is met.

Stakeholders:
- **Tricholog (end user)** — Czech-speaking practitioner on a 390–430px iPhone, often offline mid-appointment, expects "moleskin on the reception desk", not "dashboard in browser".
- **Security invariants** — server sees only ciphertext, AAD binds payload to `{vaultId, docId}`, RS is the last-resort offline recovery, idle-lock wipes in-memory secrets.
- **Performance** — first paint on a mid-tier mobile must be sub-second from cold cache; PWA must be fully functional offline; every byte of JavaScript counts.

Authoritative current-state doc: `docs/ARCHITECTURE_CHANGES.md`.

## Goals / Non-Goals

**Goals:**
- Pixel-faithful adoption of the prototype on top of the existing crypto/sync/auth stack.
- Zero plaintext on the wire — appointments, allergens, photo labels, photo blobs all flow through `payload-encryption` + `photo-attachments`.
- Sub-second time-to-interactive on cold cache: maximize `.astro` (zero-JS) and minimize hydrated islands. Self-host fonts so the SW can serve them offline.
- Theme persistence that survives idle-lock and is invisible to the server.
- Clean separation between Astro (presentation) and React (interactivity) so the static surface area is renderable at build time without React in the bundle.
- Test coverage matching the project's six-tier pyramid (`docs/TESTING.md`).

**Non-Goals:**
- Appointment editing, statistics, archive, full settings, calendar date-picker, push notifications.
- Real-time multi-user collaboration features.
- Server-side rendering of user data — the static Astro pages are content-empty (chrome only); user data hydrates on the client after vault unlock.
- Migrating away from PouchDB to Dexie (the prototype's README is wrong about this).
- Customising the workbox runtime caching strategies beyond what the prototype's `astro.config.mjs` already specifies.

## Decisions

### D1. Astro routes are content-empty; data hydrates after unlock

**Choice:** Astro pages (`src/pages/index.astro`, `src/pages/clients/[id].astro`) render the static phone frame, status bar, chrome buttons, and a single React island (`<AppRoot client:load>`). The island owns the auth state machine and only renders schedule/detail content once the vault is unlocked.

**Why:** Static pre-rendered HTML cannot contain user data — there is no user-specific session at build time, and even if there were, the user's plaintext must never appear in CDN-cacheable HTML. Putting `<AppRoot>` at the top of the tree is also the simplest way to keep the existing `AppShell` state machine intact.

**Alternatives considered:**
- Render schedule HTML server-side from a JWT-authenticated request. Rejected: server has only ciphertext; can't decrypt for SSR.
- Two separate islands (chrome + body). Rejected: the chrome must read the same scroll/sheet stores as the body, simplest if they share one root.

### D2. Per-island state via nanostores, not React Context

**Choice:** `theme`, `sheet`, and `phoneScroll` live in nanostores (`@nanostores/react` for hydration). Each island subscribes only to the stores it needs.

**Why:** A React Context Provider at the root would force every island to re-hydrate as a single tree, defeating the Astro-Islands separation. Nanostores are ~1KB, framework-agnostic, and survive across separately-hydrated islands by living in module scope.

**Alternatives considered:**
- React Context — rejected, hydration unification (see above).
- Custom events on `window` — rejected, no type safety, debugging nightmare, races on subscribe-after-emit.
- Zustand — rejected, larger bundle, React-specific.

### D3. Theme persistence in `_local/theme` PouchDB doc, not `localStorage`

**Choice:** A single `_local/theme` document with shape `{ theme: 'light' | 'dark', updatedAt: number }`. Read/written on theme toggle. The doc is plaintext (no `payload`) because the field is non-sensitive and we need it before the vault is unlocked.

**Why:**
- `_local/...` ids are guaranteed by `local-database` to be device-only — not replicated to CouchDB.
- Survives idle-lock (idle-lock clears in-memory state but PouchDB persists).
- Single source of truth: one doc, one subscription, no localStorage/IDB drift.
- Reading before unlock is fine because PouchDB itself is openable without a DEK; only `payload`-bearing docs need the DEK to decrypt.

**Threat-model delta vs. localStorage:**
- Before: a malicious extension reading `localStorage.theme` gets nothing sensitive — the field is the user's display preference, not a secret. Same is true of `_local/theme`. **No security delta.**
- The motivation is correctness (idle-lock survival) and consistency (one storage layer), not security.

**Alternatives considered:**
- `localStorage` — rejected, scattered storage layers, doesn't survive `localStorage.clear()` from another tab if the user logs out elsewhere.
- An encrypted `theme` doc inside the vault — rejected, requires DEK, can't apply theme on the auth screens.
- A cookie — rejected, this PWA has no server-side rendering of user content; nothing to read it server-side.

### D4. Static UI in `.astro`, interactivity in `.tsx` islands

**Choice:** Following the prototype README's split:
- `.astro`: PhoneFrame, StatusBar, Island, ChromeButtons, PaperGrain, DayHeaderToday, DayDivider, DaySection, Slot variants, CurrentHead, DetailCard, Chip, all icons, ChromeGlyph.
- `.tsx`: PhoneScroll (scroll detection, stuck state, fab-secondary visibility, initial scroll), BottomSheet (open/close, focus trap, ESC, backdrop), CameraCard (capture + label dropdown), ThemeToggle, FabSecondary (subscribes to phoneScroll store), AppRoot (auth state machine).

**Why:** Astro's zero-JS default means a slot rendered in `.astro` ships zero bytes of React to the client. Even though most of the post-unlock UI hydrates eventually (because data is plaintext-only client-side), keeping presentational structure in `.astro` lets us SSR the auth-screen chrome (status bar, phone frame) without React on the page at all.

**Alternatives considered:**
- All-React — rejected, shipping React for non-interactive markup is the failure mode the prototype's README explicitly warns against.
- Lit / vanilla web components — rejected, ecosystem mismatch, no shared types with the existing React components.

### D5. Hydration directive: `client:load` for AppRoot, `client:idle` for non-critical islands

**Choice:**
- `<AppRoot client:load>` — must boot immediately to drive auth.
- `<BottomSheet client:idle>` — closed by default; can wait until the browser is idle.
- `<CameraCard client:visible>` — only hydrates when scrolled into view (Phone B).
- `<ThemeToggle client:idle>` — non-critical interaction.
- `<PhoneScroll client:load>` — needed for initial scroll-to-today; must run on first paint to avoid a flash.
- `<FabSecondary client:idle>` — visibility flips after some scroll, fine to defer.

**Why:** Each `client:` directive controls *when* the island's JS is loaded and hydrated. Defaulting non-critical islands to `client:idle` keeps the cold-start interactive path narrow.

### D6. Daily schedule data flow

**Query:** `db.find({ selector: { type: 'appointment', startAt: { $gte: dayStart, $lt: dayEnd } }, sort: [{ startAt: 'asc' }] })`. The `[type, startAt]` index is registered at vault-open time (alongside the existing `[type, updatedAt]`).

**Free-slot synthesis:** A pure function `synthesizeSlots(appointments, dayStart, dayEnd, businessHours)` walks the appointment list and emits free-slot pseudo-objects for any gap ≥15 min within business hours. Free slots are *not* persisted — they are derived. Tapping `+` on a free slot opens the (deferred-to-next-change) "create appointment" flow, which then writes a real `appointment` doc.

**Today / future / past sections:** A second query fetches a 7-day window `[today − 1d, today + 5d]` and groups by day (`startAt → 'YYYY-MM-DD'`). Past days show `done` and skipped slots only; today shows the full mixed view; future days show scheduled appointments only.

**Why:** The expensive operation is the "today" slot list, which the user looks at first. Indexing on `[type, startAt]` makes that O(log N + k). The 7-day window is cheap because the index covers the range query.

**Alternatives considered:**
- Materialise free slots as `appointment` docs of `status: 'free'`. Rejected: writes for non-events, replication storm, can't represent "an indefinite open future".
- Client-side filter without an index. Rejected: today's lookup becomes O(N) over every appointment ever scheduled.

### D7. CameraCard wiring

**Choice:** The cam-card label dropdown writes the chosen angle (`before | detail | after`) and hand-written label string to a freshly captured photo's `PhotoMetaData.angle` + `PhotoMetaData.label`. Capture path: `getUserMedia` → `<video>` → `<canvas>` → `Blob` (JPEG) → `storePhoto(db, vaultId, dek, blob, meta)` (existing `src/sync/photos.ts`). `storePhoto` already AES-GCM-encrypts the blob with AAD bound to `{vaultId, photoId}` and stores it as a PouchDB attachment named `"blob"` per the `photo-attachments` spec.

**Why:** This is the existing integration point. The cam-card is a UI veneer over a path that's already built and tested. The only schema delta is tightening `PhotoMetaData.angle` to an enum and adding `label?: string`.

**Threat-model delta:** None. The encryption path, AAD binding, attachment ride-along on replication, soft-delete behaviour are all unchanged. The new `angle` enum is plaintext-side, encrypted into `payload` along with the rest of `PhotoMetaData`.

### D8. PWA service-worker scope

**Choice:** `@vite-pwa/astro` configured with:
- `globPatterns: ['**/*.{js,css,html,svg,woff2,webmanifest}']` — caches all build output and self-hosted fonts.
- `runtimeCaching` for fonts and images with `CacheFirst` strategies (long TTL — 1 year for fonts).
- `navigateFallback: '/offline'` for offline navigation.
- **No caching of PouchDB or fetch-to-CouchDB** — those go through the existing JWT-bearer fetch and are not interceptable by the SW (they are cross-origin XHR to the CouchDB host, not navigation requests).

**Why:** The SW must cache static-asset bytes only. User data lives in PouchDB which is already offline-first (IndexedDB-backed). Letting the SW touch CouchDB requests would risk caching encrypted payloads in two places — and worse, would risk caching error responses or stale revisions.

**Threat-model delta vs. no-SW-today:** A compromised SW (e.g. via a supply-chain attack on a build dependency) could rewrite served HTML to exfiltrate decrypted plaintext from the page. **Mitigation:** the PWA is built from this repo's source, the SW is generated by `@vite-pwa/astro` (no custom SW logic), and the Subresource Integrity story is enforced by the host's Caddy config (`infrastructure/`). The threat surface is the build pipeline, which is outside this change's scope.

### D9. Czech formatting helpers are pure

**Choice:** Pure functions, no `Intl.RelativeTimeFormat`-style host-locale dependence. `formatDate(d, today)`, `formatTime(d)`, `formatDuration(ms)`, `pluralize(n, ['hodina','hodiny','hodin'])`. All test-deterministic.

**Why:** `Intl` polyfilling for Czech across all browsers is fragile, and we have very limited surface (today/zítra + day name + "DD. <month>"). A 60-line file is the right size.

### D10. Schedule scroll behaviour

**Choice:** On mount, `<PhoneScroll>` finds `<section data-today>` and `scrollIntoView({ block: 'start', behavior: 'instant' })`. After scroll, an `IntersectionObserver` watches each day-section's sticky header to detect "stuck" state and updates the `phoneScroll` nanostore with `{ stuckDay, todayInView }`. `<FabSecondary>` subscribes to `todayInView` and shows itself with the appropriate up/down arrow when today is offscreen.

**Why:** This matches the prototype's `setupStickyDayDividers()` and `setupScrollToTodayButton()` JS, but in idiomatic React + a single store. Avoids per-section listeners and re-renders.

### D11. Idle-lock interaction with the schedule view

**Choice:** When `IdleLock.onLock` fires (existing code), `AppRoot` transitions back to `view: 'login'`. The schedule unmounts cleanly because all encrypted reads went through React-managed effects. The `theme` nanostore stays populated (theme is non-sensitive). The `phoneScroll` store resets.

**Why:** Idle-lock guarantees in-memory secrets are wiped. Anything that survives must be non-sensitive. Theme passes that bar; scroll position does not (would leak which appointments the user was viewing) so it resets.

## Risks / Trade-offs

- **[Risk: Hydration mismatch on theme]** First paint shows light theme; after `<AppRoot>` reads `_local/theme` and applies dark, the page flashes. → **Mitigation:** Inline a synchronous `<script>` in `Layout.astro` that reads `_local/theme` from IndexedDB before the body paints, OR sets `data-theme` from a `prefers-color-scheme` query as a default; switch to the persisted value once available. Accept a single-frame flash on a fresh install with no preference set.

- **[Risk: Self-hosted fonts inflate the bundle]** Four families × multiple weights × Latin-Extended could be 200–400KB. → **Mitigation:** Subset to Latin + Czech diacritics only (`unicode-range`). Variable fonts (Fraunces, Geist) are one file per family. Caveat and Patrick Hand are single-weight. Target: <250KB total fonts payload.

- **[Risk: Service worker stale cache after schema change]** A user with a cached old SW could receive a build that doesn't understand the new `appointment` doc type. → **Mitigation:** `registerType: 'autoUpdate'`, `skipWaiting: true`, and bump the precache version on every release. PouchDB schema is forward-compatible (unknown fields are preserved).

- **[Risk: Bottom-sheet focus trap conflicts with browser autofocus]** Some Android keyboards relinquish focus when the sheet opens. → **Mitigation:** Implement focus trap with `inert` on the underlying content, restore focus on close. E2E test on Chrome Android.

- **[Risk: Appointment query plan drift]** PouchDB `find()` may fall back to a full scan if the `[type, startAt]` index isn't registered before the first query. → **Mitigation:** Register both indexes in `openVaultDb` synchronously before resolving; fail loudly with a console error if a query plan reports `use_index: undefined`.

- **[Trade-off: Adding `nanostores`]** ~1KB but a new dependency. → Acceptable: cheaper than rolling our own pub-sub or pulling in Zustand.

- **[Trade-off: Dropping `<CustomerCRM>` and `<PhotoCapture>`]** They're already tested. → The new component tree must reach equivalent test coverage before deletion. Tasks file enforces this ordering: parity reached → green → delete legacy.

- **[Trade-off: Two indexes on the same table]** Slightly more write amplification. → Inconsequential for a single-user PWA at expected document volumes (≤10⁵ docs over years).

## Migration Plan

The change is additive and feature-flag-free; rollout is by ordinary release.

**Forward sequence (mirrored in `tasks.md`):**
1. Land foundation: tokens, fonts, paper-grain, base CSS, layout.
2. Land pure Astro components (zero JS impact).
3. Land Czech format helpers + tests.
4. Land nanostores + theme persistence (`_local/theme`).
5. Land islands (PhoneScroll, BottomSheet, CameraCard, FabSecondary, ThemeToggle).
6. Land `appointment` doc type + index + queries.
7. Wire `<AppRoot>` to mount the schedule on unlock.
8. Wire client-detail page (`/clients/[id]`).
9. Add PWA integration (after the new HTML stabilises, so the precache lists the right files).
10. E2E + smoke green.
11. Delete `<CustomerCRM>` and `<PhotoCapture>` placeholder.

**Rollback:** Revert the merge commit. PouchDB indexes left behind are inert. Any `appointment` documents written during rollout will sit dormant in vaults until a forward release ships again — they decrypt fine but the rolled-back UI ignores unknown doc types.

**Data migrations:** None required. Existing `customer`, `visit`, `photo-meta` docs are unchanged. The tightened `PhotoMetaData.angle` enum is a TypeScript-only refinement; old docs with `angle: undefined` or with a free-form string still decrypt and render (the UI normalises unknown values to `detail`).

## Open Questions

- **Q1.** Does the production CouchDB host (`infrastructure/`) already serve fonts with appropriate `Cache-Control` headers, or do we need a Caddy config tweak to make the SW's `CacheFirst` strategy land cleanly? — *To verify in section 9 of `tasks.md`.*
- **Q2.** Should the FAB add-appointment button open the deferred edit flow as a stub for now, or be hidden until the next change ships it? — *Default to a stub bottom-sheet that says "Plánování v příští verzi"; non-blocking.*
- **Q3.** What's the source of "weather" on the today header (sun glyph + 15° temp)? Prototype shows it but doesn't say. — *Out of scope for this change; render a static placeholder ("—°") and fetch in a future change. Confirm with stakeholder.*
- **Q4.** Phone B's `next-term` row needs a real future-appointment lookup keyed by customer; does the existing `[type, updatedAt]` index suffice, or do we want an index on `[type, customerId, startAt]`? — *Defer until query profiling shows it matters; the customer's appointment list is small.*
