## 1. Pre-flight: audit + branch + operator prerequisites

- [ ] 1.1 Audit `src/` for hardcoded `'/'` URLs that the move to `base: '/app/'` would break: run `grep -rn "from '/" src/`, `grep -rn "href=\"/" src/`, `grep -rn "src=\"/" src/`, `grep -rn "fetch('/" src/`. Document each hit in a scratch file (`/tmp/url-audit.md`); decide per hit whether to use `import.meta.env.BASE_URL`, a relative URL, or leave as-is (e.g. `/_users` and `/auth/*` are server-routed and stay at apex).
- [ ] 1.2 Audit `src/` for runtime references to `/sw.js` (the registration call): identify the file and line. Plan the replacement with `/app/sw.js` + explicit scope.
- [ ] 1.3 Audit `astro.config.mjs` and `@vite-pwa/astro` config: identify `start_url`, `scope`, `manifest`, `registerType`, `strategies`, `workbox.*` settings that the change must rewrite.
- [ ] 1.4 Audit `playwright.config.ts` and `playwright.prototype-ui.config.ts` for any `baseURL: '/'` or path constants that need rewriting to `/app/`.
- [ ] 1.5 Audit `Makefile` and `compose.yml` for any path that references the repo root as the app dir (e.g. `WORKDIR /app` is fine, but `COPY ./src ./src` becomes `COPY ./app/src ./src`).
- [ ] 1.6 Operator: create `CLOUDFLARE_API_TOKEN` (Cloudflare Pages — Edit scope only) and add as repo secret. Find `CLOUDFLARE_ACCOUNT_ID` and add as repo secret. Document both in scratch notes; the README update happens in §11.
- [ ] 1.7 Operator: run `npx wrangler pages project create tricho --production-branch=main` once locally. Note the output URL (`<project>.pages.dev`).

## 2. Restructure: move PWA into app/ via git mv

- [ ] 2.1 Create branch `marketing-site-and-pwa-split` from `main`.
- [ ] 2.2 `mkdir app` at the repo root.
- [ ] 2.3 `git mv` each of: `src/`, `public/`, `astro.config.mjs`, `tsconfig.json`, `package.json`, `package-lock.json`, `vitest.config.unit.ts`, `vitest.config.component.ts`, `vitest.config.backend.ts`, `vitest.config.integration.ts`, `vitest.config.base.ts`, `playwright.config.ts`, `playwright.prototype-ui.config.ts`, `project.inlang/`, `coverage-baseline.json`, `tests/` → `app/`. Run `npm test` after the move (from inside `app/`) to confirm the test suite still discovers + runs.
- [ ] 2.4 Move ancillary scripts: `git mv scripts/ app/scripts/` if those scripts are app-specific. (Only `merge-dist.mjs` and `validate-build.mjs` will live at the new root `scripts/`.)
- [ ] 2.5 Update `.gitignore` to ignore `dist/`, `app/dist/`, `web/dist/`, `app/.astro/`, `web/.astro/`, `app/coverage/`, `app/playwright-report/`, `app/test-results/`. Verify previously gitignored entries (`coverage/`, `playwright-report/`, `test-results/`) still exclude the new paths.
- [ ] 2.6 Verify `cd app && npm install && npm run build` succeeds and produces `app/dist/index.html` plus the existing offline page.
- [ ] 2.7 Verify `cd app && npm run test` and `cd app && npm run typecheck` both pass.

## 3. Reconfigure app for /app/ base path

