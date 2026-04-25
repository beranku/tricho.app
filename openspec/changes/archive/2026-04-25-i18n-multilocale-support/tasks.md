## 1. Foundation: Paraglide compiler + locale registry

- [ ] 1.1 Add `@inlang/paraglide-js` as a devDependency in `package.json`; pin a 2.x version; run `npm install`.
- [ ] 1.2 Run `npx @inlang/paraglide-js@latest init --yes --outdir=src/paraglide --locales=en,cs --baseLocale=en` (or equivalent) to scaffold `inlang/project.json` and `src/paraglide/`.
- [ ] 1.3 Add `src/paraglide/` to `.gitignore` (compiler output is regenerated).
- [ ] 1.4 Create `src/i18n/config.ts` exporting `LOCALES = ['en', 'cs'] as const`, `Locale = (typeof LOCALES)[number]`, and `DEFAULT_LOCALE = LOCALES[0]`.
- [ ] 1.5 Add a Vitest unit test `src/i18n/config.test.ts` that imports `inlang/project.json` and asserts `settings.locales` equals `LOCALES` and `settings.baseLocale === DEFAULT_LOCALE`. Failing test = drift between two sources of truth.
- [ ] 1.6 Wire the Paraglide Vite plugin into `astro.config.mjs` per Paraglide JS 2.0 docs (Vite plugin auto-detects Astro 5; no separate adapter).

## 2. Message catalogs (English default, Czech parity)

- [ ] 2.1 Create `src/i18n/messages/en.json` with the initial key set covering every UI surface inventoried in the proposal (menu rows, day kickers, client detail labels, login/oauth/pin/recovery copy, settings rows, error states). Use dot-namespaced keys (`menu.clients`, `schedule.dayHeader.today`, `client.notFound`, `settings.language.label`, etc.).
- [ ] 2.2 Create `src/i18n/messages/cs.json` with one Czech translation per key in `en.json` — copy existing strings verbatim from the components they currently live in (no copy edits in this change).
- [ ] 2.3 Run `astro build` once to generate `src/paraglide/messages.js`; verify the file exports a function per key.
- [ ] 2.4 Create `src/i18n/index.ts` re-exporting `m` from `src/paraglide/messages.js` and the runtime functions (next section). This is the only import path components use.
- [ ] 2.5 Add a Vitest unit test `src/i18n/messages.test.ts` that loads both JSON catalogs and asserts the key sets are equal (set difference both directions, fails with diff output).

## 3. Locale runtime

- [ ] 3.1 Create `src/i18n/runtime.ts` exporting `localeStore` (nanostore atom typed `Locale`), `getLocale()`, `setLocale(locale)`, `setLocaleAndPersist(locale)`, `subscribe(fn)`. `setLocale` writes Paraglide's runtime locale (`setLocale` from `src/paraglide/runtime.js`) AND updates the nanostore AND sets `<html lang>`.
- [ ] 3.2 In `runtime.ts`, implement `initFromHostOrPersisted()` that reads `_local/locale` from a default PouchDB instance (mirror `src/lib/store/theme.ts` shape); if absent, derive from region-stripped `navigator.language` against `LOCALES`, fall back to `DEFAULT_LOCALE`, and persist immediately.
- [ ] 3.3 Create `src/lib/store/locale.ts` as a thin re-export façade that components use the same way they use `src/lib/store/theme.ts`. (Keeps the "stores live under `lib/store`" convention.)
- [ ] 3.4 Unit test `src/i18n/runtime.test.ts`: covers default-locale fallback (Czech browser, English browser, unsupported browser), `_local/locale` round-trip, persistence-failure-does-not-revert-UI, subscribe/unsubscribe, `<html lang>` reflection on switch.
- [ ] 3.5 Component test that wraps a fixture island in a fake DOM, calls `setLocale('cs')`, asserts the `m.<key>()` calls inside the island return Czech strings within one render.

## 4. Anti-flash bootstrap

- [ ] 4.1 Extend the existing inline bootstrap script in `src/layouts/Layout.astro` to also read `_local/locale` from the PouchDB IndexedDB store and set `document.documentElement.lang` before paint.
- [ ] 4.2 Implement the `navigator.language` fallback inside the bootstrap (same algorithm as `runtime.ts` but inlined — no module imports allowed in the synchronous boot script).
- [ ] 4.3 Remove the hardcoded `<html lang="cs">` from `Layout.astro` (let the bootstrap own this attribute).
- [ ] 4.4 E2E assertion (extend `tests/e2e/offline-sync.spec.ts` or new `locale-bootstrap.spec.ts`): on cold start with `_local/locale.locale === 'cs'`, the first painted frame already has `<html lang="cs">` (use Playwright `page.evaluate(() => document.documentElement.lang)` immediately after `goto`).

