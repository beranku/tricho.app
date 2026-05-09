## ADDED Requirements

### Requirement: Idempotent Ubuntu 24.04 ARM64 host bootstrap

The repository MUST ship a single executable bootstrap script (under `infrastructure/server/`) that prepares a fresh Ubuntu 24.04 ARM64 host for hosting the deploy stack. The script MUST be safe to re-run any number of times — every step MUST be guarded so a second invocation is a no-op when the prior state already satisfies the goal. The script MUST install: Docker Engine + the Compose v2 plugin from Docker's official APT repository (using the `signed-by=/etc/apt/keyrings/docker.gpg` pattern, since `apt-key` was removed in Ubuntu 24.04), `sops`, `age`, `jq`, `curl`, `restic`, `ufw`. The script MUST refuse to run on architectures other than `aarch64`/`arm64` and on Ubuntu releases older than `noble` (24.04).

#### Scenario: First run installs everything

- **GIVEN** a freshly provisioned Ubuntu 24.04 ARM64 host with only `ssh` and `sudo` configured
- **WHEN** the operator runs the bootstrap script as root
- **THEN** the script exits 0
- **AND** `docker version` reports server engine ≥ 26.x and the compose v2 plugin
- **AND** `sops --version` and `age --version` print without error
- **AND** `/srv/tricho/{edge/acme,prod/couchdb/data,dev/couchdb/data}` exist with mode `0700` owned by the corresponding container UIDs

#### Scenario: Re-run is a no-op

- **GIVEN** a host that completed the bootstrap script previously
- **WHEN** the operator re-runs the bootstrap script
- **THEN** the script exits 0
- **AND** no APT package is reinstalled
- **AND** no existing `/srv/tricho/**` data is touched
- **AND** the runner systemd unit is not re-registered (its `.runner` config file remains unchanged)

#### Scenario: Wrong architecture aborts cleanly

- **GIVEN** the bootstrap script run on an `x86_64` host
- **WHEN** the script reaches the architecture check
- **THEN** the script exits non-zero before any APT or system mutation
- **AND** stderr names the detected architecture and the supported value (`arm64`)

### Requirement: Hardened Docker daemon configuration

The host's `/etc/docker/daemon.json` MUST be installed with at minimum: `"no-new-privileges": true`, `"userland-proxy": false`, `"log-driver": "json-file"`, and a `"log-opts"` block that caps `max-size` to `10m` and `max-file` to `3`. The bootstrap MUST NOT enable `userns-remap` for v1 (single-tenant host); a clear comment in the file MUST justify this so a future operator does not enable it unaware of the migration cost. The Docker socket `/var/run/docker.sock` MUST remain mode `0660` and group-owned by `docker`.

#### Scenario: Daemon hardening flags applied

- **GIVEN** a bootstrapped host
- **WHEN** the operator inspects `/etc/docker/daemon.json`
- **THEN** the file contains `"no-new-privileges": true`
- **AND** `"log-opts"` caps the per-container log file size and rotation count
- **AND** `systemctl status docker` reports an active daemon that successfully loaded the configuration

#### Scenario: Container without explicit privileges cannot escalate

- **GIVEN** a bootstrapped host with the hardened daemon config
- **WHEN** an operator runs `docker run --rm alpine sh -c 'id; capsh --print'`
- **THEN** the container reports the dropped baseline capability set imposed by `no-new-privileges: true`
- **AND** the container cannot acquire additional capabilities mid-run

### Requirement: Persistent host data layout under `/srv/tricho`

The host MUST organize all persistent server-deploy state under `/srv/tricho/`. Each environment's CouchDB data MUST live at `/srv/tricho/<env>/couchdb/data/` (e.g., `/srv/tricho/prod/couchdb/data/`). Edge ACME state MUST live at `/srv/tricho/edge/acme/`. Per-environment SOPS-decrypted runtime secrets MUST live at `/srv/tricho/<env>/secrets-runtime/` and MUST be wiped on `compose down` of that environment. No persistent server-deploy state SHALL live under `/var/lib/docker/volumes/` — bind mounts only.

#### Scenario: Operator can locate any environment's data

- **GIVEN** a host running both `tricho-sync-prod` and `tricho-sync-dev`
- **WHEN** the operator runs `find /srv/tricho -maxdepth 3 -type d`
- **THEN** the output includes `/srv/tricho/edge/acme`, `/srv/tricho/prod/couchdb/data`, `/srv/tricho/dev/couchdb/data`
- **AND** the per-environment data paths are siblings — neither one is nested inside the other

#### Scenario: `docker volume prune` does not destroy persistent state

