## ADDED Requirements

### Requirement: Each top-level package builds independently

Each of `web/` and `app/` MUST have its own `package.json`, its own lockfile (`package-lock.json`), its own `node_modules`, and its own `build` script. Running `npm install && npm run build` inside `web/` MUST produce `web/dist/` containing the marketing site. Running `npm install && npm run build` inside `app/` MUST produce `app/dist/` containing the PWA shell. Neither package MUST import or reference files from the other; neither package's build MUST depend on the other's output. There MUST NOT be any monorepo tooling configured (no Turborepo, Nx, npm/pnpm workspaces, or Lerna) and there MUST NOT be a root `package.json` that includes `"workspaces"`.

#### Scenario: Web builds standalone
- **GIVEN** a clean checkout
- **WHEN** the operator runs `cd web && npm install && npm run build`
- **THEN** `web/dist/index.html` exists
- **AND** the build does not require `app/` to be built or installed first

#### Scenario: App builds standalone
- **GIVEN** a clean checkout
- **WHEN** the operator runs `cd app && npm install && npm run build`
- **THEN** `app/dist/index.html` exists
- **AND** the build does not require `web/` to be built or installed first

#### Scenario: No workspaces declared
- **GIVEN** the repo root
- **WHEN** any `package.json` at the root is parsed
- **THEN** it does not contain a `"workspaces"` field
- **AND** no `pnpm-workspace.yaml`, `turbo.json`, or `nx.json` exists

### Requirement: Single merge script combines both builds and shared assets into dist/

A single Node script (`scripts/merge-dist.mjs`) MUST be the only place where the two build outputs are combined. The script MUST:

1. Recreate the root `dist/` directory (delete then mkdir).
2. Copy `web/dist/**` recursively into `dist/`.
3. Copy `app/dist/**` recursively into `dist/app/`.
4. Copy `shared/manifest.webmanifest` to `dist/manifest.webmanifest`.
5. Copy `shared/sw.js` to `dist/sw.js`.
6. Copy `shared/icons/**` recursively into `dist/icons/`.
7. Copy root `_headers` to `dist/_headers`.
8. Copy root `_redirects` to `dist/_redirects`.
9. Print a summary (file count and total byte size) to stdout.

The script MUST use only Node 22+ built-ins (`node:fs/promises`, `node:path`, `node:url`) and MUST NOT depend on any external npm package. The script MUST exit with status 1 (and a clear error message) on any error.

#### Scenario: Merge produces a valid composite layout
- **GIVEN** `web/dist/` and `app/dist/` both exist with at least an `index.html` each
- **WHEN** `node scripts/merge-dist.mjs` runs
- **THEN** `dist/index.html` is present (from web)
- **AND** `dist/app/index.html` is present (from app)
- **AND** `dist/manifest.webmanifest`, `dist/sw.js`, `dist/icons/`, `dist/_headers`, `dist/_redirects` all exist

#### Scenario: Merge has no external dependencies
- **GIVEN** the merge script
- **WHEN** the file is parsed
- **THEN** every `import` statement references either `node:` built-ins or other files inside `scripts/`
- **AND** no `require()` of an external package is present

#### Scenario: Merge fails loud on missing input
- **GIVEN** `web/dist/` does not exist
- **WHEN** `node scripts/merge-dist.mjs` runs
- **THEN** the process exits with status 1
- **AND** stderr contains a message naming the missing directory

### Requirement: Merge detects path collisions before writing

The merge script MUST detect collisions between the marketing site's emitted files and the app's emitted files. Specifically: if a file path under `web/dist/` (after copying to `dist/`) would be overwritten by a file copied from `app/dist/` (which is copied to `dist/app/<X>` — the prefix prevents most collisions, but the script MUST still verify), the script MUST fail before producing partial output. The marketing site's `dist/index.html` MUST NEVER be overwritten by the app's output.

#### Scenario: Collision aborts the merge
- **GIVEN** a hypothetical scenario where `app/dist/` produced a file that, after the `dist/app/` prefixing, would still collide with a `web/dist/` file
- **WHEN** the merge runs
- **THEN** the process exits with status 1 before any merged file is written
- **AND** stderr names the colliding path

#### Scenario: dist/index.html always comes from web
- **GIVEN** a normal build of both sides
- **WHEN** the merge completes
- **THEN** the byte content of `dist/index.html` exactly matches `web/dist/index.html`

### Requirement: Validation script asserts the merged dist/ is well-formed

A second Node script (`scripts/validate-build.mjs`) MUST run after the merge script and MUST assert:

1. `dist/index.html` exists and contains `<link rel="manifest" href="/manifest.webmanifest">`.
2. `dist/index.html` contains a script tag that registers `/sw.js` (matched by regex against the page source).
3. `dist/app/index.html` exists.
4. `dist/sw.js` exists and its byte length equals the byte length of `shared/sw.js` (defensive: ensures the merge copied the right file).
5. `dist/app/sw.js` exists.
6. `dist/manifest.webmanifest` exists, parses as JSON, and contains `start_url: '/app/'` and `scope: '/app/'`.
7. `dist/_headers` and `dist/_redirects` exist.
8. `dist/sitemap.xml` exists.