## 5. Per-locale format helpers

- [ ] 5.1 `git mv src/lib/format/date.ts src/lib/format/cs/date.ts`; same for `time.ts`, `duration.ts`, `pluralize.ts`, `index.ts` → `cs/index.ts`. No content edits.
- [ ] 5.2 Create `src/lib/format/en/date.ts` implementing the English variants per `english-formatting/spec.md` (Today/Tomorrow/Yesterday, `MMM D`, full form `dddd, MMM D`).
- [ ] 5.3 Create `src/lib/format/en/time.ts` (24h zero-padded, identical algorithm to cs).
- [ ] 5.4 Create `src/lib/format/en/duration.ts` (English short forms, `all day` sentinel).
- [ ] 5.5 Create `src/lib/format/en/pluralize.ts` (two-form English; with the 3-tuple compat branch per the spec).
- [ ] 5.6 Create `src/lib/format/en/index.ts` re-exporting all four functions.
- [ ] 5.7 Replace `src/lib/format/index.ts` with a dispatcher that imports both `cs` and `en` modules and calls the right one per `getLocale()`.
- [ ] 5.8 Move existing `src/lib/format/format.test.ts` content into `src/lib/format/cs/cs.test.ts` (Czech scenarios) unchanged. Add `src/lib/format/en/en.test.ts` covering each English scenario from `english-formatting/spec.md`.
- [ ] 5.9 Add `src/lib/format/dispatch.test.ts` covering: (a) dispatcher uses `cs` when locale is `cs`, (b) dispatcher uses `en` when locale is `en`, (c) byte-identical output across two test runs with different mocked locale values.
- [ ] 5.10 Verify all helpers remain pure (no `Intl.*` import, no `navigator.language` read, no `Date.toLocaleString`) — automated grep test in `src/lib/format/purity.test.ts`.

## 6. Locale-preference settings UI

- [ ] 6.1 Add a `<Row>`-style entry in `src/components/islands/MenuSheet.tsx` titled with `m.menu_language()`, sub-text showing the active locale's self-name (`English`, `Čeština`). Place above the Theme row.
- [ ] 6.2 Implement the locale option list — either a sub-sheet or an inline expansion under the row. List every locale by its self-name; selecting one calls `setLocaleAndPersist(locale)`.
- [ ] 6.3 Component test `src/components/islands/MenuSheet.component.test.tsx`: row exists, renders current locale self-name, opens option list on click, selecting a locale calls the runtime function.
- [ ] 6.4 Component test that selecting a different locale updates every other visible string in the menu within one render (re-renders the whole MenuSheet under both en and cs and asserts label parity with `m.<key>()` outputs).

## 7. String migration: every component, every page

For each file below: replace every Czech literal with `m.<key>()`; add the corresponding key to both `messages/en.json` and `messages/cs.json`; verify in-browser; commit.

- [ ] 7.1 `src/components/islands/MenuSheet.tsx` — Klienti, Statistika, Archiv, Nastavení, Odhlásit, sub-text labels, sync/theme row labels.
- [ ] 7.2 `src/components/islands/DailySchedule.tsx` — `Dnes`, `Zítra`, `Včera`, `Klient`, free-slot text, FAB add-appointment a11y label.
- [ ] 7.3 `src/components/islands/ClientDetail.tsx` — `Klient`, `Klient nenalezen`, `zbývá X min`, current-head labels.
- [ ] 7.4 `src/components/astro/DayHeaderToday.astro` — `Dnes` literal.
- [ ] 7.5 `src/components/astro/DayDivider.astro` — kicker examples in comment are docs only; no runtime literal.
- [ ] 7.6 `src/components/AppShell.tsx` — any inline status / loading copy.
- [ ] 7.7 `src/components/LoginScreen.tsx` — every label, button, helper.
- [ ] 7.8 `src/components/OAuthScreen.tsx` — same.
- [ ] 7.9 `src/components/JoinVaultScreen.tsx` — same.
- [ ] 7.10 `src/components/PinSetupScreen.tsx` — same.
- [ ] 7.11 `src/components/RSConfirmation.tsx` — same.
- [ ] 7.12 `src/components/SettingsScreen.tsx` — same.
- [ ] 7.13 `src/components/SyncStatus.tsx` and `src/components/islands/SyncStatusRow.tsx` — connection status strings.
- [ ] 7.14 `src/components/DeviceLimitScreen.tsx` — same.
- [ ] 7.15 `src/pages/offline.astro` — body copy.

