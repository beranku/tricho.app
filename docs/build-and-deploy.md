# Build & deploy

How tricho.app gets from a local checkout to `tricho.app`. Behavioural
specs live in `openspec/specs/cloudflare-pages-deploy/`,
`release-promotion/`, and `app-release-versioning/`.

## Build pipeline

```
web/  npm run build  →  web/dist/
app/  npm run build  →  app/dist/
              ↓
    scripts/merge-dist.mjs
              ↓
            dist/                ← merged tree
              ↓
    scripts/validate-build.mjs   ← asserts SW paths, manifest, headers, redirects
              ↓
    wrangler pages deploy dist --project-name=tricho
```

Both packages build independently with no shared `node_modules`.
`merge-dist.mjs` only stitches the static outputs and copies `shared/` +
`_headers` + `_redirects`. `validate-build.mjs` exits non-zero on any
violation (e.g. `/app/sw.js` missing, manifest `start_url` wrong) so the
deploy never ships a broken layout.

## Cloudflare Pages routing

`_redirects`:

```
/app    /app/            301
/app/*  /app/index.html  200
```

The `200` rewrite gives the SPA fallback for `/app/*` deep links and
reloads. The `301` normalizes the bare `/app` form so it agrees with the
manifest's trailing-slash `start_url`.

`_headers` highlights:

- Both SWs: `no-cache, no-store, must-revalidate` + `Service-Worker-Allowed`.
- Manifest: 1-hour cache + `Content-Type: application/manifest+json`.
- Hashed assets (`/_astro/*`, `/app/_astro/*`, `/app/assets/*`,
  `/icons/*`, `/og/*`): `max-age=31536000, immutable`.
