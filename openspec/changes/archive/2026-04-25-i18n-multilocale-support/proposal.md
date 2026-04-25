## Why

Tricho ships today as a Czech-only PWA: every UI string is hard-coded in JSX/Astro, every date/time/duration/pluralization helper emits Czech-only output, and `<html lang="cs">` is fixed at the layout level. To welcome English-speaking trichologists (and to hand future locales — German, Slovak, Polish — a one-pull-request path) we need an i18n architecture that is (a) **invisible** to feature code, (b) **invisible** to the end user beyond a single language picker in the bottom-sheet settings, and (c) **invisible** to the server: locale state must live entirely on-device alongside theme preference, never replicating to CouchDB and never weakening any zero-knowledge invariant. The work is also a forcing function to remove the pun `czech-formatting` carries — the underlying helpers were always meant to be locale-pluggable, not locale-pinned.

## What Changes

- **Adopt Paraglide JS 2.0** (`@inlang/paraglide-js`) as the message-catalog compiler. Paraglide emits a tree-shakable `m.<key>(params)` function per message, so an Astro island that only references `m.scheduleEmpty()` ships only that message's translations — not the whole catalog. The compiler integrates with Vite (no Astro-specific adapter needed in v2) and runs at `astro dev` / `astro build`.
- **English (`en`) becomes the default locale.** Czech (`cs`) becomes the first additional locale, preserving every existing Czech string verbatim (no copy edits in this change). New locales drop in as `messages/<bcp47>.json` + a one-line registration; **no feature code touches.**
- **Message catalogs live under `src/i18n/messages/<locale>.json`** with stable, dot-namespaced keys (`schedule.dayHeader.today`, `client.notFound`, `settings.language.label`). Paraglide compiles them into `src/paraglide/` (gitignored, regenerated). Components import `m` from `@/i18n` only — they never see locale codes or JSON.
- **Locale runtime** (`src/i18n/runtime.ts`) wraps Paraglide's `getLocale` / `setLocale` with three things: nanostore subscription so islands re-render on switch, write-through to the `_local/locale` PouchDB doc for persistence, and a typed `Locale` union (`'en' | 'cs'`) generated from the configured catalog list.
- **Format helpers become locale-aware** without losing purity. The current `src/lib/format/{date,time,duration,pluralize}.ts` move to `src/lib/format/cs/` (unchanged Czech outputs); a parallel `src/lib/format/en/` ships for English; the public API at `src/lib/format/index.ts` dispatches by reading the current locale from the runtime. Helpers MUST still NOT call `Intl.*`, MUST NOT read host locale, and MUST be byte-deterministic across browsers / Node — the same purity contract `czech-formatting` already mandates.
- **`<html lang>` reflects the active locale.** Bootstrap script in `Layout.astro` reads `_local/locale` from raw IndexedDB (mirroring the existing theme bootstrap) and writes `<html lang="en">` or `<html lang="cs">` before first paint — no FOUC, no localized-string flash.
- **Settings screen gains a Language row** under the existing bottom-sheet menu. Selecting a locale calls the runtime's `setLocaleAndPersist`, which (1) updates the nanostore (every subscribed island re-renders), (2) writes `<html lang>`, (3) upserts `_local/locale`. No reload required.
- **All hardcoded UI strings migrate to messages.** Inventoried surface includes: `MenuSheet` rows ("Klienti", "Nastavení", "Statistika", "Archiv", "Odhlásit"), `ClientDetail` ("Klient", "Klient nenalezen", "zbývá X min"), `DailySchedule` kickers ("Dnes", "Zítra", "Včera"), `offline.astro` body copy, `LoginScreen` / `OAuthScreen` / `JoinVaultScreen` / `PinSetupScreen` / `RSConfirmation` / `SettingsScreen` / `SyncStatus` / `DeviceLimitScreen` labels and errors. A Vitest lint asserts that `src/components/**/*.{tsx,astro}` contains no Czech-diacritic literals outside of comments.
- **Service-worker pre-cache** (via `@vite-pwa/astro`) ships **all** compiled locale bundles — a locale switch must work fully offline. Bundles are small (~5–15 KB minified each) thanks to Paraglide's tree-shaking, so pre-caching every locale is cheap.
- **Default locale fallback at first launch:** if `_local/locale` is absent (fresh install) and `navigator.language` starts with one of the registered locales, that locale is selected; otherwise `en`. The user override always wins on subsequent launches; we never re-read `navigator.language` after `_local/locale` exists.
- **No URL-locale prefix.** The PWA is single-route at the user-facing level (Astro pages are content-empty shells; React islands own the screens). Locale lives in client state only — not in the URL — because there is no SEO surface and switching mid-session must not navigate.
- **Renaming note (internal only):** the existing capability `czech-formatting` continues to specify the Czech outputs verbatim — its scenarios stay valid because `cs` produces identical strings. No spec delta to that capability is required.

