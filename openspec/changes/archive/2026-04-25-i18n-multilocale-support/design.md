## Context

Tricho's UI is single-language (Czech) by historical accident: the prototype was built for one trichologist in Prague, the first ten production users are Czech, and the original `czech-formatting` capability locked Czech outputs into pure helpers as a deliberate test-determinism choice (no `Intl.*`, no host-locale leakage). That choice is the right one — it means Vitest runs in Node identical to Chrome — but the **dispatch layer above those helpers** never existed. Strings live inline in JSX/Astro, the `<html lang>` is hard-coded, and the helpers are imported as if their output were universal.

Adding a second locale today means three orthogonal problems collide:

1. **String externalization** — a way to pull every "Klienti" / "Nastavení" / "Zítra" out of components into catalogs, with type-safe references and tree-shaking so islands don't ship strings they don't use.
2. **Locale-aware formatting** — extending the pure helpers to a second branch (English) without losing determinism, and routing call sites to the right branch by reading the active locale.
3. **Locale persistence** — a place to store "user picked English" that survives idle-lock, never reaches the server, and renders before first paint (mirroring `theme-preference`).

The PWA shape adds two further constraints. **Offline:** every locale must work with no network — locale switching mid-session must not depend on a server. **Single-route:** there is no SEO surface, the user is always at `/` or `/clients/[id]`, so URL-based locale prefixes (the typical Astro i18n recipe) buy us nothing and would fight the SPA-after-unlock model.

The encryption / sync / auth foundation is unchanged by any of this. Locale is a presentation-layer concern that never touches `payload`, AAD, the DEK, the recovery secret, or the JWT. Server is invariant.

Stakeholders:
- **End user (trichologist)** — wants one toggle in settings, no reload, immediate switch, no FOUC.
- **Future developer adding a third locale** — wants to drop one JSON, register one code, and be done.
- **Security invariants** — server stays plaintext-blind; no string from the catalog ever appears in ciphertext or AAD.
- **Test runner** — Vitest under Node must produce byte-identical output to Chrome under the same configured locale.

Authoritative references: `docs/ARCHITECTURE_CHANGES.md`, the existing `theme-preference` spec, the existing `czech-formatting` spec, the Paraglide JS 2.0 documentation at `inlang.com/m/gerre34r/library-inlang-paraglideJs/astro`.

## Goals / Non-Goals

**Goals:**
- Single dispatch layer between UI and message catalogs; UI never sees locale codes.
- Compile-time type safety for message keys and parameters — a typo in `m.scheduleEmpty()` is a build error, not a runtime missing-key.
- Tree-shaking per island — an island that uses 4 messages ships 4 messages × N locales (~few KB), not the full catalog.
- All locales pre-cached by the service worker so locale switch works offline.
- Locale persistence pattern is structurally identical to `theme-preference` so a reader of the codebase finds one shape, not two.
- Adding a fourth locale (e.g. German) is exactly: (a) `messages/de.json` with the same keys; (b) `'de'` in the locale registry; (c) optionally a `src/lib/format/de/*.ts` module if German formatting differs from English. Zero feature-code churn.
- English is default at first install; user override always wins on subsequent launches.
- Determinism contract preserved: helpers are pure, locale-explicit, and produce byte-identical output across runtimes.

**Non-Goals:**
- RTL support (Arabic, Hebrew). Defer until product demand exists; will require CSS logical-property migration.
- URL-based locale routing (`/en/clients`, `/cs/clients`). The PWA doesn't have an SEO surface or shareable per-locale URLs.
- Locale-aware client list collation (CLDR-correct sort). Client list is a stub today; revisit when it ships.
- Per-document locale (notes in English while UI is Czech).
- A full TMS integration (Crowdin, Lokalise, GitLocalize). JSON-in-repo is enough at two locales. Revisit at three or when non-developer translators arrive.
- Localizing the PWA `manifest.webmanifest` install-prompt name. Requires a separate per-locale-manifest dance.
- Backwards compatibility with hypothetical `localStorage.locale` or other legacy keys — none exist.

## Decisions

### D1. Paraglide JS 2.0 over react-i18next, lingui, formatjs

**Choice:** Use `@inlang/paraglide-js` 2.x as the message-catalog compiler. Author messages in `src/i18n/messages/<locale>.json`. The compiler emits `src/paraglide/messages.js` exporting one function per key (`m.scheduleEmpty()` returns a string in the active locale). Components import `m` and call functions; the compiler tree-shakes unused keys per chunk.

