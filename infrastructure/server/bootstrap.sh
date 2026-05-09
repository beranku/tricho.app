#!/usr/bin/env bash
# infrastructure/server/bootstrap.sh — one-shot SSH bootstrap wrapper.
#
# Run on a fresh Ubuntu 24.04 ARM64 host as root, ideally via:
#
#   rsync -avz --delete infrastructure/server/ ubuntu@HOST:/tmp/tricho-server/
#   JIT=$(gh api -X POST /repos/beranku/tricho.app/actions/runners/generate-jitconfig \
#     -f name=$HOST -f labels="[\"$HOST\"]" -f runner_group_id=1 \
#     --jq .encoded_jit_config)
#   ssh ubuntu@HOST "sudo RUNNER_JIT_CONFIG='$JIT' bash /tmp/tricho-server/bootstrap.sh"
#
# Subsequent re-bootstraps (host reinstall, runner upgrade, etc.) prefer the
# server-bootstrap.yml workflow, which runs install-host.sh / install-runner.sh
# through the existing runner. This script is the cold-start path.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "must run as root (try: sudo $0)" >&2
  exit 1
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"

bash "$script_dir/install-host.sh"
bash "$script_dir/install-runner.sh"

cat <<EOF

==========================================================================
Bootstrap complete on $(hostname -f).

Next steps:
  1. (One-time) Generate the per-host age key:
       sudo install -d -m 0700 /etc/sops/age
       sudo age-keygen -o /etc/sops/age/$(hostname -f).key
       sudo chmod 0600 /etc/sops/age/$(hostname -f).key
       sudo grep "# public key:" /etc/sops/age/$(hostname -f).key
     Add the printed public key to .sops.yaml on your laptop, run
       make secrets-rotate-age
     and commit.

  2. Verify the runner registered:
       systemctl status actions.runner.beranku-tricho.app.$(hostname -f).service

  3. Edge bootstrap (one-shot via workflow once runner is healthy):
       gh workflow run server-bootstrap.yml \\
         -f RUNNER_LABEL=$(hostname -f) \\
         -f MODE=edge-up

  4. First dev deploy: push to dev branch.

Full runbook: docs/server-deploy.md
==========================================================================
EOF