**Non-goals (deferred):**
- Right-to-left languages (Arabic, Hebrew). Layout is LTR-only; adding RTL is a separate change that touches CSS logical properties.
- Locale-aware sorting / collation in client lists (CLDR-correct alphabetization). Today the client list is unsorted-stub; revisit when it ships.
- Per-document locale (e.g. a Czech-speaking salon serving an English-speaking client whose notes should render in English). Notes display in the user's locale; client-data locale is a future cap if the product needs it.
- Translation tooling / TMS integration (Crowdin, Lokalise). JSON-in-repo is sufficient at two locales; revisit when ≥ 3 locales or non-developer translators are involved.
- Localized PWA `manifest.webmanifest` `name`/`short_name`. Astro's PWA plugin emits one manifest; localizing the install-prompt name requires the PWA `lang_dir`/per-locale-manifest dance and is deferred.

## Capabilities

### New Capabilities
- `i18n-foundation`: message-catalog format and on-disk layout, Paraglide compiler integration, locale runtime (typed `Locale` union, `getLocale` / `setLocale` / subscribe), nanostore wiring, `<html lang>` reflection, anti-flash bootstrap, format-helper purity-and-locale-dispatch contract, service-worker locale pre-cache, default-locale fallback rules, message-key naming convention, no-hardcoded-string lint.
- `english-formatting`: English date / time / duration / pluralization helper outputs (`Today` / `Tomorrow` / `Yesterday` / `Apr 25` / `Friday, Apr 25`, 24-hour `09:10`, `1h 35m` / `2h` / `35 min` / `all day`, two-form English plurals).
- `locale-preference`: `_local/locale` PouchDB doc shape and write semantics (mirrors `theme-preference`), settings-UI Language row, default-locale resolution at first launch, never-replicates guarantee, persistence-across-idle-lock guarantee.

### Modified Capabilities
_(none — `czech-formatting`, `ui-design-system`, `theme-preference`, `bottom-sheet-navigation`, `local-database` all retain their current scenarios because the new capabilities layer on top without altering existing behavior.)_

## Impact

