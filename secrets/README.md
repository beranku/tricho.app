# TrichoApp secrets

Every secret TrichoApp uses lives here, SOPS-encrypted with **age** recipients. Plain-text `.env*` files MUST NOT hold secrets.

- Files in this directory are **committed** and **encrypted**.
- Age private keys live **outside the repo** — on developer laptops (`~/.config/sops/age/keys.txt`) and in GitHub Actions secrets (`SOPS_AGE_KEY`).
- The `Makefile` decrypts into gitignored `.secrets-runtime/*` files before `docker compose up`. Containers mount them as `/run/secrets/*` (file-mounted Docker secrets), so no secret ever appears in `docker inspect` env output.

## File layout

| File | Consumers |
|---|---|
| `secrets/dev.sops.yaml` | `make dev` on developer laptops |
| `secrets/ci.sops.yaml` | `make ci` and `.github/workflows/e2e.yml` |
| `secrets/prod.sops.yaml` | `make prod-local` and production hosts |

Each file is a flat YAML of field names → values. Current field set:

| Field | Purpose |
|---|---|
| `couchdb_password` | CouchDB admin password |
| `cookie_secret` | HMAC secret for tricho-auth's OAuth state cookie |
| `jwt_private_pem` | RSA private key tricho-auth signs JWTs with |
| `google_client_secret` | Google OAuth client secret (optional — unset disables Google) |
| `apple_client_secret` | Apple OAuth client secret (optional — unset disables Apple) |

## Onboarding a new developer

The existing dev who runs through these steps MUST have decrypt access to the files they're re-encrypting.

```sh
# 1. New dev generates their age keypair.
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
chmod 600 ~/.config/sops/age/keys.txt
grep 'public key' ~/.config/sops/age/keys.txt   # share this line with the existing dev

# 2. Existing dev adds the new pubkey to .sops.yaml under each file the new
#    dev needs access to (typically dev + ci).

# 3. Existing dev re-encrypts.
make secrets-rotate-age

# 4. Commit .sops.yaml + the re-encrypted secrets/*.sops.yaml.

# 5. New dev verifies they can decrypt.
sops -d secrets/dev.sops.yaml >/dev/null && echo OK
```

## First-time repo bootstrap (no SOPS files yet)

```sh
# Generate your age keypair (see above).

# Bootstrap an unencrypted dev.sops.yaml with placeholders.
cat > /tmp/dev.yaml <<'EOF'
couchdb_password: changeme-please
cookie_secret: $(openssl rand -base64 32)
jwt_private_pem: |
$(openssl genrsa 2048 | sed 's/^/  /')
google_client_secret: ""
apple_client_secret: ""
EOF

# Encrypt in place and move into secrets/.
sops -e --age $(grep 'public key' ~/.config/sops/age/keys.txt | awk '{print $NF}') \
  /tmp/dev.yaml > secrets/dev.sops.yaml
rm /tmp/dev.yaml
```

## Editing a secret

```sh
make secrets-edit PROFILE=dev            # sops opens $EDITOR on dev.sops.yaml
```

SOPS handles encrypt-on-save automatically.

## Rotating a single secret value

1. `make secrets-edit PROFILE=<profile>` — replace the value.
2. `docker compose restart <service>` for every service that consumed the old value (the `Makefile` target `secrets-rotate` will be added here if this becomes routine).
3. Note the rotation in a commit message: `secrets(prod): rotate couchdb_password`.

## Rotating the age recipient set

After adding or removing a recipient in `.sops.yaml`:

```sh
make secrets-rotate-age
```

This rewrites every matched file with the new recipient list.

## Offboarding a developer

1. Remove their age pubkey from `.sops.yaml`.
2. `make secrets-rotate-age` so their old private key can't decrypt any file going forward.
3. Rotate every secret value they previously could read — their old decryption of committed history still works. (For dev-tier secrets, rotation means new CouchDB admin password, new OAuth client secrets, new JWT keypair. For CI, rotate `SOPS_AGE_KEY` in GitHub Actions secrets.)
4. Commit the rotations with an audit message: `secrets: offboard <name>; rotate dev tier`.

## Break-glass

The prod recipient list includes a dedicated age keypair whose private key lives in the team password manager (not on any laptop). Use it only when the regular prod recipient is unavailable. Rotating after a break-glass use is strictly required — the emergency key's disclosure assumption is "one person pulled it from the vault", so treat it as compromised.

## Runtime delivery

`make _render-secrets` (invoked by `make dev` / `make ci` / `make prod-local`) does:

1. Decrypt `secrets/$(PROFILE).sops.yaml` via SOPS (using `~/.config/sops/age/keys.txt` locally or `SOPS_AGE_KEY` env var in CI).
2. Write each YAML field to a file under `.secrets-runtime/<field>` with mode `0600`.
3. `docker compose` mounts those files as Docker Compose `secrets:`, visible inside containers at `/run/secrets/*`.
4. Services read them via `*_FILE` env vars (e.g., `TRICHO_AUTH_JWT_PRIVATE_KEY_PATH=/run/secrets/jwt_private_pem`).

`.secrets-runtime/` is gitignored and wiped by `make down`. It exists briefly during an active stack.

## Dev fallback (no SOPS file yet)

During onboarding — specifically before a committed `secrets/dev.sops.yaml` exists — `make _render-secrets` falls back to plain-text defaults (e.g. `couchdb_password=changeme`) so `make dev` still boots. This fallback is hard-disabled for the `ci` and `prod` profiles: running those without a decryptable SOPS file fails the build.