- [ ] 3.1 In `app/astro.config.mjs`: set `base: '/app/'`, `site: 'https://tricho.app/app'`, `outDir: 'dist'`. Verify the build emits `app/dist/index.html` at the package's local `dist/`, not at `app/dist/app/index.html`.
- [ ] 3.2 Reconfigure `@vite-pwa/astro` in `app/astro.config.mjs`: set `manifest: false` (we use `shared/manifest.webmanifest`), `injectRegister: false` (we register manually), `strategies: 'generateSW'`, `registerType: 'prompt'`, `workbox.clientsClaim: false`, `workbox.skipWaiting: false`, `workbox.cleanupOutdatedCaches: true`, `workbox.navigateFallback: '/app/offline'` (rebased), `workbox.globPatterns: ['**/*.{js,css,html,svg,woff2,webmanifest}']`. Keep the existing runtimeCaching rules.
- [ ] 3.3 Add explicit `scope: '/app/'` and `srcDir: 'src'` and `filename: 'sw.js'` to the AstroPWA config so the SW emits at `app/dist/sw.js` (which the merge places at `dist/app/sw.js`).
- [ ] 3.4 Add `define` block for build constants in the Vite config nested inside `app/astro.config.mjs`: `__APP_VERSION__: JSON.stringify(pkg.version)`, `__APP_BUILD_TIME__: JSON.stringify(new Date().toISOString())`, `__APP_COMMIT__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) || 'dev')`. Read `pkg` via `JSON.parse(readFileSync('./package.json','utf8'))` in the config module.
- [ ] 3.5 Add `app/src/vite-env.d.ts` declarations: `declare const __APP_VERSION__: string;`, `declare const __APP_BUILD_TIME__: string;`, `declare const __APP_COMMIT__: string;`. If the file already exists, append; otherwise create it.
- [ ] 3.6 Replace per-audit-§1.1 hardcoded `'/'` URLs in `app/src/` with `import.meta.env.BASE_URL` or relative URLs as appropriate. Skip backend-routed paths (`/auth/*`, `/_users/*`, `/userdb-*`).
- [ ] 3.7 Manual SW registration: replace any auto-registration in the existing PWA with explicit `navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' })` in `app/src/main.ts` (or the equivalent entry point). Confirm `injectRegister: false` is honored.
- [ ] 3.8 Run `cd app && npm run build` and verify `app/dist/index.html` references `/app/` for asset URLs (they should be prefixed automatically by Astro `base`).
- [ ] 3.9 Run `cd app && npm run preview` and visit `http://localhost:4321/app/` (Astro's preview server respects `base`). Confirm the wizard renders, install instructions show, OAuth links resolve to existing absolute backend paths.

## 4. shared/ assets

- [ ] 4.1 `mkdir shared` at the repo root.
- [ ] 4.2 Create `shared/manifest.webmanifest` with: `name: 'Tricho'`, `short_name: 'Tricho'`, `description` (one-sentence value prop, ~120 chars in Czech), `start_url: '/app/'`, `scope: '/app/'`, `display: 'standalone'`, `orientation: 'any'`, `background_color: '#FDFAF3'`, `theme_color: '#FDFAF3'`, `categories: ['productivity']`, `lang: 'cs'`, `dir: 'ltr'`, icons referencing `/icons/icon-192.png`, `/icons/icon-512.png`, plus maskable variants. Match `theme_color` and `background_color` to the existing PWA so no color flash on launch.
- [ ] 4.3 Create `shared/sw.js` per design D2: 15 lines, three handlers (`install` skipWaiting, `activate` clients.claim, `fetch` no-op return). Add a top-of-file comment explaining its role and the explicit "no caching" contract.
- [ ] 4.4 Generate icons from the existing `app/public/favicon.svg` (or design system source): `icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png`, `favicon.ico`, `favicon.svg`. Place in `shared/icons/`. Use ImageMagick or a one-off Node script — does not need to be checked into the repo as a build step.
- [ ] 4.5 Create `shared/og/default.png` (1200×630) — branded background with wordmark + tagline. Source: design hand-off or a one-off Figma/Excalidraw export.

## 5. New web/ marketing site

- [ ] 5.1 Inside `web/`, run `npm create astro@latest .` accepting "Empty" template, TypeScript strict, and skip git initialization (we're inside an existing repo). Result: `web/package.json`, `web/astro.config.mjs`, `web/src/pages/`, `web/tsconfig.json`, `web/.gitignore`. Append `web/dist/` and `web/.astro/` to root `.gitignore` (already done in §2.5).
- [ ] 5.2 Install integrations in `web/`: `@astrojs/sitemap`, `@astrojs/rss`, `@astrojs/mdx`. Lockfile committed.
- [ ] 5.3 Configure `web/astro.config.mjs`: `site: 'https://tricho.app'`, `output: 'static'`, integrations: `sitemap({ filter: (page) => !page.startsWith('https://tricho.app/app') })`, `mdx()`. No `base` (web lives at apex).
- [ ] 5.4 Create `web/src/layouts/Base.astro` per design D14: accepts `Props { title, description, canonical?, ogImage?, ogType?, noIndex? }`, renders the entire `<head>` (title, meta description, canonical, manifest link, theme-color matching `shared/manifest.webmanifest`, apple-touch-icon, favicon, OG tags, Twitter Card tags, JSON-LD `Organization` block, sitemap link, optional analytics slot). Include the inline thin-SW registration script and the inline iOS install banner reveal script (per design D15).
- [ ] 5.5 Create `web/src/components/InstallBanner.astro`: hidden `<div data-install-banner hidden>` with Czech ATHS instructions. Dismiss button writes `localStorage.setItem('install-banner-dismissed','1')`. The reveal script in Base.astro checks `iOS && !standalone && !dismissed`.
- [ ] 5.6 Create `web/src/components/LaunchAppLink.astro`: hidden `<a data-launch-app hidden href="/app/">Otevřít aplikaci</a>`, revealed by inline `if (matchMedia('(display-mode: standalone)').matches) document.querySelector('[data-launch-app]')?.removeAttribute('hidden')`.
- [ ] 5.7 Create `web/src/styles/tokens.css` by copying brand tokens from `app/src/styles/`: `--copper`, `--copper-mid`, `--copper-border`, `--ink-espresso`, `--ink-3`, `--surface`, paper-grain background URL, font face declarations for Fraunces / Patrick Hand / Geist. Add a header comment cross-referencing the app's tokens file for parity audits.
- [ ] 5.8 Copy webfonts from `app/public/fonts/` to `web/public/fonts/` (or symlink at build time — but per design D13, duplicate to avoid cross-package coupling).
- [ ] 5.9 Create `web/src/pages/index.astro` (landing page): hero with wordmark + tagline + value prop, three-feature explainer, social proof placeholder, pricing-summary card, install/launch CTA section using `InstallBanner` and `LaunchAppLink`. Pass landing-specific props to `BaseLayout` (title, description, JSON-LD `SoftwareApplication`).
- [ ] 5.10 Create `web/src/pages/about.astro`: ~one-screen About page with brand story.
- [ ] 5.11 Create `web/src/pages/pricing.astro`: render plan tiers from the `billing-plans` capability. Wire CTA to `/app/?intent=upgrade` for paid tiers, `/app/` for Free.
- [ ] 5.12 Create `web/src/pages/404.astro`: 404 page with site chrome and a back-to-home link.
- [ ] 5.13 Create `web/src/content/config.ts` with two collections: `blog` (frontmatter: `title`, `description`, `date`, `tags?`, `ogImage?`) and `help` (frontmatter: `title`, `description`, `category?`).
- [ ] 5.14 Create `web/src/pages/blog/index.astro` (list view, newest first), `web/src/pages/blog/[...slug].astro` (post detail with `Article` JSON-LD), `web/src/pages/blog/rss.xml.js` (using `@astrojs/rss`).
- [ ] 5.15 Create `web/src/pages/help/index.astro` (list view, optional category grouping), `web/src/pages/help/[...slug].astro` (article detail).
- [ ] 5.16 Create `web/src/content/blog/welcome-to-tricho.mdx` (one welcome post; covers what Tricho is and the zero-knowledge contract in plain Czech).
- [ ] 5.17 Create `web/src/content/help/getting-started.mdx` (one welcome help article: how to install, how to back up).
- [ ] 5.18 Create `web/src/pages/legal/{privacy,terms,gdpr}.astro` as skeletons (`title`, single placeholder `<p>` saying "Pracujeme na finální verzi — kontakt: info@tricho.app"). Add `noIndex: true` to suppress SEO until content lands.
- [ ] 5.19 Create `web/public/robots.txt` (static): `User-agent: *\nAllow: /\nDisallow: /app/\n\nSitemap: https://tricho.app/sitemap.xml`.
- [ ] 5.20 Add `web/package.json` scripts: `dev`, `build`, `preview`, `lint` (use Astro's recommended ESLint config or `astro check`), `typecheck` (`astro check && tsc --noEmit`).
- [ ] 5.21 Run `cd web && npm install && npm run build` and verify `web/dist/index.html`, `web/dist/sitemap.xml`, `web/dist/robots.txt`, `web/dist/blog/rss.xml`, `web/dist/404.html` all exist.
- [ ] 5.22 Run `cd web && npm run preview` and click through every route; verify no 404s and that JSON-LD parses (browser DevTools console).

## 6. Per-blog-post Open Graph image rendering

- [ ] 6.1 Install `@vercel/og` (or `satori` directly) inside `web/`.
- [ ] 6.2 Create `web/src/pages/og/blog/[...slug].png.ts` (Astro endpoint): for each blog slug, render a 1200×630 PNG with the post title in Fraunces over the brand background, return as `Response` with `Content-Type: image/png`.
- [ ] 6.3 Update blog frontmatter in `web/src/content/blog/welcome-to-tricho.mdx` to set `ogImage: '/og/blog/welcome-to-tricho.png'`.
- [ ] 6.4 Verify build emits `web/dist/og/blog/welcome-to-tricho.png` and the post's OG meta references it.

## 7. Build orchestration: scripts/

- [ ] 7.1 Create `scripts/merge-dist.mjs` per design D11: Node 22+ built-ins only, eight steps (delete dist, copy web→dist, copy app→dist/app with collision detection, copy shared/manifest, copy shared/sw, copy shared/icons, copy _headers, copy _redirects, summary). Exit non-zero on error.
- [ ] 7.2 Create `scripts/validate-build.mjs` per design D11: eight assertions (dist/index.html exists + links manifest + registers /sw.js, dist/app/index.html exists, dist/sw.js exists + matches shared/sw.js byte length, dist/app/sw.js exists, dist/manifest.webmanifest valid JSON with /app/ start_url and scope, dist/_headers exists, dist/_redirects exists, dist/sitemap.xml exists). Exit non-zero on any failure with a clear message.
- [ ] 7.3 Add a unit test for `merge-dist.mjs`: `scripts/merge-dist.test.mjs` (no test framework — plain Node `assert`) that builds two minimal fixtures, runs the merge, asserts the layout. Run via `node --test scripts/`.
- [ ] 7.4 Add a unit test for `validate-build.mjs` similarly: builds a known-good and known-bad dist, asserts the script's exit code.

## 8. Cloudflare Pages config: _headers and _redirects

- [ ] 8.1 Create `_redirects` at the repo root: two lines (`/app/* /app/index.html 200` and `/app /app/ 301`).
- [ ] 8.2 Create `_headers` at the repo root with the per-path rules from the static-build-merge spec §_headers requirement: SW headers (no-cache + Service-Worker-Allowed), manifest headers (3600 + Content-Type), icons (immutable), `/_astro/*` (immutable), `/app/assets/*` (immutable), HTML/root/`/app/*` (no-cache must-revalidate), global security headers (X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, HSTS).
- [ ] 8.3 Build the app locally, observe its network surface (open every screen reachable from `AppShell`'s view enum), record every external origin in a scratch file. Construct the `/app/*` CSP from the observed allowlist (`default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'` + observed-script origins, `style-src 'self' 'unsafe-inline'` if the React tree uses inline styles, `img-src 'self' data: blob:` + observed-image origins, `font-src 'self' data:`, `connect-src 'self'` + observed-API origins, `worker-src 'self'`, `manifest-src 'self'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`).
- [ ] 8.4 Add the constructed CSP to `_headers` under `/app/*` block.

## 9. CI/CD workflow: .github/workflows/ci.yml

- [ ] 9.1 Create `.github/workflows/ci.yml` per design D5–D6: `on: push: branches: [main]` and `on: pull_request: branches: [main]`; concurrency group with `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`.
- [ ] 9.2 Add `changes` job using `dorny/paths-filter@v3` with filters `web` (`web/**`), `app` (`app/**`), `shared` (`shared/**`), `infra` (`scripts/**`, `_headers`, `_redirects`, `.github/workflows/**`). Outputs flow into downstream jobs.
- [ ] 9.3 Add `test-web` job gated on `web || shared || infra`: setup-node 22 with `cache: npm` and `cache-dependency-path: web/package-lock.json`, `working-directory: web`, runs `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build`, then `actions/upload-artifact@v4` with `name: web-dist`, `path: web/dist`, `retention-days: 7`.
- [ ] 9.4 Add `test-app` job gated on `app || shared || infra`: setup-node 22 with `cache-dependency-path: app/package-lock.json`, `working-directory: app`, runs `npm ci`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, uploads `app-dist` artifact.
- [ ] 9.5 Add `build-and-deploy` job needing `[changes, test-web, test-app]` with `if: always() && !contains(needs.*.result, 'failure') && !contains(needs.*.result, 'cancelled')`. Permissions: `contents: read`, `deployments: write`, `pull-requests: write`.
- [ ] 9.6 In `build-and-deploy`: rebuild the side that was skipped (gated on the changes outputs being false). Otherwise download artifacts. Then `node scripts/merge-dist.mjs && node scripts/validate-build.mjs`.
- [ ] 9.7 Add `cloudflare/wrangler-action@v3` step deploying `dist`: `command: pages deploy dist --project-name=tricho --branch=${{ github.head_ref || github.ref_name }} --commit-hash=${{ github.sha }} --commit-message="${{ github.event.head_commit.message || github.event.pull_request.title }}"`. Wire `apiToken` and `accountId` from secrets.
- [ ] 9.8 Add `actions/github-script@v7` step (only on PR events) that posts the deployment URL and branch alias URL as a PR comment.
- [ ] 9.9 Delete `.github/workflows/deploy.yml` (the GitHub Pages deploy workflow). `git rm` the file.
- [ ] 9.10 Update `.github/workflows/tests.yml` (existing): change `working-directory` to `app`, update path filters (if any) to `app/**`, bump Node from 20 to 22 if not already on 22.
- [ ] 9.11 If `.github/workflows/e2e.yml` exists (per the deploy.yml comment): update `working-directory: app`, path filter `app/**`.
- [ ] 9.12 Remove the repo-root `CNAME` file (`git rm CNAME`).

## 10. Release workflow: .github/workflows/release-app.yml

- [ ] 10.1 Create `.github/workflows/release-app.yml` per app-release-versioning spec: `on: push: tags: ['app-v*']`, single `release` job with `permissions: contents: write`.
- [ ] 10.2 Steps: checkout with `fetch-depth: 0`, extract version from `GITHUB_REF_NAME`, find previous `app-v*` tag via `git tag --list 'app-v*' --sort=-v:refname | sed -n '2p'`, generate notes via `git log --pretty=format:"- %s" "$PREV..HEAD" -- app/` (with first-release fallback), publish via `softprops/action-gh-release@v2` with name `PWA v<version>` and body including the notes, `draft: false`, `prerelease: false`.
- [ ] 10.3 Test the workflow locally with `act` (or by pushing a test tag in a fork): verify it runs end-to-end without secrets beyond `GITHUB_TOKEN`.

## 11. In-app: SW update banner + Settings → About

- [ ] 11.1 Create `app/src/lib/sw-update.ts`: nanostore `swUpdate$` of `{ waiting: ServiceWorker | null }`, helper `applyUpdate()` that posts SKIP_WAITING + listens for controllerchange + reloads. Subscribe in the SW registration handler so `registration.waiting` updates the store.
- [ ] 11.2 Update `app/src/main.ts` (or the SW registration entry): use `registerSW` from `virtual:pwa-register` (provided by `@vite-pwa/astro`) with `registerType: 'prompt'`-aware callbacks (`onNeedRefresh`, `onOfflineReady`); on `onNeedRefresh`, populate the `swUpdate$` store with the waiting registration.
- [ ] 11.3 Create `app/src/components/UpdateBanner.tsx`: subscribes to `swUpdate$` via `@nanostores/react`; renders nothing when `waiting === null`; otherwise renders a non-modal banner with copy "Nová verze připravena — restartovat" and a primary button calling `applyUpdate()`. Style consistent with the `ui-design-system` tokens.
- [ ] 11.4 Mount `<UpdateBanner client:idle />` from `app/src/components/AppShell.tsx` only when `view === 'unlocked'` (suppress on welcome, locked, device-limit, plan, etc. per app-release-versioning spec scenario).
- [ ] 11.5 Add i18n strings for the banner: `update_banner_title`, `update_banner_action`. Add to `app/src/i18n/messages/cs.json` and `en.json`.
- [ ] 11.6 Component test `app/src/components/UpdateBanner.component.test.tsx`: covers banner-hidden when `waiting === null`, banner-visible when waiting, click triggers `applyUpdate` (mock the SW call).
- [ ] 11.7 Update `app/src/components/SettingsScreen.tsx`: add an "O aplikaci" section displaying `__APP_VERSION__`, `__APP_BUILD_TIME__` (formatted via existing locale formatter), `__APP_COMMIT__`, and a link "Co je nového" → `https://github.com/<org>/<repo>/releases/tag/app-v${__APP_VERSION__}`. Read GitHub repo URL from a constant in `app/src/lib/constants.ts`.
- [ ] 11.8 Add i18n strings: `settings_about_heading`, `settings_about_version`, `settings_about_built`, `settings_about_commit`, `settings_about_release_notes_link`. Add to cs and en.
- [ ] 11.9 Component test `app/src/components/SettingsScreen.about.component.test.tsx`: asserts version/build/commit render with mocked define values.

## 12. Smoke test on PR preview

- [ ] 12.1 Open a draft PR; wait for the preview deploy URL.
- [ ] 12.2 On Chrome desktop: open `<preview>/`, verify landing renders with full SEO `<head>` (View Source). Open DevTools → Application → Manifest, confirm "Installable" with no errors. Click the address-bar install icon, confirm install completes. Open the installed app, verify it launches at `/app/`. Run through OAuth → wizard Step 3 → unlock → schedule view. Open Settings → About, confirm version/build/commit render. Trigger `chrome://serviceworker-internals` to verify both SWs are registered with the correct scopes.
- [ ] 12.3 On Chrome Android (or Chrome DevTools device emulation): repeat install + launch + unlock smoke.
- [ ] 12.4 On Edge desktop: repeat install + launch + unlock smoke.
- [ ] 12.5 On Firefox desktop: verify both surfaces load, confirm Firefox does not surface PWA install (expected — Firefox does not support manifest install on desktop) but `/app/` still works.
- [ ] 12.6 On Safari macOS: verify both surfaces load, no install (Safari doesn't surface install on macOS unless Add to Dock is invoked manually). Confirm CSP does not block app rendering (DevTools → Console).
- [ ] 12.7 On iOS Safari (real device): visit `<preview>/`, verify the iOS install banner appears. Tap dismiss, reload, verify it stays dismissed. Add to Home Screen via the share sheet, launch from the home icon, confirm it lands at `/app/` in standalone mode.
- [ ] 12.8 Run Lighthouse mobile against `<preview>/`: capture scores. Confirm Performance ≥ 95, Accessibility ≥ 95, Best Practices = 100, SEO = 100. PWA audit (separate panel) confirms installable.
- [ ] 12.9 Validate sitemap (`<preview>/sitemap.xml`) excludes `/app/*`. Validate robots.txt. Validate JSON-LD on `/` and a blog post via Google's Rich Results Test on the preview URL.

## 13. Documentation

- [ ] 13.1 Create `ARCHITECTURE.md` at the repo root: 2-page abridged version of this proposal + design — repository topology, two-SW topology, build pipeline, deploy pipeline, versioning workflow, where preview URLs come from, how to roll back via Cloudflare dashboard, references to the OpenSpec change for the canonical detail.
- [ ] 13.2 Update `README.md`: replace single-folder dev instructions. Document developing the marketing site (`cd web && npm install && npm run dev`), developing the app (`cd app && npm install && npm run dev`), running merged-dist locally (full sequence), required Cloudflare secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) and how to obtain each, releasing the PWA (`npm version` + `git tag app-v<version>` + push), branch-protection requirements, and a pointer to `ARCHITECTURE.md`.
- [ ] 13.3 Document the cutover steps the operator must perform post-merge in `README.md`'s "Operator runbook" section: attach `tricho.app` and `www.tricho.app` (301 → apex) in Cloudflare dashboard, disable GitHub Pages in repo settings, configure branch protection on `main`, optional Cloudflare Web Analytics enable.

## 14. Final checks

- [ ] 14.1 `openspec validate marketing-site-and-pwa-split --strict` passes (or only warns, no errors).
- [ ] 14.2 Squash-merge the PR (linear history per branch protection).
- [ ] 14.3 Operator: in Cloudflare dashboard, attach `tricho.app` to the `tricho` Pages project. Verify TLS issuance succeeds (≤ 5 min). Visit `https://tricho.app/` and confirm it serves the marketing landing.
- [ ] 14.4 Operator: in GitHub repo settings, disable GitHub Pages. Confirm `tricho.app` no longer resolves through GitHub Pages.
- [ ] 14.5 Operator: in GitHub repo settings → Branches, add branch protection rule for `main` requiring `Test web`, `Test app`, `Build merged dist & deploy` status checks; require linear history; restrict direct pushes.
- [ ] 14.6 Tag the first release: `cd app && npm version --no-git-tag-version 1.0.0`, commit, `git tag app-v1.0.0`, `git push origin main --follow-tags`. Confirm `release-app.yml` runs and the GitHub Release appears with auto-generated notes.
- [ ] 14.7 Open a follow-up issue for "marketing-site i18n (Astro i18n routing)" — explicitly out of scope here, but worth tracking.
- [ ] 14.8 Open a follow-up issue for "CSP report-uri integration (collect violations)" — defense-in-depth improvement, separate workstream.
- [ ] 14.9 Run `openspec archive marketing-site-and-pwa-split` once the implementation lands and the operator confirms the cutover is clean.
