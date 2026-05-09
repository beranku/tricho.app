#!/usr/bin/env bash
# Lint server-deploy compose files for forbidden patterns.
#
# Per openspec/specs/server-stack-deploy/spec.md, sync stack compose
# files MUST NOT pin any `name:` field on volumes or networks — the
# COMPOSE_PROJECT_NAME prefix is the sole isolation mechanism. Pinning a
# `name:` would silently share state across environments.
#
# Exception: an `external: true` resource MUST carry `name:` to refer to
# the externally-managed resource. The lint allows `name:` only when the
# same resource block also declares `external: true`.
#
# Run via: make infrastructure-lint
#         (or directly: bash scripts/infrastructure-lint.sh)

set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

target="infrastructure/server/sync/compose.yml"
status=0

if [ ! -f "$target" ]; then
  echo "infrastructure-lint: $target not present yet (skipping); add it per add-server-deploy-stack tasks 7.x"
  echo "infrastructure-lint: OK"
  exit 0
fi

# State machine in awk:
#   in_block: "" | "vol" | "net" — set when we enter a top-level
#       `volumes:` or `networks:` key (column 0) and cleared when we
#       enter any other column-0 key.
#   resource_indent: indentation of the current sub-resource header
#       (e.g. 2 for "  tricho-edge:").
#   resource_external: 1 if the current resource has `external: true`.
#   resource_name_line: the line number of a `name:` we've seen inside
#       the current resource (0 if none).
#
# When we leave a resource (next sibling header, or top-level key, or
# EOF), we check: if resource_external==0 AND resource_name_line>0, emit
# a violation.

result="$(awk '
  function flush() {
    if (in_block != "" && resource_name_line > 0 && resource_external == 0) {
      printf "%s:%d: forbidden `name:` on non-external %s in resource `%s`\n", \
        FILENAME, resource_name_line, in_block, resource_name
    }
    resource_indent = -1
    resource_name_line = 0
    resource_external = 0
    resource_name = ""
  }

  BEGIN { in_block=""; resource_indent=-1; resource_name_line=0; resource_external=0 }

  # Top-level keys (column 0, no leading whitespace).
  /^[A-Za-z_]/ {
    flush()
    if ($0 ~ /^volumes:/)  { in_block="vol";  next }
    if ($0 ~ /^networks:/) { in_block="net";  next }
    in_block=""; next
  }

  # Blank lines and comments — skip without state change.
  /^[[:space:]]*$/   { next }
  /^[[:space:]]*#/   { next }

  in_block == "" { next }

  # Compute leading indent (count of leading spaces).
  {
    indent = match($0, /[^[:space:]]/) - 1
  }

  # A new resource header is a key:value line at the smallest indent
  # we have seen inside the block (typically 2). Detect by:
  #   - line ends with ":" (or ": {}" / ": []" — accept those too)
  #   - indent < current resource_indent (i.e. this is a sibling/parent)
  /^[[:space:]]+[A-Za-z_][A-Za-z0-9_-]*:[[:space:]]*({}|\[\])?[[:space:]]*$/ {
    if (resource_indent == -1 || indent <= resource_indent) {
      flush()
      resource_indent = indent
      # Strip leading space + trailing ":" (and any "{}" inline form).
      resource_name = $0
      sub(/^[[:space:]]+/, "", resource_name)
      sub(/:.*$/, "", resource_name)
    }
    next
  }

  # external: true marks the current resource as externally-managed.
  /^[[:space:]]+external:[[:space:]]*true[[:space:]]*$/ {
    if (resource_indent != -1 && indent > resource_indent) {
      resource_external = 1
    }
    next
  }

  # name: <value> inside a resource — record line number.
  /^[[:space:]]+name:[[:space:]]+/ {
    if (resource_indent != -1 && indent > resource_indent) {
      resource_name_line = NR
    }
    next
  }

  END { flush() }
' "$target")"

if [ -n "$result" ]; then
  echo "infrastructure-lint: forbidden \`name:\` pin in volumes/networks of $target" >&2
  echo "$result" >&2
  echo "  → rely on COMPOSE_PROJECT_NAME prefix instead (see openspec/specs/server-stack-deploy/)" >&2
  status=1
fi

if [ $status -eq 0 ]; then
  echo "infrastructure-lint: OK"
fi
exit $status