## 8. Lint: no Czech literals

- [ ] 8.1 Create `src/i18n/lint.test.ts` (Vitest unit) that scans `src/components/**/*.{tsx,astro}` and `src/pages/**/*.astro`, fails on any character in `[ěščřžýáíéúůňťďĚŠČŘŽÝÁÍÉÚŮŇŤĎ]` outside of comments, `data-*` attributes, and JSDoc.
- [ ] 8.2 Add an opt-out marker `// @i18n-allow` for the rare case (e.g. a code sample showing what NOT to do); the lint MUST exempt the line that follows the marker only.
- [ ] 8.3 Run the lint; clear all violations before merge. Lint failure on master = build broken.

## 9. Tree-shaking verification

- [ ] 9.1 Add a Vitest test `src/i18n/treeshake.test.ts` that builds a fixture island via Vite's programmatic API (or reads a pre-built chunk from `dist/` after `npm run build`), parses the chunk source, and counts distinct `m.<symbol>` references; asserts the count is at most `(number of imports in the source) + 1`.
- [ ] 9.2 Set a per-island budget in the test (`MAX_MESSAGES_PER_ISLAND = 30`); document how to bump it with a comment + reviewer ack.

## 10. Service-worker pre-cache

- [ ] 10.1 In `astro.config.mjs`, extend `@vite-pwa/astro`'s `globPatterns` to include the build-output paths for the Paraglide chunks (e.g. `**/*paraglide*.js`).
- [ ] 10.2 E2E (`tests/e2e/locale-switch.spec.ts`): launch the app, install the SW, go offline, switch locale, assert no failed network requests and the UI renders in the new locale.

## 11. End-to-end coverage

- [ ] 11.1 New file `tests/e2e/locale-switch.spec.ts`:
  - 11.1.1 Fresh install (clear `_local/locale`); assert UI is in English.
  - 11.1.2 Open settings, select Čeština, assert UI is in Czech immediately.
  - 11.1.3 Reload; assert UI is still in Czech (persistence works).
  - 11.1.4 Trigger idle-lock (helper from existing tests), unlock; assert UI is still in Czech.
  - 11.1.5 Go offline, switch back to English, assert no network errors and UI is in English.
- [ ] 11.2 Extend `tests/e2e/oauth-sync-roundtrip.spec.ts` to assert that after a full sync, the CouchDB user database does not contain any `_local/locale` document (zero-knowledge invariant check).

## 12. Documentation + cleanup

- [ ] 12.1 Update `docs/ARCHITECTURE_CHANGES.md` with a one-paragraph summary of the i18n architecture (Paraglide, locale runtime, format dispatcher, `_local/locale`).
- [ ] 12.2 Update `README.md` to mention multilanguage support and the path to add a new locale (3 steps: add to `LOCALES`, add `messages/<locale>.json`, optionally add `src/lib/format/<locale>/`).
- [ ] 12.3 Update `docs/USER_GUIDE.md` with a screenshot/note on the Settings → Language row.
- [ ] 12.4 Update `docs/TESTING.md` with the new test paths (i18n config, runtime, lint, treeshake, en/cs format suites, locale-switch E2E).

## 13. Optional follow-ups (out of scope for this change, capture for backlog)

- [ ] 13.1 Drop a third locale (e.g. German) end-to-end as a smoke test of the extension story; revert before merge if it's purely a sanity check.
- [ ] 13.2 ESLint rule for "no string literal in JSX text node" (broader than the diacritic lint); deferred until the catalog stabilizes.
- [ ] 13.3 Per-locale `manifest.webmanifest` install-prompt name; requires the PWA `lang_dir`/per-locale manifest dance. Separate change.
- [ ] 13.4 Locale-aware client-list collation when the client list ships.
- [ ] 13.5 RTL support — separate change with CSS logical-property migration.
