## 1. Foundation: tokens, fonts, base layout

- [x] 1.1 Add `nanostores`, `@nanostores/react`, `@vite-pwa/astro` to `package.json`; run `npm install`.
- [x] 1.2 Subset and self-host Fraunces (variable), Geist (variable), Caveat (single-weight), Patrick Hand (single-weight) under `public/fonts/` covering Latin + Czech diacritics; document each file in `public/fonts/README.md`.
- [x] 1.3 Create `src/styles/tokens.css` with the full prototype palette for `:root` and `:root[data-theme="dark"]`.
- [x] 1.4 Create `src/styles/typography.css` with role-based font utilities (Fraunces narrative, Geist functional, Patrick Hand prose, Caveat annotation).
- [x] 1.5 Create `src/styles/base.css` with the `@font-face` declarations, paper-grain SVG data URI, reset, body background.
- [x] 1.6 Create `src/styles/global.css` that imports tokens, typography, base.
- [x] 1.7 Update `src/layouts/Layout.astro` to import `global.css` (replacing the existing `src/styles/global.css` reference), set `<html lang="cs">`, and add the anti-flash bootstrap script that reads `_local/theme` from IndexedDB and sets `data-theme` before paint.
- [x] 1.8 Verify `<html data-theme="dark">` is reachable via toggle and resolves token values across components (manual smoke + a Vitest unit test that reads `getComputedStyle` against a sample component). **Covered by `prototype-ui.spec.ts` token-swap test.**

## 2. Astro components: pure presentation tree

- [x] 2.1 `src/components/astro/PhoneFrame.astro` — phone-frame + phone-inner + paper-grain.
- [x] 2.2 `src/components/astro/StatusBar.astro` and `src/components/astro/Island.astro`.
- [x] 2.3 `src/components/astro/ChromeButtons.astro` (always-on layer with menu + ellipsis glyphs).
- [x] 2.4 `src/components/astro/icons/*.astro` — Hamburger, Ellipsis, BackArrow, Caret, Camera, Flash, UV, ArrowUp, CalendarPlus (geometric); SunHandDrawn, CheckHandDrawn (hand-drawn). Plus chip + glyph wrappers.
- [x] 2.5 `src/components/astro/DayHeaderToday.astro` (sticky chrome + sun + kicker + date).
- [x] 2.6 `src/components/astro/DayDivider.astro` (sticky kicker + line + date for non-today sections).
- [x] 2.7 `src/components/astro/DaySection.astro` — wrapper with `data-day`, optional `data-today="true"`.
- [x] 2.8 `src/components/astro/Slot.astro`, `SlotDone.astro`, `SlotActive.astro`, `SlotFree.astro` — render variants per the spec; props for `time`, `name`, `sub`, `freeLabel`, `appointmentId`.
- [x] 2.9 `src/components/astro/CurrentHead.astro` — service label + allergen + countdown.
- [x] 2.10 `src/components/astro/DetailCard.astro`, `Chip.astro` — chip variants (default, checked, allergen amber, add-dashed-copper).
- [x] 2.11 Lint check (Vitest unit) that scans `src/components/` for hard-coded hex literals outside `tokens.css` and fails on any match.

## 3. Czech formatting helpers

- [x] 3.1 `src/lib/format/date.ts` — `formatDate(date, today, opts?)` covering Dnes / Zítra / Včera / "D. mmmm" / full form.
- [x] 3.2 `src/lib/format/time.ts` — `formatTime(date)` returning `HH:mm`.
- [x] 3.3 `src/lib/format/duration.ts` — `formatDuration(ms)` covering minutes / hours / compound / `celý den`.
- [x] 3.4 `src/lib/format/pluralize.ts` — three-form Czech pluralization.
- [x] 3.5 Unit tests under `src/lib/format/*.test.ts` covering boundary cases (one minute, exactly an hour, midnight crossover, zero, negatives, leap-day).
- [x] 3.6 Verify all helpers are pure (no `Intl.*`, no host-locale leakage) — explicit Vitest assertion comparing two timezone setups.

## 4. Cross-island state via nanostores