**Why:**
- **Tree-shaking is per-island.** An Astro island bundle gets only the messages it imports — Paraglide's documented advantage and the published "up to 70% smaller" benchmark vs. runtime libraries. We have many small islands; this multiplies.
- **Compile-time type safety.** Message keys are typed functions; parameter shapes are typed; missing-key is a compile error. Matches the project's strict TS posture.
- **No runtime parser, no JSON loader, no namespace state machine.** Paraglide's runtime is ~1KB and stateless beyond the active-locale variable.
- **Astro 5 native** — Paraglide 2.0 is a Vite plugin, no Astro adapter required (the old `@inlang/paraglide-astro` adapter is deprecated in favor of plugin auto-detection).
- **Deterministic** — the compiler emits plain JS at build time; no fetch, no I/O, identical output Node/browser.

**Alternatives considered:**
- **react-i18next** — runtime catalog loader, namespace splitting, well-known. Rejected: not Astro-5-compatible per the 2026 ecosystem reports; runtime cost; ships the whole namespace per chunk; no compile-time key check; weakest fit for an Astro-Islands codebase.
- **LinguiJS** — also compile-time, JSX `<Trans>` macros. Rejected: macro layer requires Babel, our build is pure Vite + esbuild; macros also fight Astro's `.astro` compiler which doesn't run Babel.
- **formatjs / react-intl** — the gold standard for ICU MessageFormat. Rejected: heavy runtime (~30 KB), requires polyfills for `Intl.PluralRules` we don't need anyway, and adds a `<IntlProvider>` context that defeats Astro's per-island hydration.
- **Hand-rolled** (`messages.ts` keyed object, simple `t(key)` helper). Rejected: no tree-shaking, no compile-time key check, every island re-imports the full catalog; we'd reinvent Paraglide poorly.

### D2. No URL-locale prefix; locale lives in client state

**Choice:** Astro's `i18n` config block stays empty. There is no `/en/...` vs `/cs/...` URL split. Active locale is read from `_local/locale` on boot, held in a nanostore, and reflected on `<html lang>` for screen-reader / accessibility correctness.

**Why:** The PWA is single-route at the user surface (Astro pages are content-empty shells; React islands own the screens after vault unlock). There is no SEO indexable content. URL-based locale would force a navigation on switch, fight the SPA model, and add a dimension to the route table that has no callers. Static analysis: `getStaticPaths` per locale × per route ⇒ 4 build-time pages instead of 2, with zero benefit.

**Alternatives considered:**
- **`/en/`, `/cs/` URL prefixes** with Astro's built-in `i18n.routing`. Rejected per the reasoning above.
- **Subdomain per locale** (`en.tricho.app`, `cs.tricho.app`). Rejected: violates the single-vault-per-origin model (each subdomain is a separate IndexedDB origin and would force re-unlock on switch).

### D3. Locale persistence mirrors theme-preference exactly

**Choice:** The user's locale lives in a single PouchDB document at id `_local/locale` with shape `{ _id: '_local/locale', locale: 'en' | 'cs' | <other>, updatedAt: number }`. No `payload` field. Read by `src/lib/store/locale.ts` (a nanostore wrapper) at boot; written by `setLocaleAndPersist` on user toggle. The anti-flash bootstrap script in `Layout.astro` reads the doc directly via raw IndexedDB before paint and applies `<html lang>`.

**Why:**
- Structural symmetry with `theme-preference`. One reading of the spec, one shape, one storage strategy. New developers learn once.
- `_local/` prefix guarantees no replication to CouchDB — the existing `local-database` spec already enforces this. Server stays plaintext-blind even about which language the user prefers.
- Survives idle-lock automatically: idle-lock wipes in-memory secrets, not `_local/...` docs. Re-mount reads the doc, applies the locale, no re-prompt.

**Alternatives considered:**
- **`localStorage.locale`** — Rejected: split-brain with the theme storage strategy; slightly faster boot but inconsistent with the project's offline/PouchDB-first ethos.
- **An encrypted `settings` doc** with locale + theme inside one payload. Rejected: locale is needed *before* the vault is unlocked (login screen, OAuth screen, recovery screen). Encrypting it makes the pre-unlock UI un-localizable.
- **`navigator.language` only, no persistence.** Rejected: doesn't honor user override; Czech speaker on an English browser would see English forever.

### D4. Format helpers split per-locale, dispatched at the public-API boundary

**Choice:** The four format helpers move from `src/lib/format/{date,time,duration,pluralize}.ts` to `src/lib/format/cs/{date,time,duration,pluralize}.ts` (literally moved, no edits). A parallel `src/lib/format/en/` ships English equivalents. The public API at `src/lib/format/index.ts` becomes a thin dispatcher:

```ts
import { getLocale } from '@/i18n/runtime';
import * as cs from './cs';
import * as en from './en';

const impls = { cs, en } as const;

export function formatDate(date: Date, today: Date, opts?: FormatDateOpts): string {
  return impls[getLocale()].formatDate(date, today, opts);
}
// ...repeat for formatTime, formatDuration, pluralize
```

