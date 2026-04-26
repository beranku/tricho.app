## Why

Today `tricho.app` serves only the PWA shell. A first-time visitor lands on the welcome wizard's "Install Tricho" Step 1 with zero marketing context — no description of what Tricho is, no pricing, no help, no proof, no SEO surface for Google or AI crawlers. The shell is also actively hostile to the casual browser visitor: it's an empty SPA loader whose only purpose is to be installed. We are pre-launch and the moment we open public sign-ups, the apex needs to do double duty as a credible product website *and* a PWA install target — without breaking the install criteria, the offline behavior, or the zero-knowledge invariants that the rest of the system depends on.

The right topology is one Cloudflare Pages project, one origin, two surfaces:

- **Marketing site at `/`** — fully static Astro pages (landing, pricing, blog, help, legal). Crawlable, fast, sharable. The landing page links the shared Web App Manifest so Chrome/Edge/Brave/Android show their native install UI directly; iOS Safari gets an inline Add-to-Home-Screen banner.
- **PWA shell at `/app/`** — the existing Astro + React + vite-pwa application, with `start_url` and SW scope migrated from `/` to `/app/`. After install, the icon launches `/app/`, never the marketing site.

Migrating to Cloudflare Pages at the same time unblocks a few capabilities GitHub Pages can't: per-PR preview URLs (so design and copy can be reviewed before merge), per-route header rules (`Service-Worker-Allowed`, CSP, immutable cache for hashed assets), redirects (`/app/* → /app/index.html` SPA fallback), and atomic-rollback deploys.

This is also the right moment to harden release engineering for the PWA itself: a `vX.Y.Z` semver story with an in-app version readout so support can answer "what version are you on?" reliably, and a tag-driven GitHub Release with auto-generated notes that the in-app About screen links to.

## What Changes

### Repository topology

- **NEW** Top-level `web/` folder: a fresh Astro 5 project for the marketing site. Independent `package.json`, independent lockfile, independent `node_modules`. Builds to `web/dist/`. No monorepo tooling.
- **NEW** Top-level `app/` folder: the existing PWA, moved as-is from the repo root via `git mv` so blame/history is preserved. Owns its existing `package.json`, `vite.config` style integrations (currently `astro.config.mjs`), tests, and build. Builds to `app/dist/`.
- **NEW** Top-level `shared/` folder: `manifest.webmanifest`, the thin pass-through service worker (`sw.js`), brand icons (192/512 + maskable), default Open Graph image, favicon. The single source of truth for assets that both surfaces reference.
- **NEW** Top-level `scripts/merge-dist.mjs` and `scripts/validate-build.mjs`: orchestration that combines `web/dist/` → `dist/`, `app/dist/` → `dist/app/`, and shared assets at the right paths. Validates collisions (the marketing `/index.html` MUST never be overwritten by the app), and asserts every required artifact exists.
- **NEW** Root `_headers` and `_redirects` for Cloudflare Pages.
- **MOVED** `astro.config.mjs`, `src/`, `public/`, `tsconfig.json`, `vitest.config.*.ts`, `playwright.config.ts`, `playwright.prototype-ui.config.ts`, `project.inlang/`, `package.json`, `package-lock.json` → `app/`. Existing scripts, Makefile targets, and devcontainer paths that reference the root are updated.

### PWA scope and install criteria