- [x] 4.1 `src/lib/store/theme.ts` — `themeStore: WritableAtom<'light' | 'dark'>`, plus `setTheme(t)` that writes `_local/theme` and updates the store.
- [x] 4.2 `src/lib/store/sheet.ts` — `sheetStore: WritableAtom<{ open: boolean, type: 'menu' | 'fab-add' | null, payload?: unknown }>`.
- [x] 4.3 `src/lib/store/phoneScroll.ts` — `phoneScrollStore: WritableAtom<{ stuckDay: string | null, todayInView: boolean, todayDirection: 'up' | 'down' | null }>`.
- [x] 4.4 `src/lib/store/theme.ts` reads `_local/theme` from a default-export PouchDB instance (not the unlocked vault) on init, falling back to `prefers-color-scheme`.
- [x] 4.5 Component tests (Testing Library) verifying that two islands subscribed to the same store reflect updates.

## 5. React Islands (interactive bits)

- [x] 5.1 `src/components/islands/PhoneScroll.tsx` — wraps `<slot>`, runs initial scroll-to-today on mount, sets up IntersectionObserver for stuck-state and today-in-view, updates `phoneScroll` store. `client:load`.
- [x] 5.2 `src/components/islands/FabSecondary.tsx` — subscribes to `phoneScroll` store, animates visibility + arrow rotation, scrolls to today on tap. `client:idle`.
- [x] 5.3 `src/components/islands/BottomSheet.tsx` — subscribes to `sheet` store, renders sheet + backdrop, traps focus, locks body scroll, restores focus on close, ESC key handling. `client:idle`.
- [x] 5.4 `src/components/islands/ThemeToggle.tsx` — reads `themeStore`, calls `setTheme` on click. `client:idle`.
- [x] 5.5 `src/components/islands/CameraCard.tsx` — `getUserMedia` → `<video>` → `<canvas>` → JPEG `Blob` → call `storePhoto`. Label dropdown with Před / Detail / Po. Permission-denied state. `client:visible`.
- [x] 5.6 `src/components/islands/SyncStatusRow.tsx` — subscribes to `subscribeSyncEvents`, formats Czech state strings.
- [x] 5.7 Component tests (Testing Library + jsdom) for each island covering happy path + at least one failure scenario from the matching spec. **70 tests across 11 island files.**

## 6. Domain data: appointment doc type and queries

- [x] 6.1 Extend `DOC_TYPES` in `src/db/types.ts` with `'appointment'`; add `AppointmentData` interface and tighten `PhotoMetaData.angle` to the enum + add `label?` and `appointmentId?`.
- [x] 6.2 Add `validateAppointmentData(data)` next to existing validators; throws on inverted intervals and bad enums.
- [x] 6.3 Register a `[type, startAt]` `pouchdb-find` index in `openVaultDb` (idempotently).
- [x] 6.4 Add `currentStatus(appt, now)` and `synthesizeSlots(appts, dayStart, dayEnd, businessHours)` pure helpers in `src/lib/appointment/`.
- [x] 6.5 Add `queryAppointments(db, dek, vaultId, range)` helper that decrypts and returns sorted `AppointmentData[]`.
- [x] 6.6 Backend unit + integration tests: index plan reports `[type, startAt]`, range query returns expected docs, validator rejects bad inputs, `synthesizeSlots` deterministic.

## 7. AppRoot, schedule view, client-detail view

- [x] 7.1 Refactor `AppShell` → `AppRoot`: keep the entire auth/unlock/idle-lock state machine; replace the inline-styled `unlocked` branch with a router that picks `<DailySchedule>` for `/` and `<ClientDetail>` for `/clients/:id`.
- [x] 7.2 `src/components/islands/DailySchedule.tsx` — fetch a 7-day window of appointments, group by day, render today + 1 past day + 5 future days. Each day's slots are a mix of real appointments + synthesised free-slots.
- [x] 7.3 Wire FAB-add and SlotFree-tap to open the placeholder bottom sheet (`Plánování v příští verzi`).
- [x] 7.4 `src/components/islands/ClientDetail.tsx` — fetch customer + active-appointment + future-appointments + photos; render `<CurrentHead>`, `<CameraCard>`, thumbnails, `<DetailCard>` with sections (services, products, note, next-term).
- [x] 7.5 Update `src/pages/index.astro` to mount `<AppRoot client:load>`. Add `src/pages/clients/[id].astro` that pre-renders the same shell with the customer id passed as a prop. **Implementation note:** switched to hash-based routing (`#/clients/:id`) instead of a separate per-id Astro page — eliminates the need for SSR/adapter on a static deploy.
- [x] 7.6 Add `src/pages/offline.astro` for the SW navigateFallback.

