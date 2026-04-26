# app-release-versioning Specification

## Purpose
TBD - created by archiving change marketing-site-and-pwa-split. Update Purpose after archive.
## Requirements
### Requirement: app/package.json version is the canonical PWA version

The PWA's version MUST be the `version` field of `app/package.json`. The version MUST follow semver (`MAJOR.MINOR.PATCH`). Bumping MUST be done via `cd app && npm version --no-git-tag-version <patch|minor|major>`, followed by a git commit and a manual prefix-namespaced tag (`git tag app-v<version>`). The `--no-git-tag-version` flag is required to suppress npm's default unprefixed `v<version>` tag, which would conflict with the prefix convention.

#### Scenario: Version bump produces a prefixed tag
- **GIVEN** the operator runs `cd app && npm version --no-git-tag-version patch` and commits the result
- **WHEN** the operator runs `git tag "app-v$(node -p "require('./package.json').version")"`
- **THEN** a tag matching `app-v<semver>` is created
- **AND** no unprefixed `v<semver>` tag is created

### Requirement: Build embeds version, build time, and commit hash as compile-time constants

The PWA build MUST inject three compile-time constants into the bundle via Vite's `define` (configured in `app/astro.config.mjs`):

- `__APP_VERSION__`: the `version` field of `app/package.json`, JSON-stringified.
- `__APP_BUILD_TIME__`: an ISO-8601 timestamp of the build (`new Date().toISOString()`), JSON-stringified.
- `__APP_COMMIT__`: the first 7 characters of `process.env.GITHUB_SHA` if set, otherwise the literal string `'dev'`, JSON-stringified.

TypeScript declarations for the three constants MUST live in `app/src/vite-env.d.ts`. The constants MUST NOT be fetched at runtime (no network call to retrieve version metadata).

#### Scenario: Constants are present in the production bundle
- **GIVEN** a CI build of the PWA
- **WHEN** the bundled JavaScript is searched for the literal value of `__APP_VERSION__` (after define substitution)
- **THEN** the version string from `app/package.json` is present in at least one bundled chunk

#### Scenario: Local dev build uses 'dev' as commit
- **GIVEN** the PWA is built locally (no `GITHUB_SHA` env var)
- **WHEN** the bundle is inspected
- **THEN** `__APP_COMMIT__` resolves to `'dev'`

### Requirement: Settings → About displays version, build time, and commit, with a release-notes link

The PWA's `SettingsScreen` (or equivalent settings surface) MUST contain an "O aplikaci" / "About" section that displays:

- The version (`__APP_VERSION__`).
- The build time (`__APP_BUILD_TIME__`), formatted in the user's locale.
- The commit (`__APP_COMMIT__`).
- A link labeled "Co je nového" (or localised equivalent) targeting `https://github.com/<org>/<repo>/releases/tag/app-v<__APP_VERSION__>` if the GitHub repo is public, otherwise `https://tricho.app/help/release-notes`.

The display MUST work offline (the strings are baked in at build time; only the link target needs network).

#### Scenario: About section shows the running version
- **GIVEN** a build with `__APP_VERSION__ === '1.2.3'`
- **WHEN** the user opens Settings → About
- **THEN** the version `1.2.3` is rendered
- **AND** the build-time timestamp is rendered in the user's locale
- **AND** the commit short-hash is rendered

#### Scenario: About link opens the GitHub Release for this version
- **GIVEN** a build with `__APP_VERSION__ === '1.2.3'` and a public repo
- **WHEN** the user clicks the "Co je nového" link
- **THEN** the browser navigates to `https://github.com/<org>/<repo>/releases/tag/app-v1.2.3`

### Requirement: app-v* tag push triggers a GitHub Release with auto-generated notes

The repository MUST contain a workflow (`.github/workflows/release-app.yml`) that triggers on tag push matching `app-v*`. The workflow MUST:

