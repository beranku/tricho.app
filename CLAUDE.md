# CLAUDE.md — tricho-app

## What this is

Tricho.app is a Czech-only, offline-first PWA for independent **tricholožky a kadeřnice** (the canonical persona is Ludmila — trichologist, Pardubice). Two screens: **diár** (today's slots, history) and **karta klientky** (anamnéza, allergens, photos, history). End-to-end encrypted in the phone; the server stores ciphertext only.

It is explicitly **not** a CRM, not a booking system, not a dashboard, not an AI assistant. *"Karta klientky, diář — a ticho."*

Source-of-truth product/voice doc: `prototypes/landing-page-prototype/COPY.md`. Source-of-truth UI doc: `prototypes/ui-prototype/tricho-north-star.md` (~2500 lines).

## Repo layout

- `app/` — PWA shell. Astro 5 + React 18 + Nanostores + RxJS + PouchDB + TweetNaCl + vite-pwa + Paraglide. Independent `package.json`, served at `/app/`.
- `web/` — Marketing site (landing, blog, help, pricing, legal). Astro 5 + MDX + Satori. Independent `package.json`, served at `/`.
- `shared/` — Cross-surface assets: `manifest.webmanifest`, thin `sw.js` (scope `/`, no caching), `icons/`, `og/`.
- `server/` — Server-side glue.
- `infrastructure/` — Docker Compose services: `couchdb/` (CouchDB 3 + `tricho-auth` JWT proxy), `traefik/` (dev/ci/prod), `mock-oidc/` (CI only).
- `scripts/` — `merge-dist.mjs` (combines `web/dist` + `app/dist` + `shared/` → root `dist/`) and `validate-build.mjs`.
- `prototypes/` — `ui-prototype/` (north star), `landing-page-prototype/` (canonical landing copy + HTML), `onboarding-ui-prototype/`.
- `openspec/` — `config.yaml`, `specs/` (capability source of truth), `changes/` (in-flight + `archive/`).
- `docs/` — `ARCHITECTURE_CHANGES.md`, `DEVELOPER.md`, `TESTING.md`, `USER_GUIDE.md`.
- `secrets/` — SOPS-encrypted per-profile YAML; decrypted to gitignored `.secrets-runtime/` at runtime.
- `Makefile`, `compose.yml` — operator entry points.
- `_headers`, `_redirects` — Cloudflare Pages routing & cache/security headers.

Root `package.json` has no dependencies; this is **not** a workspace. `app/` and `web/` build independently and are stitched by `scripts/merge-dist.mjs`. Do not introduce pnpm workspaces, Turborepo, Nx.

## Build & test

Operator targets (root):

```
make dev            # CouchDB + tricho-auth dev stack
make ci             # CI profile (self-signed TLS + mock OIDC)
make e2e            # Playwright e2e against ci stack (sets up + tears down)
make prod-local     # Local prod topology (Let's Encrypt + Caddy)
make down           # Stop everything; wipe .secrets-runtime/
make logs           # Tail running stack
make test-smoke     # Infra smoke (compose config, secrets lint, healthchecks)
make test-all       # All tiers (unit + component + backend + integration + smoke + e2e)
make doctor         # Check Docker / SOPS / age / hosts / DNS
make secrets-edit   # sops edit secrets/$(PROFILE).sops.yaml
make secrets-rotate-age
```

Per-package (run from `app/` or `web/`):

```
# app/
npm run dev | build | preview | typecheck
npm run test                       # unit + component (fast, no docker)
npm run test:unit | test:component
npm run test:backend | test:backend:integration
npm run test:e2e                   # requires `make ci` running
npm run test:smoke
npm run test:coverage

# web/
npm run dev | build | typecheck | lint
```

Build pipeline: `app build` + `web build` → `node scripts/merge-dist.mjs` → `node scripts/validate-build.mjs` → deploy `dist/` to Cloudflare Pages via `wrangler` in CI.

## Where tests live

- Unit & component: colocated `*.test.ts(x)` next to source under `app/src/`. Vitest 3 + jsdom + fake-indexeddb.
- Backend (tricho-auth, couchdb proxy): under `infrastructure/*/test/`, run via `app/`'s `test:backend(:integration)` configs (testcontainers).
- E2E: `app/tests/e2e/`, Playwright, runs against `https://tricho.test` from the ci profile.
- Smoke: `app/scripts/smoke/run-all.sh`.
- Six-tier pyramid + speed budgets + coverage floors are spec'd in `openspec/specs/test-strategy/spec.md`.

## Hard invariants — do not violate

These come from `openspec/config.yaml` and the encryption/sync specs. Any change that conflicts with them needs to be called out explicitly in an OpenSpec proposal.

1. **Zero-knowledge.** The server sees ciphertext + OAuth identity only; never plaintext, never the DEK, never the Recovery Secret. No server-side decryption, no plaintext logs. Every payload AAD-binds `{vaultId, docId}` (see `openspec/specs/envelope-crypto/`, `payload-encryption/`).
2. **No password recovery.** Lost passphrase = lost data, by design — this is a *feature* in the brand voice. Don't propose reset / forgot-password / "recover from cloud" flows. The only fallbacks are the **Recovery Secret** (`recovery-secret`) and the **encrypted file backup** included in every plan (`encrypted-backup`).
3. **Two service workers, two scopes.** `/sw.js` (from `shared/`) is a 15-line thin SW with no caching. `/app/sw.js` (from vite-pwa) is the full Workbox SW with `registerType: 'prompt'`, `skipWaiting: false`, `clientsClaim: false`. Updates are never silent — the user is prompted. See `ARCHITECTURE.md`.
4. **Two packages, one merge.** `app/` and `web/` are independent npm projects. The contract is `scripts/merge-dist.mjs`. Don't introduce monorepo tooling.
5. **Secrets via SOPS + age.** Plaintext secrets never in git. `.secrets-runtime/` is decrypted output and is gitignored. Missing dev secrets fall back to dev defaults; never invent fake prod values.
6. **Sync entitlement gating.** The CouchDB proxy validates JWT + subscription + `paidUntil` before forwarding. On 401 → refresh JWT and retry once (transparent). On 402 `plan_expired` → throw a typed error and route to the Plan screen, **no retry** (`openspec/specs/live-sync/`, `billing-plans/`).
7. **PWA scope discipline.** PWA shell base is `/app/`. The marketing site is fully static under `/`. Don't bleed app routes into `/` or marketing routes into `/app/`.

## OpenSpec is the source of truth

`openspec/specs/<capability>/spec.md` defines hard requirements (SHALL/MUST) and softer guidance (SHOULD). `openspec/changes/` holds in-flight proposals (currently `implement-landing-page`, `landing-invite-cta`); completed work is moved to `openspec/changes/archive/`.

When making non-trivial changes, prefer the OpenSpec workflow skills over freehand edits: `openspec-propose`, `openspec-apply-change`, `openspec-explore`, `openspec-archive-change` (see `.claude/skills/`). Spec authors must use Given/When/Then with a failure scenario for security-sensitive paths and reference source paths (not line numbers — they rot).

Capability index (each is a directory under `openspec/specs/`):

- **Identity & auth** — `oauth-identity`, `jwt-session`, `jwt-key-bootstrap`, `passkey-prf-unlock`, `local-pin-fallback`.
- **Encryption & vault** — `envelope-crypto`, `vault-keystore`, `vault-state-sync`, `payload-encryption`, `secrets-management`, `recovery-secret`, `encrypted-backup`.
- **Sync & device** — `live-sync`, `device-management`, `local-database`, `restore-from-local-zip`, `static-build-merge`.
- **Billing & plans** — `billing-plans`, `stripe-recurring-billing`, `bank-transfer-billing`, `plan-management-ui`, `plan-renewal-walkthrough`.
- **UI shell & navigation** — `pwa-shell-routing`, `bottom-sheet-navigation`, `locked-screen`, `idle-lock`, `theme-preference`, `locale-preference`, `ui-design-system`.
- **Data domains** — `appointment-data`, `client-detail`, `daily-schedule`, `photo-attachments`.
- **Testing** — `test-strategy`, `e2e-testing`, `backend-tests`, `component-tests`, `third-party-mocks`.
- **Deployment & infra** — `cloudflare-pages-deploy`, `stack-orchestration`, `traefik-edge`.
- **Onboarding & lifecycle** — `welcome-onboarding-wizard`, `account-lifecycle`.
- **Formatting & i18n** — `i18n-foundation`, `czech-formatting`, `english-formatting`.
- **Marketing & release** — `marketing-site`, `app-release-versioning`.

## Voice & copy rules (Czech only)

The product is Czech-language. Copy is canonical in `prototypes/landing-page-prototype/COPY.md` — when HTML and COPY.md disagree, COPY.md wins.

- Address the user as **ty** (informal). Always feminine forms (klientka, tricholožka).
- **Use:** klientka, návštěva, anamnéza, alergen, vlasová pokožka, mikrokamera, diář, karta, sešit, kartotéka, zálohu, synchronizace.
- **Avoid:** uživatelka, klient (m.), CRM, dashboard, workflow, onboarding, scheduler, "end-to-end" (write it in Czech instead).
- **Brand phrases (literal, never translate or restyle):** `Tricho`, `Tricho.app`, `Free`, `Pro`, `Max`, `Začít zdarma`.
- Italics (`*…*` in Markdown, `<em>` in HTML) = signature emphasis, rendered teal-700.
- Plans: **Free** (zdarma napořád, no caps, no trial, includes encrypted file backup), **Pro** 299 Kč/yr (2 zařízení, cloud backup 12 měsíců), **Max** 499 Kč/yr (5 zařízení, cloud backup 5 let). Sync is the upsell, not core. Free is fully usable on its own.
- Signature line: *"Co ti řekne klientka, zůstane mezi vámi."*

## Design system signals

Full system: `prototypes/ui-prototype/tricho-north-star.md` and `openspec/specs/ui-design-system/`.

- **Fonts (strict roles):**
  - **Fraunces** — names, dates, times, large titles. Optical size mandatory: `opsz 28` for chrome/dividers, `opsz 36` for client-name display. Tabular-nums on all numerals.
  - **Geist** — UI labels, buttons, chips, kickeries (UPPERCASE, letter-spacing 0.18em).
  - **Patrick Hand** — diary prose ("volno 35 min", camera hints).
  - **Caveat** — short warnings & allergen badges only (≤3 words), amber.
- **Color discipline:**
  - **Teal-700** = "live state" only (active appointment countdown, primary CTAs that complete an action). Misusing teal for static UI dilutes the signal.
  - **Copper** = annotations, day-header kickeries (Zítra, Pátek), hand-drawn accents.
  - **Amber** = allergen warnings only.
  - Ink scale: `--ink`, `--ink-2`, `--ink-3`, `--ink-4` (last only for ≥18px or glyphs).
  - Surfaces: light `#FDFAF3` (cream), dark `#211A15` (espresso, never `#000`). All values via CSS custom properties on `:root` / `:root[data-theme="dark"]` — no hard-coded hex.
- **Paper-grain SVG overlay** is always on (fixed, `pointer-events: none`, `mix-blend-mode` per theme). Not decoration — part of the identity.
- **Hand-drawn glyphs are limited to three:** sun (today), check (done slot), plus (free slot). Everything else is geometric.
- 44×44 touch targets, WCAG AA contrast, focus rings (teal outline), `prefers-reduced-motion` support.

## Out of scope — never propose

- Client-facing booking. Tricho is a sešit, not a rezervační systém. Users are pointed at Reservio/Booksy in the FAQ.
- AI suggestions, recommendations, generative features.
- Statistics, dashboards, analytics, charts.
- Password reset / "forgot password".
- Anything that requires server-side decryption or plaintext on the wire.

## Pointers

- `README.md` — features overview & quick-start.
- `ARCHITECTURE.md` — one origin / two surfaces, two-SW model, Cloudflare Pages routing, rollback, versioning, zero-knowledge invariants.
- `docs/DEVELOPER.md`, `docs/TESTING.md`, `docs/USER_GUIDE.md`, `docs/ARCHITECTURE_CHANGES.md`.
- `prototypes/ui-prototype/tricho-north-star.md` — full UI spec.
- `prototypes/landing-page-prototype/COPY.md` — canonical brand voice & product copy.
- `prototypes/onboarding-ui-prototype/` — welcome / auth flow prototypes.
- `openspec/config.yaml` + `openspec/specs/` — capability source of truth.
- `.claude/skills/openspec-*` — propose / apply / explore / archive workflow skills.