- **MODIFIED** Shared manifest: `start_url` and `scope` move from `/` to `/app/`. `name`, `short_name`, `theme_color`, `background_color`, `lang` are preserved from today's manifest so existing installs that survive the cutover see no visual jump.
- **NEW** Thin pass-through service worker at `/sw.js` with `Service-Worker-Allowed: /`. Sole purpose: satisfy install criteria on the apex. It MUST NOT cache (the marketing site relies on Cloudflare's edge cache + CDN headers, not SW caches).
- **MODIFIED** Full PWA service worker (`@vite-pwa/astro` Workbox output) registers at `/app/sw.js` with `{ scope: '/app/' }` and serves `Service-Worker-Allowed: /app/`. Today it lives at `/sw.js` scope `/`.
- **NEW** Both `/` (marketing landing) and `/app/` (PWA shell) link the same `/manifest.webmanifest` so the browser-native install UI fires from either surface.
- **NEW** iOS-Safari install banner on the marketing landing: when `navigator.standalone === false` AND user-agent is iOS Safari, render an inline Czech-voice instruction card (share sheet → Add to Home Screen). Hidden on standalone (already-installed) and on every non-iOS browser. The wizard's existing Step 1 iOS instructions inside `/app/` remain unchanged.
- **NEW** "Launch app" link on the marketing landing when `display-mode: standalone` evaluates true (i.e. the user opened the marketing URL from inside the installed app), routing to `/app/`.

### Build pipeline

- **NEW** `node scripts/merge-dist.mjs` is the only place where the two builds combine. Algorithm: clear `dist/`, copy `web/dist/**` → `dist/`, copy `app/dist/**` → `dist/app/`, copy `shared/manifest.webmanifest` → `dist/manifest.webmanifest`, copy `shared/sw.js` → `dist/sw.js`, copy `shared/icons/**` → `dist/icons/`, copy root `_headers` and `_redirects` to `dist/`.
- **NEW** `node scripts/validate-build.mjs` asserts: no path collisions; `dist/index.html` came from web; `dist/app/index.html` came from app; `dist/sw.js`, `dist/app/sw.js`, `dist/manifest.webmanifest`, `dist/_headers`, `dist/_redirects` all exist; marketing HTML linked manifest is `/manifest.webmanifest`; SW registration in app build references `/app/sw.js` with `scope: '/app/'`.
- **NEW** `_redirects`: `/app/* /app/index.html 200` (SPA fallback) and `/app /app/ 301` (trailing-slash normalization).
- **NEW** `_headers`: per-path `Cache-Control` (immutable for hashed `/_astro/*` and `/app/assets/*`, no-store for both service workers, max-age=3600 for the manifest, no-cache+must-revalidate for HTML), `Service-Worker-Allowed` for both SW paths, global security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS), and a tight CSP scoped to `/app/*` derived by inspecting the actual network surface of the existing app.

### CI/CD migration: GitHub Pages → Cloudflare Pages

- **REMOVED** `.github/workflows/deploy.yml` (GitHub Pages upload). The `CNAME` file at the repo root is removed (Cloudflare Pages uses the dashboard-attached custom domain instead).
- **NEW** `.github/workflows/ci.yml` with a `dorny/paths-filter@v3`-driven changes job, parallel `test-web` and `test-app` jobs that run `lint` + `typecheck` + `build` (and `test` for app), a `build-and-deploy` job that downloads or rebuilds artifacts, runs the merge + validate scripts, and deploys via `cloudflare/wrangler-action@v3 pages deploy dist --project-name=tricho`. PR runs deploy to a preview URL and a `github-script` step posts the URL to the PR. Pushes to `main` deploy to production.
- **NEW** Required GitHub Actions secrets: `CLOUDFLARE_API_TOKEN` (Pages-Edit scope only), `CLOUDFLARE_ACCOUNT_ID`. Documented in `README.md`.
- **MOVED** `.github/workflows/tests.yml` continues to run app tests; updated `working-directory: app` and updated path filters.
- **NEW** Branch protection on `main` requires `Test web`, `Test app`, and `Build merged dist & deploy` to pass.
- **NEW** Direct-Upload project `tricho` is created once (`wrangler pages project create tricho --production-branch=main`); custom domain `tricho.app` (and `www.tricho.app` 301-to-apex) attached after first successful deploy.

### Versioning and release