The script MUST exit with status 1 on any failed assertion and MUST print which assertion failed.

#### Scenario: Validation passes on a correct build
- **GIVEN** a successful merge
- **WHEN** `node scripts/validate-build.mjs` runs
- **THEN** the process exits with status 0
- **AND** stdout reports each assertion as passing

#### Scenario: Validation fails when the manifest link is missing
- **GIVEN** a hypothetical build where the marketing landing's `<head>` does not link the manifest
- **WHEN** `node scripts/validate-build.mjs` runs
- **THEN** the process exits with status 1
- **AND** stderr contains a message naming the missing `<link rel="manifest">` assertion

### Requirement: Cloudflare Pages _headers file controls per-path caching, security, and SW scope

The `_headers` file at the repo root (copied by the merge script to `dist/_headers`) MUST set:

- `/sw.js`: `Cache-Control: no-cache, no-store, must-revalidate` AND `Service-Worker-Allowed: /`.
- `/app/sw.js`: `Cache-Control: no-cache, no-store, must-revalidate` AND `Service-Worker-Allowed: /app/`.
- `/manifest.webmanifest`: `Cache-Control: public, max-age=3600` AND `Content-Type: application/manifest+json`.
- `/icons/*`: `Cache-Control: public, max-age=31536000, immutable`.
- `/_astro/*` (Astro hashed assets from web build): `Cache-Control: public, max-age=31536000, immutable`.
- `/app/assets/*` (Vite hashed assets from app build): `Cache-Control: public, max-age=31536000, immutable`.
- `/*.html` and `/`: `Cache-Control: public, max-age=0, must-revalidate`.
- `/app/*`: `Cache-Control: public, max-age=0, must-revalidate`.
- Global `/*`: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
- `/app/*`: a `Content-Security-Policy` derived from the app's observed network surface (allowlist of `connect-src`, `script-src`, `style-src`, `img-src`, `font-src`, `frame-src` matching exactly the origins the app actually uses; defaults of `default-src 'self'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`).

#### Scenario: Service worker headers prevent stale SW pinning
- **GIVEN** the production deploy
- **WHEN** `https://tricho.app/sw.js` is fetched
- **THEN** the response headers include `Cache-Control: no-cache, no-store, must-revalidate`
- **AND** the response headers include `Service-Worker-Allowed: /`

#### Scenario: Hashed asset is served immutable
- **GIVEN** a built marketing page references `/_astro/page.abcd1234.js`
- **WHEN** that asset is fetched
- **THEN** the response includes `Cache-Control: public, max-age=31536000, immutable`

#### Scenario: HSTS and X-Frame headers apply globally
- **GIVEN** any page on the production deploy
- **WHEN** the response headers are inspected
- **THEN** `X-Frame-Options: DENY` is present
- **AND** `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` is present

#### Scenario: CSP is scoped to /app/* and reflects observed traffic
- **GIVEN** the production deploy
- **WHEN** `https://tricho.app/app/` is fetched
- **THEN** a `Content-Security-Policy` header is present
- **AND** its `connect-src` directive lists exactly the origins the PWA's runtime actually contacts (no wildcards beyond `'self'`)

### Requirement: Cloudflare Pages _redirects file provides SPA fallback and trailing-slash normalization

The `_redirects` file at the repo root (copied to `dist/_redirects`) MUST contain at minimum:

```
/app/*  /app/index.html  200
/app    /app/            301
```

The order MUST place the `200` rewrite before the `301` so the rewrite covers `/app/foo` deep links and the redirect handles only the bare `/app` form.

#### Scenario: Deep link reload serves SPA shell
- **GIVEN** the production deploy
- **WHEN** `https://tricho.app/app/clients/abc-123` is fetched
- **THEN** the response status is 200
- **AND** the response body is the content of `dist/app/index.html`

#### Scenario: Bare /app redirects to /app/
- **GIVEN** the production deploy
- **WHEN** `https://tricho.app/app` is fetched
- **THEN** the response status is 301
- **AND** the `Location` header is `https://tricho.app/app/`

### Requirement: Root dist/, node_modules/, and .astro/ are gitignored

The `.gitignore` at the repo root MUST exclude `dist/`, `node_modules/` (anywhere in the tree), `.astro/`, `app/dist/`, `web/dist/`, and any common build cache (`.cache/`). The merge script's output directory MUST never be committed; it is rebuilt on every CI run.

#### Scenario: dist is not tracked
- **GIVEN** a fresh build produces `dist/` at the root
- **WHEN** `git status --porcelain dist/` runs
- **THEN** the output is empty (dist is fully ignored)

#### Scenario: node_modules anywhere is not tracked
- **GIVEN** `web/node_modules/`, `app/node_modules/`, and any other `node_modules/` exist
- **WHEN** `git status --porcelain` runs
- **THEN** no `node_modules` paths appear in the output
