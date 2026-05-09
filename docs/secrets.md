# Secrets

Tricho uses **SOPS + age** for every secret it touches. Plain-text
`.env*` files MUST NOT hold secrets.

- Encrypted files live under `secrets/<profile>.sops.yaml` (committed).
- Age private keys live **outside the repo** — on developer laptops at
  `~/.config/sops/age/keys.txt` and in GitHub Actions as the
  `SOPS_AGE_KEY` secret.
- `make _render-secrets` (invoked by `make dev` / `make ci` /
  `make prod-local`) decrypts each profile into gitignored
  `.secrets-runtime/<field>` files mounted as Docker Compose `secrets:`
  at `/run/secrets/*`. `make down` wipes the runtime tree.

Common operator commands:

```bash
make secrets-edit PROFILE=dev   # sops opens $EDITOR on dev.sops.yaml
make secrets-rotate-age         # re-encrypt with current .sops.yaml recipients
sops -d secrets/dev.sops.yaml   # ad-hoc decrypt to stdout (dev-only)
```

For the full operator runbook — onboarding a new dev, rotating values,
break-glass, offboarding — see [`secrets/README.md`](../secrets/README.md).

## Profiles

| Profile        | Path                              | Used by                                                      |
|----------------|-----------------------------------|--------------------------------------------------------------|
| `dev`          | `secrets/dev.sops.yaml`           | `make dev` on a laptop. Falls back to `dev.fallback.env`.    |
| `ci`           | `secrets/ci.sops.yaml`            | `make ci` and the `e2e` workflow.                            |
| `prod`         | `secrets/prod.sops.yaml`          | `make prod-local` and the legacy single-host prod profile.   |
| `sync-prod`    | `secrets/sync-prod.sops.yaml`     | Server-side prod stack on `sync.tricho.app` (see runbook).   |
| `sync-dev`     | `secrets/sync-dev.sops.yaml`      | Server-side dev stack on `sync.dev.tricho.app`.              |

Pass the profile via the existing `PROFILE=` argument:

```bash
make secrets-edit PROFILE=sync-prod
make _render-secrets PROFILE=sync-dev   # called by deploy workflow
```

Default `PROFILE=dev` — `make dev`, `make ci`, and `make prod-local` are unchanged.

## Per-server age keypair (server-deploy)

Each deploy host that hosts `tricho-sync-<env>` owns its own age keypair:

- Private key: `/etc/sops/age/<hostname>.key` on the host, mode `0600`, root-only. Never copied off the host, never committed.
- Public key: added as a recipient in `.sops.yaml` for the relevant `secrets/sync-*.sops.yaml` rules.

Generation and rotation steps live in `docs/server-deploy.md` §"Per-server age key". Decommissioning a host is a remove-from-`.sops.yaml` + `make secrets-rotate-age` + downstream-secret rotation flow.

## SOPS_AGE_KEY in GitHub Actions

| Workflow                                | Scope                              | Why                                                              |
|-----------------------------------------|------------------------------------|------------------------------------------------------------------|
| `e2e`, other CI                         | Repository secret `SOPS_AGE_KEY`   | Decrypts `secrets/ci.sops.yaml` on every CI run.                 |
| `deploy-server` → `dev` environment     | Environment secret `SOPS_AGE_KEY`  | Decrypts `secrets/sync-dev.sops.yaml`. No reviewer required.     |
| `deploy-server` → `production` env      | Environment secret `SOPS_AGE_KEY`  | Decrypts `secrets/sync-prod.sops.yaml`. Required-reviewer gate.  |

The `production` environment also enforces `deployment_branch_policy.protected_branches = true` so only `main` can dispatch a prod deploy. Setting these is part of the bootstrap; see `docs/server-deploy.md` §"Per-server age key" and the `add-server-deploy-stack` change tasks.

## Requirements

For requirements, see
`openspec/specs/secrets-management/`.