- **NEW** `app/package.json` `version` is the canonical PWA version. Tags follow `app-v<semver>` (prefix-namespaced so the marketing side can later add `web-v*` if desired).
- **NEW** `app/astro.config.mjs` (or `app/vite.config.ts` shim) injects `__APP_VERSION__`, `__APP_BUILD_TIME__`, `__APP_COMMIT__` (`process.env.GITHUB_SHA?.slice(0, 7) || 'dev'`) into the build via `define`.
- **NEW** Settings → About displays version + build time + commit, with a link to `https://github.com/<org>/<repo>/releases/tag/app-v<version>`.
- **NEW** `.github/workflows/release-app.yml` triggers on `app-v*` tag push: extracts version from tag, generates notes from `git log --pretty=format:"- %s" "<prev-tag>..HEAD" -- app/`, publishes a `softprops/action-gh-release@v2` release.
- **MODIFIED** Service worker registration switches from `registerType: 'autoUpdate'` (today) to `registerType: 'prompt'` with `clientsClaim: false` and `skipWaiting: false`. The unlocked shell renders a small "Nová verze připravena — restartovat" banner when a waiting SW is detected; tapping posts `{ type: 'SKIP_WAITING' }` to `registration.waiting` and reloads. **Reason:** silent auto-update mid-session can race with the in-memory DEK and an open `VaultDb`. User-controlled update is safer and preserves the offline-first contract.

### SEO surface

- **NEW** Per-page `<title>`, `<meta description>`, `<link rel="canonical">`, Open Graph (`og:title`, `og:description`, `og:image`, `og:url`, `og:type`, `og:site_name`, `og:locale`), Twitter Card metadata, `<meta name="theme-color">`, Apple-touch-icon. Astro layout-driven, no hand-written boilerplate per page.
- **NEW** Site-wide: `@astrojs/sitemap` generates `/sitemap.xml` (excluding `/app/*`); `@astrojs/rss` generates `/blog/rss.xml`; `JSON-LD` blocks for `Organization` (landing), `SoftwareApplication` (landing + pricing), `Article` (blog posts).
- **NEW** `/robots.txt` allows all crawlers, disallows `/app/`, points at `/sitemap.xml`.
- **NEW** Per-blog-post Open Graph image (build-time render of post title on a branded background using `@vercel/og` or Satori); other pages share `/og/default.png`.

### Operator runbook

- **NEW** `ARCHITECTURE.md` (abridged version of the implementation spec, ~2 pages): repository topology, two-SW topology, build pipeline, deploy pipeline, versioning workflow, where preview URLs come from, how to roll back via Cloudflare dashboard.
- **MODIFIED** `README.md` documents: developing the marketing site (`cd web && npm install && npm run dev`), developing the app (`cd app && npm install && npm run dev`), running merged-dist locally (`npm install --prefix web && npm install --prefix app && npm run build --prefix web && npm run build --prefix app && node scripts/merge-dist.mjs && node scripts/validate-build.mjs`), required Cloudflare secrets, releasing the PWA (`npm version patch` in `app/`, prefix the tag with `app-v`, push).

## Capabilities

### New Capabilities