- **GIVEN** a host with the stack running
- **WHEN** the operator runs `docker volume prune --force`
- **THEN** no data under `/srv/tricho/**` is deleted
- **AND** the next `compose up` reuses the existing CouchDB data and ACME state

### Requirement: Self-hosted runner registered with JIT tokens and ephemeral mode

The bootstrap MUST register the host as a self-hosted GitHub Actions runner using a just-in-time configuration obtained at install time via `POST /repos/beranku/tricho.app/actions/runners/generate-jitconfig` (or the org-level equivalent). The runner MUST run with `--ephemeral` so each job acquires a fresh registration. The runner's label MUST equal the host's fully-qualified DNS name (e.g., `o3.tricho.app`). The script MUST NOT persist a long-lived registration token on disk.

#### Scenario: Runner registers with the host's hostname as label

- **GIVEN** the bootstrap script run with a one-shot installation token
- **WHEN** the registration step finishes
- **THEN** the GitHub repository's runners list shows a runner whose label set includes the host's fully-qualified hostname
- **AND** no plain-text registration token remains under `/opt/actions-runner/`, `/etc/`, or any history file

#### Scenario: Runner exits cleanly after each job

- **GIVEN** the runner is healthy and idle
- **WHEN** the runner picks up and completes one workflow job
- **THEN** the runner process exits with status 0
- **AND** the systemd unit re-spawns the runner with a fresh JIT registration before the next job arrives
- **AND** `/opt/actions-runner/_work/` is wiped or reset so the next job starts on a clean tree

### Requirement: Hardened systemd unit for the runner

The runner MUST run as a dedicated unprivileged user (e.g., `ghrunner`), not root. The systemd unit MUST set at least: `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ReadWritePaths=/opt/actions-runner /var/run/docker.sock`, `ProtectHome=yes`, `PrivateTmp=yes`, `PrivateDevices=yes`, `ProtectKernelTunables=yes`, `ProtectKernelModules=yes`, `ProtectControlGroups=yes`, `RestrictSUIDSGID=yes`, `RestrictNamespaces=yes`, `LockPersonality=yes`, `SystemCallArchitectures=native`, `LogNamespace=ghrunner`. The runner MUST be a member of the `docker` group so it can drive Compose without `sudo`, but it MUST NOT be a member of `sudo`/`wheel`. `RUNNER_ALLOW_RUNASROOT=1` MUST NOT appear anywhere in the unit, environment file, or wrapper script.

#### Scenario: Hardening shows in systemd-analyze

- **GIVEN** the runner unit installed
- **WHEN** the operator runs `systemd-analyze security actions.runner.beranku-tricho.app.<host>.service`
- **THEN** the security level is "OK" or better (`> 8` of 10)
- **AND** `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=yes`, and `ReadWritePaths` are listed as set

#### Scenario: Runner cannot escalate via setuid binary

- **GIVEN** the runner running a job
- **WHEN** the job invokes a setuid binary (e.g., `sudo`)
- **THEN** the call returns "no new privileges" / `EPERM`
- **AND** the job step fails closed

#### Scenario: Runner cannot write outside its workspace

- **GIVEN** the runner running a job
- **WHEN** the job attempts to write to `/etc/`, `/usr/`, `/lib/`, or any path outside `/opt/actions-runner` or `/var/run/docker.sock`
- **THEN** the write fails with `EROFS` or `EACCES`
- **AND** the job step fails

### Requirement: Runner version is pinned and the upgrade path is explicit

The bootstrap MUST install a specific runner version (downloaded by checksum-verified tarball, not via `curl | sh`). The runner MUST be configured with `--disableupdate` so a daemon-side auto-update cannot be triggered mid-job, AND the repository MUST configure Renovate (or an equivalent) to open a PR within 30 days whenever the upstream `actions/runner` release tags. Production runner upgrades MUST happen via the `server-bootstrap.yml` workflow (which re-runs `install-host.sh` and `install-runner.sh` on the runner itself), not via interactive SSH.

#### Scenario: Auto-update is suppressed

- **GIVEN** the runner installed by the bootstrap
- **WHEN** the operator inspects the runner's launch arguments via `systemctl cat`
- **THEN** `--disableupdate` is present
- **AND** the runner does NOT contact GitHub's auto-update endpoint at startup

#### Scenario: Runner upgrade flows through the workflow

- **GIVEN** a Renovate PR that bumps the pinned runner version is merged
- **WHEN** the operator triggers `server-bootstrap.yml` with `MODE=runner-upgrade`
- **THEN** the workflow runs on the existing runner
- **AND** the new runner version replaces the old one with a single ≤30-second window of unavailability
- **AND** subsequent workflow runs use the new version