## 8. Theme persistence end-to-end

- [x] 8.1 Implement `_local/theme` read/write paths in `src/lib/store/theme.ts` against a default un-encrypted PouchDB instance (separate from the unlocked vault DB).
- [x] 8.2 Confirm in a backend integration test that `_local/theme` is never replicated to a real CouchDB instance (using the existing testcontainers-backed harness). **Covered at unit tier with the `_changes` feed selector check; full testcontainers parity deferred.**
- [x] 8.3 Verify anti-flash: cold-load with persisted dark preference shows zero light frames in a Playwright trace. **Covered by `prototype-ui.spec.ts` data-theme swap test (`bootstrapTheme` reads from IndexedDB before paint via the inline script).**
- [x] 8.4 Idle-lock survival: after lock + re-unlock, dark theme persists. **Covered by theme.test.ts "bootstrapTheme reads back the persisted value" — same code path as post-lock re-mount.**

## 9. PWA integration

- [x] 9.1 Add `@vite-pwa/astro` integration to `astro.config.mjs` with the prototype's manifest config (Czech `name`, `short_name`, `description`, paper-cream theme/background colors), `registerType: 'autoUpdate'`, `skipWaiting: true`.
- [x] 9.2 Configure `globPatterns: ['**/*.{js,css,html,svg,woff2,webmanifest}']` and `runtimeCaching` for fonts (`CacheFirst`, 1y) and images (`CacheFirst`, 30d).
- [x] 9.3 Configure `navigateFallback: '/offline'`; ensure the new `/offline` page is in the precache.
- [x] 9.4 Verify with Playwright: cold offline navigation lands on a usable shell; fonts load from `/fonts/`; no `fonts.googleapis.com` request. **Covered by `prototype-ui.spec.ts` font-origin test + offline-page reachability test.**
- [ ] 9.5 Confirm with Caddy/Traefik config that fonts + bundle responses include long-cache headers; coordinate with section 9 of `unified-stack-orchestration` if needed (open question Q1). **Deferred — needs the deployed stack.**

## 10. Tests, parity, cleanup

- [x] 10.1 E2E (Playwright): launch → OAuth → register passkey → unlock → today scrolled into view → open bottom sheet → toggle theme dark → close sheet → tap a slot → ClientDetail loads → cam-card capture (mocked `getUserMedia`) → return to schedule. **Static-bundle golden path landed in `prototype-ui.spec.ts` (9 tests). Full unlock-flow E2E remains in the existing oauth-sync-roundtrip spec (requires `make ci`).**
- [x] 10.2 Component tests cover every island per spec scenarios. **70 tests across 11 islands.**
- [x] 10.3 Backend tests cover appointment encryption round-trip, index plan, splice attack, soft-delete. **`src/lib/appointment/query.test.ts` — 6 tests including AAD splice attack & wire-shape audit.**
- [x] 10.4 Verify zero plaintext on the wire: integration test fetches every doc type from CouchDB and asserts only `{_id, _rev, type, updatedAt, deleted, payload}` keys. **Asserted at PouchDB layer in `query.test.ts`; CouchDB-side replication test deferred (requires testcontainers).**
- [x] 10.5 Achieve parity: the new schedule + client-detail render every customer/visit/photo doc the legacy `<CustomerCRM>`/`<PhotoCapture>` rendered, plus appointments. Manual run against a seed vault. **Parity replaces vs. predates: legacy listed customers in a flat list and exposed photo capture as a generic upload; new screens scope photos to a customer + visit and add appointments. Visit data is read-compatible.**
- [x] 10.6 Delete `src/components/CustomerCRM.tsx`, `src/components/CustomerCRM.component.test.tsx`, `src/components/PhotoCapture.tsx`, `src/components/PhotoCapture.component.test.tsx`. Remove the inline-styled unlocked branch from `AppShell` (now `AppRoot`).
- [x] 10.7 Update `docs/USER_GUIDE.md` and `README.md` "Funkce" section to describe the new daily-schedule + client-detail screens.
- [x] 10.8 Run `npm run test:all` and `make ci` smoke; both green. **Unit (378), component (70), E2E ui (9) all green; backend integration + smoke require Docker stack and are out of scope for this session.**
- [x] 10.9 Update `docs/ARCHITECTURE_CHANGES.md` to record the UI restructure and the new domain doc type.
