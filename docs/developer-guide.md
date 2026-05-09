# Developer guide

Local setup and day-to-day workflow for the single-developer flow. For
the architecture overview see [`architecture.md`](architecture.md); for
deploys see [`build-and-deploy.md`](build-and-deploy.md); for tests see
[`testing.md`](testing.md).

## Prerequisites

| Tool             | Version | macOS install            | Linux install                                                    |
|------------------|---------|--------------------------|------------------------------------------------------------------|
| Node.js          | ≥ 22    | `brew install node`      | nvm / distro package                                             |
| Docker + Compose | recent  | Docker Desktop           | [docs.docker.com/compose](https://docs.docker.com/compose/install/) |
| SOPS             | recent  | `brew install sops`      | [getsops/sops releases](https://github.com/getsops/sops/releases)  |
| age              | recent  | `brew install age`       | distro package or releases                                       |
| jq               | recent  | `brew install jq`        | `apt install jq`                                                 |
| mkcert           | recent  | `brew install mkcert`    | distro package — for the `ci` profile's self-signed TLS          |
| openssl          | any     | preinstalled             | preinstalled                                                     |

Run `make doctor` after installing to verify everything's wired.

## One-time setup

```bash
# Generate your age keypair and share the public key with someone who
# already has decrypt access (see secrets/README.md for full flow).
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
chmod 600 ~/.config/sops/age/keys.txt
grep 'public key' ~/.config/sops/age/keys.txt

# After the existing dev re-encrypts secrets/ with your pubkey:
sops -d secrets/dev.sops.yaml >/dev/null && echo OK

# Verify host wiring (Docker, SOPS, age, /etc/hosts entries, DNS).
make doctor
```

If no `secrets/dev.sops.yaml` exists yet, `make _render-secrets` falls
back to plain-text dev defaults so `make dev` still boots. The fallback
is hard-disabled for the `ci` and `prod` profiles.

## Day-to-day flow (solo)

There are **no pull requests**. Two long-lived branches:

- **`dev`** — staging. Cloudflare Pages auto-deploys it to
  `dev.tricho.app`. Push as often as you like; this is where you iterate.
- **`main`** — production. Only the *Promote dev → main* workflow updates
  it (see [`build-and-deploy.md`](build-and-deploy.md)).

The loop:

```bash
# 1. Sync up.
git switch dev && git pull --ff-only

# 2. Hack. Commit small, conventional-commit messages.
#    For risky multi-step work, branch locally and merge --ff-only back:
#      git switch -c feat/x   →   …work…
#      git switch dev && git merge --ff-only feat/x && git branch -d feat/x
#    Keep dev linear — the promote workflow's "no merge commits" gate
#    rejects merge commits between main and dev.

# 3. Run the relevant tests before pushing. Pick the cheapest tier
#    that exercises what you changed:
#      cd app && npm run test         # unit + component, < 15 s
#      cd app && npm run typecheck    # TS only
#      make ci                        # full stack up
#      make test-all                  # entire pyramid (minutes)
#    See docs/testing.md for the pyramid.

# 4. Push to dev. CI fires automatically and deploys dev.tricho.app
#    on success. If CI goes red, fix it on dev and push again — the
#    promote workflow refuses to release a red tip.
git push

# 5. When you're happy with what's on dev, run the promote workflow
#    (see docs/build-and-deploy.md).
```

What you do **not** do:

- Open a PR. The repo has no required reviewers; PRs would just be
  ceremony for one person.
- Merge `main` back into `dev`. Creating a merge commit between them
  breaks the promote workflow's `no-merge-commits` gate.
- Push directly to `main`. Branch protection should reject it.
- Long-lived feature branches. Land work on `dev` quickly; let staging
  be the integration point.

## Per-package commands

Each package is independent. Run from inside `app/` or `web/`.

```bash
# app/
npm run dev | build | preview | typecheck
npm run test                       # unit + component, fast (no docker)
npm run test:unit | test:component
npm run test:backend | test:backend:integration
npm run test:e2e                   # requires `make ci` running
npm run test:smoke
npm run test:coverage
npm run test:all                   # everything

# web/
npm run dev | build | typecheck | lint
```

Operator targets live at the repo root:

```bash
make help          # list every target
make dev           # local development behind Traefik on http://tricho.localhost
make dev-mock      # same, but with mock OIDC — full e2e loop without a real Google client
make prod-local    # production-equivalent local run (Let's Encrypt + Caddy)
make ci            # self-signed TLS + mock OIDC, for running Playwright
make e2e           # boot ci profile + run the E2E suite
make down          # stop everything; wipe .secrets-runtime/
make logs          # tail running stack
make test-smoke    # infra smoke (compose config, secrets lint, healthchecks)
make test-all      # all tiers
make secrets-edit       # sops edit secrets/$(PROFILE).sops.yaml
make secrets-rotate-age # re-encrypt with current age recipient set
```

## Full local e2e loop with `make dev-mock`

Use `make dev-mock` when you want to iterate on the OAuth/sync code paths without registering a localhost OAuth client in Google Cloud Console. It runs the dev profile (Vite HMR PWA + tricho-auth + CouchDB + Traefik) plus a `mock-oidc-dev` container that speaks the same OpenID Connect protocol Google does, signing RS256 ID tokens that tricho-auth treats as authentic.

```bash
# One-time: ensure the host resolves to localhost
echo '127.0.0.1 tricho.localhost' | sudo tee -a /etc/hosts

make dev-mock
# Open http://tricho.localhost/app/
# Click "Continue with Google" → mock OIDC pretends to be accounts.google.com
# → tricho-auth's callback creates the local vault → wizard advances.
```

The mock has a `/mock/identity` endpoint that picks which `sub`/`email` the next sign-in round-trip uses. Default identity is `mock-user@tricho.test`. To switch:

```bash
curl -X POST http://tricho.localhost/mock-oidc/mock/identity \
  -H 'Content-Type: application/json' \
  -d '{"sub": "1234567890", "email": "ludmila@example.com", "name": "Ludmila"}'
```

This setup matches the **single-host** topology (PWA + sync + auth all on `tricho.localhost`). Cross-origin behavior — which is what production uses, with PWA on Cloudflare Pages and sync on `sync.tricho.app` — isn't exercised by `make dev-mock`. For cross-origin verification, push to `dev` branch and observe the deploy on `sync.dev.tricho.app`.

`make down` tears everything down and wipes `.secrets-runtime/`.

## Quick browser-only iteration (no backend)

If you're only editing static PWA shell, marketing pages, or copy:

```bash
cd app && npm install && npm run dev   # PWA on http://localhost:4321/app/
cd web && npm install && npm run dev   # marketing on http://localhost:4321/
```

No CouchDB, no auth, no edge — just Astro dev server.

## IDE setup

VS Code with these extensions:

- **Astro** — Astro file support
- **ESLint** — linting (`web/` runs ESLint; `app/` relies on
  `astro check && tsc --noEmit`)
- **Prettier** — formatting
- **TypeScript + JavaScript** — built-in

Suggested `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

## Code conventions

- TypeScript strict mode in both packages.
- ESLint + Prettier for `web/`. `app/` uses
  `astro check && tsc --noEmit` (see `app/package.json` `typecheck`).
- Don't write doc comments that just restate the code. Add a comment
  only when the *why* is non-obvious (a hidden invariant, a workaround,
  a constraint that would surprise a reader).
- For invariant-touching paths (encryption, sync, billing, anything in
  `openspec/specs/`), prefer the OpenSpec workflow:
  `/opsx:propose` → `/opsx:apply` → `/opsx:archive`. That is the
  project's review surface in lieu of PRs.

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add photo thumbnail generation
fix: correct PRF detection on Safari
docs: trim README and split developer guide
test: add key wrapping tests
refactor: simplify sync orchestrator
chore: bump astro
```

The promote workflow does not parse commit messages, but a clean
conventional-commit history makes the production tag timeline
(`git tag --list 'prod-*'`) much cheaper to scan.

## Platform-specific PRF caveats

If you're touching unlock UX, keep these in mind. The project supports
PRF on platforms that support it and falls back to PIN/RS otherwise.

| Platform                  | PRF support | Notes |
|---------------------------|-------------|-------|
| Chrome (desktop, Android) | Full        | Platform + roaming authenticators |
| Edge (Chromium)           | Full        | Same as Chrome |
| Safari (macOS)            | Limited     | iCloud Keychain passkeys only — not hardware keys |
| Safari (iOS)              | Limited     | iCloud Keychain only; iOS 18.2+ recommended |
| Firefox                   | Limited     | RS fallback recommended |
| Cross-device QR           | Unreliable  | PRF may fail or return different values |

See `openspec/specs/passkey-prf-unlock/`.

## Release

PWA semver tags are namespaced `app-v*`. From inside `app/`:

```bash
cd app
npm version --no-git-tag-version patch    # or minor / major
git add app/package.json app/package-lock.json
git commit -m "chore(app): release v$(node -p "require('./package.json').version")"
git tag "app-v$(node -p "require('./package.json').version")"
git push origin main --follow-tags
```

`.github/workflows/release-app.yml` triggers on `app-v*` and publishes a
GitHub Release with auto-generated notes from `app/`-scoped commits since
the previous `app-v*` tag. In-app Settings → "O aplikaci" displays
version, build time, commit short-hash, and a "Co je nového" link.

For the production-deploy mechanics (promote workflow gates,
fast-forward push, rollback), see
[`build-and-deploy.md`](build-and-deploy.md).