1. Extract the semver from the tag name (`app-v1.2.3` → `1.2.3`).
2. Find the previous `app-v*` tag by sorting `git tag --list 'app-v*' --sort=-v:refname` and taking the second entry.
3. Generate release notes from `git log --pretty=format:"- %s" "<previous-tag>..HEAD" -- app/` (commits scoped to the `app/` subtree only). If no previous tag exists, generate notes from all `app/`-scoped commits.
4. Publish a GitHub Release named `PWA v<version>` with body `## What's new in v<version>\n\n<notes>` using `softprops/action-gh-release@v2` (or equivalent).
5. Mark the release as not-draft, not-prerelease.

#### Scenario: Tag push creates a release
- **GIVEN** the operator pushes `app-v1.2.4` to the remote
- **WHEN** the `release-app.yml` workflow runs
- **THEN** a GitHub Release named `PWA v1.2.4` is created
- **AND** its body contains the bulleted commit summaries since the previous `app-v*` tag

#### Scenario: First release with no previous tag uses all app commits
- **GIVEN** no `app-v*` tags exist before pushing `app-v1.0.0`
- **WHEN** the workflow runs
- **THEN** the release body contains every `app/`-scoped commit from the repo's history

#### Scenario: Release notes scope to app/ commits only
- **GIVEN** the previous `app-v*` tag was at commit X
- **AND** between X and the new tag, commits touched both `web/` and `app/`
- **WHEN** the release notes are generated
- **THEN** only commits whose changes touched `app/` paths appear in the notes

### Requirement: Service worker update is user-controlled, not automatic

The PWA's service worker MUST register with `registerType: 'prompt'`, `clientsClaim: false`, `skipWaiting: false`, `cleanupOutdatedCaches: true`. When the SW detects a waiting (newer) version (i.e. `registration.waiting` becomes non-null), the PWA MUST surface a non-modal banner in the unlocked shell with copy "Nová verze připravena — restartovat" (or localised equivalent) and a primary action that:

1. Posts `{ type: 'SKIP_WAITING' }` to `registration.waiting`.
2. Listens for the `controllerchange` event on `navigator.serviceWorker`.
3. On `controllerchange`, calls `window.location.reload()`.

The banner MUST NOT auto-apply. The banner MUST persist across renders until the user takes the action. The banner MUST NOT appear on the locked screen, the welcome wizard, or any pre-unlock surface (the user has not engaged with the app yet; restarting would be confusing).

#### Scenario: Waiting SW shows the update banner in the unlocked shell
- **GIVEN** the user is in `view === 'unlocked'`
- **AND** a new SW finishes installing and `registration.waiting !== null`
- **WHEN** AppShell re-renders
- **THEN** an "Nová verze připravena — restartovat" banner is visible

#### Scenario: User-tap reloads with the new SW in control
- **GIVEN** the update banner is visible
- **WHEN** the user taps the banner action
- **THEN** `{ type: 'SKIP_WAITING' }` is posted to `registration.waiting`
- **AND** on `controllerchange`, the page reloads
- **AND** after reload, the new SW is the controller

#### Scenario: Update banner is hidden on the welcome wizard
- **GIVEN** the user is in `view === 'welcome'` (wizard surface)
- **AND** `registration.waiting !== null`
- **WHEN** the surface renders
- **THEN** no update banner is visible

### Requirement: The release-app workflow does not require GitHub secrets beyond the default token

The `release-app.yml` workflow MUST consume only `${{ secrets.GITHUB_TOKEN }}` (provided automatically by GitHub Actions) for the release-creation step. It MUST NOT require any user-managed secret. This keeps tagging the only operator-side action required to ship a release.

#### Scenario: Workflow has no manual secret references
- **GIVEN** `.github/workflows/release-app.yml`
- **WHEN** all `${{ secrets.* }}` references are extracted
- **THEN** the only secret referenced is `GITHUB_TOKEN`