Helpers remain pure: no `Intl.*`, no host-locale read. The locale is the only side input, and it's explicit (read from the runtime's nanostore at call time, not derived from the environment).

**Why:**
- Existing Czech scenarios in `czech-formatting/spec.md` continue to pass byte-identically — the helper bodies move, not change.
- Determinism is preserved: under any test environment, calling `getLocale()` returns whatever the test set, and the output is a function of `(locale, date, today)`. Snapshot tests are stable across Node and Chrome.
- New locales are an additive directory: `src/lib/format/de/...`, plus one entry in the dispatcher's `impls` map.
- Pluralize stays a hand-coded lookup per locale, not `Intl.PluralRules`. Czech's three-form rule is already coded; English needs a two-form (`one` / `other`) coded. No CLDR runtime, no determinism risk.

**Alternatives considered:**
- **Use `Intl.PluralRules` and `Intl.DateTimeFormat` directly.** Rejected: violates the existing `czech-formatting` purity contract; produces different strings between Node ICU versions and Chrome ICU versions; unstable snapshots.
- **Pass `locale` as a parameter to every helper.** Considered. Cleaner functionally but louder at every call site (every component would import and pass `useLocale()`). The dispatcher pattern keeps call sites unchanged at the cost of one implicit input — a deliberate ergonomic trade.

### D5. Pre-cache every locale in the service worker

**Choice:** Extend `@vite-pwa/astro`'s `globPatterns` to include the compiled Paraglide output: `paraglide/**/*.js` and `paraglide/**/*.json`. Every locale ships in the offline cache.

**Why:** Paraglide bundles are tiny (~5–15 KB minified per locale per island chunk after tree-shaking). At two locales the marginal cache cost is well under 50 KB total. A locale switch must work offline — Tricho's value proposition is offline mid-appointment use. The alternative (lazy-fetch the new locale on switch) would silently fail when the user toggles to Czech in the back of a salon with no signal.

**Alternatives considered:**
- **Only cache the active locale; lazy-load others.** Rejected: violates the offline guarantee and the cost saving is negligible.
- **Inline all locales into one bundle** (no per-locale chunk). Rejected: tree-shaking degrades — every island would carry every locale's strings.

### D6. Default-locale resolution at first install

**Choice:** On boot, if `_local/locale` is absent:
1. Look up `navigator.language` (e.g., `'cs-CZ'`, `'en-US'`).
2. Strip the region tag (`'cs-CZ' → 'cs'`).
3. If the bare code is in the registered locale list, use it.
4. Otherwise, use `en`.
5. Persist the chosen locale to `_local/locale` so step 1 only runs once.

After `_local/locale` exists, `navigator.language` is **never** consulted again. The user override is durable.

**Why:**
- Czech-region users get Czech automatically without configuring anything (the existing experience for the current install base).
- Anyone else gets English (a sensible global default and the new product-line default).
- Stripping to the bare code avoids the `'cs-CZ'` vs `'cs'` mismatch and matches Paraglide's locale-tag convention.
- Persisting eagerly prevents subtle behavior changes if `navigator.language` shifts (e.g., user changes OS locale mid-session).

**Alternatives considered:**
- **Always default to English, ignore `navigator.language`.** Rejected: regression for the existing Czech user base who would suddenly see English on first launch after the update.
- **Show a one-time language picker on first launch.** Rejected: violates the "invisible by default" UX goal. The settings menu is always one tap away if the auto-pick is wrong.

### D7. No-Czech-literal lint as a guardrail

**Choice:** A Vitest unit test scans `src/components/**/*.{tsx,astro}` for any character in `[ěščřžýáíéúůňťďĚŠČŘŽÝÁÍÉÚŮŇŤĎ]` outside of comments and `// eslint-disable`-style ignore markers. A match prints `path:line: literal "<excerpt>"` and fails. Migration tasks unblock the lint by moving each literal into `messages/cs.json`.

