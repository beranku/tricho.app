# Tricho.app — Trichologický deník a CRM

End-to-end šifrovaná PWA pro tricholožky a kadeřnice: deníkový plán dne,
karta klientky s anamnézou a alergeny, before/detail/after fotografie.
Veškerá data zůstávají na zařízení uživatelky a synchronizace přes
CouchDB cestuje výhradně jako šifrovaný `payload`.

> *Karta klientky, diář — a ticho.*

## Funkce

- **Diár** (Phone A): sticky hlavičky dnů, sluníčko v dnešním headeru,
  scroll-to-today FAB, sloty `done`/`active`/`scheduled` + dopočítané
  volné úseky (volno 35 min) v pracovní době.
- **Karta klientky** (Phone B): kicker `Klient` + jméno v Fraunces,
  current-head s alergen badge a `zbývá X min` countdownem, cam-card pro
  before/detail/after záznam, chip sekce služeb a produktů, ruční
  poznámky, další termín.
- **Kamera**: přístup ke kameře, JPEG capture → AES-256-GCM šifrovaný
  blob uložený jako PouchDB attachment na photo-meta dokumentu.
- **Lokální úložiště**: PouchDB nad IndexedDB; každý dokument je
  `{_id, _rev, type, updatedAt, deleted, payload}` a jeho `payload` je
  AEAD ciphertext s AAD vázaným na `{vaultId, docId}`.
- **Synchronizace**: CouchDB 3 s `couch_peruser` přes JWT-bearer fetch;
  konflikty řešené deterministicky (newest-wins) bez sémantického
  merge.
- **Recovery Secret**: offline obnova přístupu bez serverového stavu;
  WebAuthn + PRF jako každodenní odemykání.
- **PWA**: instalace na domovskou obrazovku, plná offline podpora
  (`@vite-pwa/astro` + Workbox; self-hosted fonty).
- **Hand-drawn akcenty**: ballpoint stroke jen na třech místech
  (sluníčko, copper check, copper plus); zbytek UI je geometrický.

## Tech stack

Astro 5 + React 18 + TypeScript v PWA shellu; PouchDB v prohlížeči,
CouchDB 3 na serveru, `tricho-auth` Node service pro OIDC + JWT, Traefik
(dev/ci) / Cloudflare Pages (prod). Detail viz
[`docs/architecture.md`](docs/architecture.md).

## Struktura repa

```
tricho-app/
├── app/             # PWA shell (served at /app/, base: '/app/')
├── web/             # Marketing site (served at /, apex)
├── shared/          # Manifest, thin SW, icons, OG images
├── server/          # tricho-auth-related primitives
├── infrastructure/  # Compose stack: Traefik, Caddy, CouchDB, mock-OIDC, ...
├── scripts/         # merge-dist.mjs, validate-build.mjs
├── secrets/         # SOPS-encrypted per-profile secrets
├── prototypes/      # Canonical UI + landing-copy prototypes
├── openspec/        # Spec-driven changes + capability specs
├── docs/            # Developer reference (this file, architecture, testing, ...)
├── _headers, _redirects
├── compose.yml, Makefile
└── README.md
```

`app/` and `web/` are independent npm packages (own `package.json`,
own `node_modules`, no workspace tooling). `scripts/merge-dist.mjs`
stitches their `dist/` outputs plus `shared/` into the deployable
`dist/` tree. See [`docs/architecture.md`](docs/architecture.md) for the
two-surface model and the two service workers (`/sw.js` thin pass-through
on the apex; `/app/sw.js` Workbox PWA SW under the app scope).

## Quick start

```bash
# Verify host wiring (Docker, SOPS, age, /etc/hosts).
make doctor

# Bring up the dev stack (CouchDB + tricho-auth + Traefik) on
# http://tricho.localhost.
make dev

# Browser-only iteration (no backend) — Astro dev server only.
cd app && npm install && npm run dev   # PWA at /app/
cd web && npm install && npm run dev   # marketing at /
```

For full local setup, IDE config, day-to-day flow, and release
mechanics see [`docs/developer-guide.md`](docs/developer-guide.md) and
[`docs/build-and-deploy.md`](docs/build-and-deploy.md).

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — guidance for AI coding assistants
  (invariants, voice, design system).
- [`docs/`](docs/) — developer reference (architecture, dev guide, build
  & deploy, testing, secrets, voice).
- [`openspec/`](openspec/) — capability specs (source of truth for
  behaviour) + in-flight changes.
- [`prototypes/landing-page-prototype/COPY.md`](prototypes/landing-page-prototype/COPY.md)
  — canonical brand voice & landing copy.
- [`prototypes/ui-prototype/tricho-north-star.md`](prototypes/ui-prototype/tricho-north-star.md)
  — canonical UI spec.
- [`web/src/content/help/`](web/src/content/help/) — end-user help portal
  (rendered at `tricho.app/help`).

