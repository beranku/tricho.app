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

For requirements, see
`openspec/specs/secrets-management/`.
