# jwt-key-bootstrap Specification

## Purpose

The contract for how the RS256 JWT keypair used to sign CouchDB session tokens is generated, stored, and shared between `tricho-auth` and CouchDB. `tricho-auth` is the sole owner of the keypair. The CouchDB container learns the public key automatically via a shared volume and an entrypoint shim — no human ever pastes a key into `local.ini`. Rotation is a restart, not a manual edit.

Source files: `infrastructure/couchdb/tricho-auth/server.mjs` (`publishPublicKey`/`loadOrCreateKeys`), `infrastructure/couchdb/entrypoint.sh`.

## Requirements

### Requirement: tricho-auth is the sole source of the JWT keypair
`tricho-auth` MUST own the lifecycle of the RS256 JWT keypair used to sign CouchDB session tokens. It MUST load the private key from `/run/secrets/jwt_private.pem` when present, and MUST fall back to generating a persisted keypair under `TRICHO_AUTH_DEV_KEY_DIR` only when no secret is mounted (dev profile only). No other service may generate or rotate this keypair.

#### Scenario: Prod reads the key from a Docker secret
- GIVEN the `prod` profile with `jwt_private.pem` provided as a Docker secret
- WHEN `tricho-auth` starts
- THEN it loads the PEM from `/run/secrets/jwt_private.pem`
- AND logs `using mounted JWT key`
- AND does not write any key material under the dev key dir

#### Scenario: Dev generates and persists on first start
- GIVEN the `dev` profile with no JWT secret mounted
- WHEN `tricho-auth` starts for the first time on a fresh volume
- THEN it generates a new RSA 2048 keypair
- AND writes `jwt-private.pem` (mode 0600) and `jwt-public.pem` under `TRICHO_AUTH_DEV_KEY_DIR`
- AND subsequent restarts reuse the same keypair

### Requirement: Public key is published to a shared volume
On every start-up, `tricho-auth` MUST write the current PEM-encoded JWT public key to a well-known path (`/shared/jwt/jwt-public.pem`) inside a named Docker volume shared with the CouchDB container. The file MUST be atomically replaced (write-to-tempfile then rename).

#### Scenario: First boot populates the shared volume
- GIVEN a fresh `docker compose --profile dev up`
- WHEN `tricho-auth` finishes bootstrapping
- THEN the file `/shared/jwt/jwt-public.pem` exists in the shared volume
- AND its content parses as a valid PEM `PUBLIC KEY`

### Requirement: CouchDB entrypoint consumes the published key
The CouchDB container MUST run a small entrypoint shim that, before invoking the upstream CouchDB entrypoint, templates the current `/shared/jwt/jwt-public.pem` into `/opt/couchdb/etc/local.d/jwt.ini` as a `[jwt_keys] rsa:<kid> = …` block. The shim MUST fail CouchDB's boot (non-zero exit) if the public key file is missing after a bounded wait (default 30s).

#### Scenario: CouchDB accepts JWTs on first boot
- GIVEN a first-time `make dev`
- WHEN `tricho-auth` issues a signed JWT and the client calls `GET /userdb-<hex>/` with `Authorization: Bearer <jwt>`
- THEN CouchDB returns 200 for the owner and 401/403 for any other subject
- AND neither the operator nor any script manually edited `local.ini`

#### Scenario: Missing public key aborts CouchDB
- GIVEN the shared volume is empty and `tricho-auth` is disabled
- WHEN the CouchDB container starts
- THEN the entrypoint shim exits non-zero after the bounded wait
- AND CouchDB never opens its listener

### Requirement: Key rotation is a restart, not a manual edit
Rotating the JWT keypair MUST be expressible as replacing the Docker secret (or the dev-dir keypair) and restarting `tricho-auth` and CouchDB. No human-edited `local.ini` step may be required.

#### Scenario: Operator rotates the prod key
- GIVEN `prod` running against the old key
- WHEN the operator rewrites `jwt_private.pem` secret and runs `docker compose restart tricho-auth couchdb`
- THEN freshly issued JWTs are accepted by CouchDB
- AND the overlap window (both keys accepted) is either zero or explicitly configured via a second `jwt_keys` entry

### Requirement: JWKS endpoint is served by tricho-auth
`tricho-auth` MUST expose `GET /auth/.well-known/jwks.json` returning the current public key in JWK form, with cache-friendly headers (`Cache-Control: public, max-age=300`). External verifiers (future add-ons, logging sidecars) MUST be able to verify JWTs via this endpoint without file access.

#### Scenario: JWKS round-trip
- GIVEN the stack running with the prod-like config
- WHEN a client fetches `/auth/.well-known/jwks.json`
- THEN the response contains a `keys[]` array with at least one RS256 entry whose `kid` matches the `kid` header of currently minted JWTs