- `marketing-site`: Static, pre-rendered Astro 5 marketing surface served at the apex (`/`, `/about`, `/pricing`, `/blog/**`, `/help/**`, `/legal/**`, `/404`). Owns SEO metadata generation, sitemap, robots.txt, RSS feed, JSON-LD structured data, per-post Open Graph image rendering, and the iOS-Safari install banner. Inherits brand tokens (paper grain, copper accents, Fraunces serif headings, Patrick Hand body) from the existing app design system so the cross-surface jump from `/` to `/app/` is visually seamless.
- `pwa-shell-routing`: Manifest scope and start_url move from `/` to `/app/`; the manifest is shared between the marketing site and the app shell; the install criteria are satisfied on the apex via a thin pass-through `/sw.js` whose only job is to exist; the full PWA service worker registers at `/app/sw.js` with `scope: '/app/'`. Owns the install-prompt UX from both surfaces, the iOS standalone-detect "Launch app" affordance on `/`, and the relocation of the wizard's PWA-storage-origin floor from `/` to `/app/`.
- `static-build-merge`: Build orchestration. Each top-level package builds independently; a single Node 22+ script (`scripts/merge-dist.mjs`, no external dependencies) composes the two outputs into a single deployable `dist/`, copies shared assets, and drops `_headers` + `_redirects` at the root. A second script (`scripts/validate-build.mjs`) asserts the merged result is well-formed before deploy. Owns the Cloudflare Pages `_headers` and `_redirects` files.
- `cloudflare-pages-deploy`: GitHub Actions CI/CD pipeline. Path-filtered jobs skip the unaffected side; PR runs deploy to a unique preview URL and post the link as a PR comment; pushes to `main` deploy to production via Cloudflare Pages Direct Upload (`wrangler pages deploy dist --project-name=tricho`). Owns the secrets contract (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`), the branch-protection requirements, and the rollback story (one-click in the Cloudflare dashboard).
- `app-release-versioning`: PWA semver. `app/package.json` `version` is canonical; `app-v*` tags drive a GitHub Release with auto-generated notes from `app/`-scoped commits since the previous `app-v*` tag. The build embeds `__APP_VERSION__`, `__APP_BUILD_TIME__`, `__APP_COMMIT__` constants which Settings → About displays alongside a link to the GitHub Release. Owns the user-controlled SW update prompt (`registerType: 'prompt'` with explicit `SKIP_WAITING` on user tap) — a deliberate change from today's silent auto-update because a mid-session SW takeover can race with the in-memory DEK and the open `VaultDb`.

### Modified Capabilities

- `welcome-onboarding-wizard`: The pre-unlock surface URL changes from `/` to `/app/`. Specifically: the wizard MUST be mounted from `app/src/pages/index.astro` (which builds to `dist/app/index.html` and is served at `/app/`), not `src/pages/index.astro` at the apex. Existing scenarios keyed on "visiting the root" reword to "visiting `/app/`". The PWA-storage-origin floor (`window.matchMedia('(display-mode: standalone)').matches`) still applies; the install target URL the wizard's Step 1 references becomes `tricho.app/app` (canonical browser-mode entry) but the manifest's `start_url: /app/` ensures the installed icon launches `/app/` directly. The reducer's invariants (one-way step transitions, browser-mode hard-stop, PWA detection on every mount) are preserved verbatim. No crypto, no auth, no i18n changes — this is a routing-only modification.

## Impact

- **Code (PWA — moves into `app/`)**:
  - `src/`, `public/`, `astro.config.mjs`, `tsconfig.json`, `vitest.config.*.ts`, `playwright.config.ts`, `playwright.prototype-ui.config.ts`, `project.inlang/`, `package.json`, `package-lock.json` → `app/` via `git mv`.
  - `app/astro.config.mjs` updates: `site: 'https://tricho.app/app'`, `base: '/app/'`, `outDir: 'dist'` (relative to `app/`), `@vite-pwa/astro` config gains explicit `scope: '/app/'` + `srcDir: 'src'` + `filename: 'sw.js'` + `manifest: false` (manifest comes from `shared/`, not generated), and registers the SW with `{ scope: '/app/' }` rather than relying on the default.
  - `app/src/pages/index.astro` is unchanged in content but now produces `dist/index.html` *inside the app's own dist*, which the merge script places at `dist/app/index.html`.
  - `app/src/components/AppShell.tsx` and downstream components: relative-route assumptions (anything that hardcodes `'/'`) audited; replaced with `import.meta.env.BASE_URL` (Vite's standard) so the same code works at any base path.
  - `app/src/components/welcome/wizard-state.ts` PWA-detect remains identical (it reads `display-mode`, not the URL).
  - `app/src/components/SettingsScreen.tsx` adds the version/build/commit readout and the GitHub Releases link.
  - `app/src/lib/sw-update.ts` (new): exposes a small store `swUpdate$` that reflects "no waiting SW", "waiting SW present"; `AppShell` renders a banner driven by it; `app/src/main.ts` registers the SW with `registerType: 'prompt'` semantics and wires `swUpdate$`.

- **Code (marketing — new `web/`)**:
  - `web/package.json` with Astro 5, `@astrojs/sitemap`, `@astrojs/rss`, `@astrojs/mdx`. Independent lockfile.
  - `web/astro.config.mjs` with `site: 'https://tricho.app'`, sitemap + RSS integrations, `output: 'static'`.
  - `web/src/pages/{index,about,pricing,404}.astro`, `web/src/pages/blog/{index,[slug]}.astro`, `web/src/pages/help/{index,[...slug]}.astro`, `web/src/pages/legal/*.astro`.
  - `web/src/content/{blog,help}/` MDX collections with frontmatter (title, description, date, tags, ogImage).
  - `web/src/layouts/Base.astro` owns the `<head>` (manifest link, theme-color, OG, Twitter Cards, JSON-LD, sitemap link, favicon, apple-touch-icon, the thin SW registration script, and the iOS-Safari install banner mount).
  - `web/src/components/InstallBanner.astro` (iOS Safari-only banner) and `web/src/components/LaunchAppLink.astro` (standalone-only "Launch app" affordance).
  - `web/src/styles/` shares the brand tokens with the app (paper grain texture, copper accent, Fraunces + Patrick Hand + Geist Mono webfonts) — copied into `web/src/styles/tokens.css` rather than imported across packages, since there is no monorepo tooling.

- **Code (shared)**:
  - `shared/manifest.webmanifest` (one source of truth, served at `/manifest.webmanifest`).
  - `shared/sw.js` (~15 lines: `install` skipWaiting, `activate` clients.claim, `fetch` no-op pass-through).
  - `shared/icons/` (192, 512, maskable-192, maskable-512, favicon.ico, favicon.svg). Generated from the existing `public/favicon.svg`.
  - `shared/og/default.png` (default Open Graph image, 1200×630).

- **Build orchestration**:
  - `scripts/merge-dist.mjs`, `scripts/validate-build.mjs` (Node 22+ built-ins only — `node:fs`, `node:path`, `node:url`).
  - Root `_headers`, `_redirects`.
  - Root `dist/` is generated; gitignored.

- **CI/CD**:
  - `.github/workflows/ci.yml` (new) replaces `.github/workflows/deploy.yml` (deleted).
  - `.github/workflows/tests.yml` updated: `working-directory: app`, path filter `app/**`, Node 22.
  - `.github/workflows/release-app.yml` (new) triggers on `app-v*` tag push.
  - `.github/workflows/e2e.yml` (existing, referenced from `deploy.yml` comment) updated: `working-directory: app`, path filter `app/**`.
  - Removed: `CNAME` file at repo root.

- **Operator-side (manual, documented in README)**:
  - GitHub repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (one-time).
  - `wrangler pages project create tricho --production-branch=main` (one-time, locally).
  - Cloudflare dashboard: attach `tricho.app` and `www.tricho.app` (301 → apex) custom domains after first successful deploy.
  - Cloudflare dashboard: enable Cloudflare Web Analytics (or operator-chosen alternative — analytics is explicitly out of scope).
  - GitHub repository: branch-protection rules on `main` requiring `Test web`, `Test app`, `Build merged dist & deploy` status checks.
  - GitHub Pages disabled in repo settings (no longer the deploy target).

- **Zero-knowledge invariants**: **unchanged.** This change reorganises the static surface and the build/deploy pipeline. The crypto envelope, the AAD binding, the `vault-state` doc shape, the `tricho-auth` JWT contract, the `couch_peruser` model, the `wrappedDekRs/wrappedDekPrf/wrappedDekPin` keystore — none are touched. The marketing site is plain HTML+CSS that never sees plaintext data, never holds a DEK, never opens a `VaultDb`, and never speaks to CouchDB or `tricho-auth`. The IndexedDB origin remains `tricho.app`, so any keystore data already persisted by an earlier installation survives the cutover (although since this is pre-launch, no production users exist yet).

- **Performance budget** (for the marketing landing): LCP < 2.0s on 4G mobile, CLS < 0.1, TBT < 150ms, total HTML+CSS+critical JS for `/` < 100 KB compressed. Astro's static output and selective islands hydration make this the default rather than the goal; the budget is a regression guard.

- **Out of scope** (will not be added by this change, even if discussed): Cloudflare Workers, subdomain split (`app.tricho.app`), monorepo tooling (Turborepo, Nx, npm/pnpm workspaces), backend changes, auth changes, e2e infrastructure beyond updating paths, marketing-site i18n (Czech-only at launch; Astro i18n routing can be added later), analytics integration (operator picks Cloudflare Web Analytics / Plausible / Umami separately), per-locale manifest variants (deferred per existing `welcome-onboarding-wizard` non-goal), and rich blog content (the blog ships as a working skeleton with one welcome-post; editorial content is a separate workstream).