- HTML: `max-age=0, must-revalidate`.
- Global: `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS.
- `/app/*`: tight CSP scoped to the app shell (the surface that holds
  plaintext in memory). Marketing pages stay under the global headers.

## One-time operator setup

Before CI can deploy:

1. Create a Cloudflare API token (Cloudflare dashboard → My Profile →
   API Tokens → Create Token → Custom token → scope:
   *Cloudflare Pages — Edit*, account: target account only). Add as repo
   secret `CLOUDFLARE_API_TOKEN`.
2. Find `CLOUDFLARE_ACCOUNT_ID` (Cloudflare dashboard sidebar). Add as
   repo secret.
3. Create the Pages project locally:

   ```bash
   npx wrangler login
   npx wrangler pages project create tricho --production-branch=main
   ```

4. After the first successful production deploy, attach `tricho.app` and
   `www.tricho.app` (with 301 redirect to apex) as custom domains in the
   Cloudflare dashboard → Workers & Pages → tricho → Custom domains.
5. Disable GitHub Pages in repo settings → Pages → source = None.
6. Apply branch protection on `main` (see *Recommended GitHub repo
   settings* below).

## Required GitHub secrets

| Secret                    | Purpose                                                                                                                                                                            |
|---------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `CLOUDFLARE_API_TOKEN`    | Pages-Edit-only token; deploys via wrangler.                                                                                                                                       |
| `CLOUDFLARE_ACCOUNT_ID`   | Cloudflare account that owns the `tricho` project.                                                                                                                                 |
| `SOPS_AGE_KEY`            | Decrypts `secrets/*.sops.yaml` for the e2e stack.                                                                                                                                  |
| `GITHUB_TOKEN` (auto)     | PR-comment posting, release creation, and `workflow_dispatch` of `ci.yml` on `main` from `promote-dev-to-main.yml` (gated by that workflow's narrow `actions: write` scope).      |

## Staging vs production

- **Staging**: every push to `dev` deploys to `dev.tricho.app` via the
  Cloudflare Pages branch alias. This is the everyday integration target
  in the solo direct-to-`dev` flow.
- **Production**: pushes to `main` deploy to `tricho.app`. Only the
  *Promote dev → main* workflow is allowed to push to `main`.
- **Per-PR previews** (rarely used in solo flow): if you do open a PR
  against `main`, Cloudflare Pages deploys it to a unique
  `<branch>.tricho.pages.dev` URL and posts the URL as a PR comment.

## Production releases (promote dev → main)

Production releases are a single click in the GitHub Actions UI. The
`.github/workflows/promote-dev-to-main.yml` workflow fast-forwards `main`
to whatever SHA `dev` currently points at — `main` and `dev` end up on
the exact same commit object, so production deploys the artifact that
was already tested on staging.

From your terminal:

```bash
gh workflow run "Promote dev → main" --ref dev -f confirm=RELEASE
```

…or in the GitHub UI: **Actions** → **Promote dev → main** →
**Run workflow** → type `RELEASE` into the `confirm` input → **Run
workflow**.

The workflow validates four preflight gates, fast-forwards `main`, tags
the released SHA `prod-YYYY-MM-DD-<shortsha>`, and dispatches `ci.yml`
on `main` to run the production build + Cloudflare Pages deploy. The
run summary links to the dispatched CI run.

### Why a separate dispatch step (not just a push trigger)?

Pushes made by the default `GITHUB_TOKEN` do **not** trigger downstream
`push`-event workflows — that's a deliberate GitHub safeguard against
recursive workflow loops. The promote workflow therefore explicitly
calls `gh workflow run ci.yml --ref main` at the end, gated by
`actions: write` scoped to *this workflow only*. No PAT, no GitHub App,
nothing else to rotate. The `confirm: RELEASE` input is still the only
way to invoke the workflow in the first place.

If the dispatch step ever fails (e.g. Actions outage), the workflow
surfaces a manual recovery command:

```bash
gh workflow run "CI/CD" --ref main
```

### Preflight gates

If any gate fails, the workflow aborts before touching `main` and prints
a remediation message in the run summary.

| Gate                    | What it checks                                                  | Remediation if it fails                                                                                          |
|-------------------------|-----------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| 0. Confirmation         | `confirm` input equals `RELEASE`                                | Re-run, type `RELEASE` exactly                                                                                   |
| 1. Ahead of main        | `dev` has ≥ 1 commit not on `main`                              | Land work on `dev` first                                                                                         |
| 2. Linear ancestor      | `main` is an ancestor of `dev` (no divergence)                  | `git fetch origin && git checkout dev && git rebase origin/main && git push --force-with-lease origin dev`       |
| 3. No merge commits     | `main..dev` contains no merge commits                           | Rebase `dev` to a linear history                                                                                 |
| 4. Staging CI green     | Latest `ci.yml` run on dev's tip SHA is `success`               | Wait for staging CI, or fix the failure on `dev` and push again                                                  |

The push uses `git push origin <dev-sha>:refs/heads/main` with no force
flag, so the GitHub server itself rejects any non-fast-forward update.
The workflow never force-pushes.

### Recommended GitHub repo settings

Apply these once in **Settings → Branches** to enforce the same
invariants at the server side, regardless of the workflow:

- **`main` branch protection rule:**
  - Require linear history.
  - Disable *Allow squash merging* and *Allow merge commits* for PRs
    targeting `main`. Squash- or merge-merging a PR breaks the dev↔main
    parity invariant.
  - Do **not** enable *Require pull request before merging* — the
    workflow's `GITHUB_TOKEN` push would be denied. The `confirm:
    RELEASE` gate replaces PR review for the single-developer flow.

## Rollback

Cloudflare Pages keeps every deployment. One click in the dashboard
(Workers & Pages → tricho → Deployments → *Rollback to this deployment*)
restores any prior deploy in seconds. No GitHub Actions run is required.

There is no automated rollback workflow today.

## Versioning

| Tag        | Drives                                                                |
|------------|-----------------------------------------------------------------------|
| `app-v*`   | `release-app.yml` → GitHub Release for the PWA.                       |
| `web-v*`   | Reserved by convention; not wired today.                              |
| `prod-*`   | Created by the promote workflow on every successful production push. |

`app/package.json` `version` is canonical for the PWA. The build embeds
`__APP_VERSION__`, `__APP_BUILD_TIME__`, `__APP_COMMIT__` via Vite's
`define`; Settings → "O aplikaci" displays them and links to the
matching GitHub Release.

`git tag --list 'prod-*' --sort=-v:refname` shows the production-release
timeline (most recent first). These tags are independent of the PWA
semver `app-v*` tags created by `release-app.yml` — different axes,
different namespaces, no collision.

## Zero-knowledge invariants — preserved by the deploy

The deploy is **routing + build-merge only**. The crypto envelope, AAD
binding, the `wrappedDekRs / wrappedDekPrf / wrappedDekPin` keystore,
the `vault-state` doc shape, the `tricho-auth` JWT contract, and the
`couch_peruser` model are not touched. The marketing site is plain
HTML+CSS that never sees plaintext, never holds a DEK, never opens a
`VaultDb`, and never speaks to CouchDB or `tricho-auth`. The IndexedDB
origin (`tricho.app`) is unchanged, so any keystore data already
persisted survives any future cutover.