**Affected code:**
- `src/i18n/` — **new tree** — `messages/en.json`, `messages/cs.json`, `runtime.ts`, `index.ts` (re-exports `m` and the runtime).
- `src/paraglide/` — **new, gitignored** — Paraglide compiler output.
- `src/lib/format/cs/{date,time,duration,pluralize}.ts` — moved from `src/lib/format/*.ts`; logic unchanged.
- `src/lib/format/en/{date,time,duration,pluralize}.ts` — **new** — English equivalents.
- `src/lib/format/index.ts` — **rewritten** — dispatches to `cs` or `en` module by reading the active locale from the runtime; same exported function signatures.
- `src/lib/format/format.test.ts` — extended with English scenarios and a determinism check that runs both locales under Node and asserts byte-identical output to a snapshot.
- `src/lib/store/locale.ts` — **new** — nanostore + PouchDB `_local/locale` write-through, mirroring `src/lib/store/theme.ts`.
- `src/components/islands/MenuSheet.tsx` — adds a Language row above the Theme row.
- `src/components/islands/{DailySchedule,ClientDetail,SyncStatusRow}.tsx` and `src/components/astro/{DayHeaderToday,DayDivider}.astro` — replace hardcoded strings with `m.<key>()` calls.
- `src/components/{LoginScreen,OAuthScreen,JoinVaultScreen,PinSetupScreen,RSConfirmation,SettingsScreen,SyncStatus,DeviceLimitScreen,AppShell}.tsx` — same.
- `src/pages/offline.astro` — same.
- `src/layouts/Layout.astro` — extend the existing `data-theme` bootstrap to also read `_local/locale` from IndexedDB and set `<html lang>` before paint.
- `astro.config.mjs` — register the Paraglide Vite plugin; extend `@vite-pwa/astro` `globPatterns` to include `paraglide/**/*.js`.
- `package.json` — add `@inlang/paraglide-js` (dev dep, compile-time).

**Dependencies added:** `@inlang/paraglide-js` (compiler; emitted runtime is dependency-free).
**Dependencies removed:** none.

**Tests:**
- Unit (`src/i18n/runtime.test.ts`): default-locale resolution from `navigator.language`, `_local/locale` round-trip, locale-switch nanostore notification, `<html lang>` reflection.
- Unit (`src/lib/format/format.test.ts`): existing Czech scenarios continue to pass under `locale='cs'`; new English scenarios cover `Today`/`Tomorrow`/`Yesterday`/short month/full date, `1h 35m` / `2h` / `35 min` / `all day`, English two-form plurals (`1 client` / `2 clients`).
- Unit lint: scan `src/components/**/*.{tsx,astro}` for `[ěščřžýáíéúůňťďĚŠČŘŽÝÁÍÉÚŮŇŤĎ]` literals; fail with file:line if any are found outside comments.
- Component (`src/components/islands/MenuSheet.component.test.tsx`): the Language row exists; selecting `Čeština` switches every visible `m.<key>()` to its Czech variant within one render.
- Component (`src/components/islands/DailySchedule.component.test.tsx`): renders `Today` / `Tomorrow` / `Yesterday` under `en`, `Dnes` / `Zítra` / `Včera` under `cs`.
- E2E (`tests/e2e/locale-switch.spec.ts`): launch fresh (no `_local/locale`), assert English UI; toggle to Czech via settings; reload; assert Czech persists; force-quit + relaunch offline; assert Czech still applied. **Idle-lock recovery:** lock and unlock; assert Czech survives.
- E2E (`tests/e2e/offline-sync.spec.ts`): extended to assert that `_local/locale` is present after sync and absent on the CouchDB user database (zero-knowledge invariant check).

**Zero-knowledge invariants — explicit check:**
- `_local/locale` lives under the `_local/` prefix that `local-database` already guarantees is never replicated. The doc is plaintext (no `payload` field), like `_local/theme`. Server never sees it.
- Message catalogs are static build-time assets. They contain no user data and are bundled into the SW pre-cache like fonts.
- Locale switching is purely client-side; no server round-trip, no JWT mutation, no DEK touch.
- AAD bindings (`{vaultId, docId}`) are unaffected — locale is not part of any document payload.

**Rollback:**
The change is purely additive on top of the existing tree. To roll back:
1. Revert `src/lib/format/index.ts` to the pre-change contents (single Czech path).
2. Drop the Paraglide Vite plugin from `astro.config.mjs`.
3. Restore hardcoded Czech strings in components from git (one revert covers all).
4. Optional: leave `_local/locale` docs in place — they're harmless free-floating local state if no reader exists; or sweep with a one-shot migration. PouchDB `_local/...` docs do not block anything.
No data migration is required because no encrypted document shape changes.