**Why:** Drift is the silent killer of i18n migrations — a developer in a hurry inlines "Klient" in a new component. The lint catches this at PR time. The Czech-diacritic heuristic has a near-zero false-positive rate (English UI strings don't contain `ž`).

**Alternatives considered:**
- **A broader "no string literal in JSX" lint** (eslint-plugin-i18next style). Rejected: too noisy — every aria-label, every CSS class, every `data-*` attribute would need an exemption list.
- **Manual review only.** Rejected: doesn't scale beyond two contributors.

### D8. Anti-flash bootstrap is a single inline script in `Layout.astro`

**Choice:** Reuse the existing theme bootstrap script. Open the `_pouch_default` IndexedDB synchronously, read both `_local/theme` and `_local/locale`, set `<html data-theme>` and `<html lang>` before the page paints. Fall back to system defaults (`prefers-color-scheme`, `navigator.language`) if either doc is missing.

**Why:** Same single-script for both prevents two FOUC windows. Layout already pays this synchronous IndexedDB cost for theme; adding one more `objectStore.get` is free.

**Alternatives considered:**
- **Two separate scripts.** Rejected: doubles the boot-time IndexedDB open cost.
- **Read from `localStorage` mirror.** Rejected: cache coherence headache; the PouchDB doc is authoritative.

## Risks / Trade-offs

- **Risk:** Translation drift — `messages/en.json` adds a key but `messages/cs.json` doesn't get the matching entry; user sees an empty string or a missing-key error.
  **Mitigation:** Paraglide's compiler errors at build time on missing keys (configurable strictness; we set it to `error`). Vitest test asserts every key in `en.json` exists in `cs.json` and vice versa.

- **Risk:** Bundle bloat from accidentally importing all messages into one chunk.
  **Mitigation:** Paraglide tree-shakes per import. We add a Vitest test that builds a sample island and asserts its bundled message count is small (≤ 20 by default; bumpable per island with comment justification).

- **Risk:** Locale-switch race — user toggles, nanostore updates, but a long-running effect captures a stale `getLocale()` result.
  **Mitigation:** Helpers are pure and re-evaluated each call; islands subscribe to the nanostore via `@nanostores/react` which forces re-render. We don't memoize formatted strings beyond a single render.

- **Risk:** First-paint flash if the IndexedDB `get` is slow on a cold start.
  **Mitigation:** The bootstrap script is `<script>` (synchronous, blocking) in `<head>`. Reads complete in <5 ms in measured cases. Worst case: brief default-locale flash, no functional impact.

- **Risk:** A new contributor adds a hardcoded English string in a component (the Czech-diacritic lint won't catch it).
  **Mitigation:** Code-review checklist + a follow-up tightening of the lint to flag any string literal of length > 4 inside JSX text nodes (deferred — too noisy initially).

- **Risk:** Paraglide JS 2.0 changes its compiler output between minor versions and breaks our `src/paraglide/` pinning.
  **Mitigation:** `package-lock.json` pins exact versions; CI runs the compile on every PR; the runtime-shape contract is small enough that a major-version bump is a deliberate migration, not a surprise.

- **Trade-off:** Paraglide's `m.<key>()` syntax is less idiomatic-React than `useTranslation()` / `t('key')`. Cost: one mental model adjustment for engineers who've used i18next elsewhere. Benefit: type safety + tree-shaking outweigh familiarity in a small team.

- **Trade-off:** Maintaining two parallel format-helper trees (`cs/`, `en/`) means two test surfaces. Cost: each new helper feature must land twice. Benefit: each module is small, focused, and locale-correct without conditional branching inside.

## Migration Plan

This is a feature-add, not a data migration. Steps to deploy:

1. Land the change in a single PR. The lint is pre-armed but the migration tasks (moving Czech literals into `messages/cs.json`) are completed in the same PR, so the lint passes from day one.
2. CI runs `astro build`, the unit suite, the component suite, and the `tests/e2e/locale-switch.spec.ts` E2E. A successful CI is the gate.
3. Deploy via the existing GitHub Pages pipeline. Service worker pre-cache picks up the new locale chunks on first visit; existing installs receive an update prompt as usual.
4. Announce in the in-app changelog (Czech): "English version available — switch from Settings → Language."
5. Soak window: 7 days. Monitor the existing Sentry-equivalent for missing-key errors; check that `_local/locale` docs are being created (synthetic check via a small offline test script the user can run).

**Rollback:**
1. `git revert` the change PR.
2. Push to GitHub Pages.
3. Existing `_local/locale` docs in user installs are harmless: nothing reads them after revert. They cost a few bytes per install. A future change can sweep them with a one-shot `db.remove('_local/locale')` if desired.
4. Service-worker pre-cache invalidates on the next workbox revision bump (automatic on each build).

No data migration on the encrypted document side because no encrypted document shape changes.

## Open Questions

1. **Pluralization for English: do we need ICU MessageFormat semantics (zero/one/two/few/many/other) or is `one`/`other` enough for the surfaces we have today?** Lean: `one`/`other` is enough for v1 (we don't have phrasings like "no clients" or "between 1 and 4" in the Czech catalog either). Revisit if a copy edit demands richer cases.
2. **Date-range formatting** (e.g., a future "from Mon 5 May to Wed 7 May" string) — not needed for the current schedule view, but the new appointment-edit screen may want it. Out of scope for this change; will land alongside the appointment-edit feature.
3. **Should we expose locale to the service worker** (e.g., to localize a push-notification body)? Not needed today — push notifications aren't shipped. When they are, the SW can read `_local/locale` from IndexedDB on its own.
4. **Number formatting** (`142` vs `1,234.56` vs `1 234,56`) — Czech and English differ on decimal/thousands separators. Today no UI shows numbers with separators (counts are small integers). Defer until needed.
