#!/usr/bin/env bash
# Smoke: every runtime service block in compose.yml has a healthcheck or
# an explicit opt-out comment. Uses pure POSIX tools so it runs on macOS
# BSD awk and GNU awk alike.

set -euo pipefail

cd "$(dirname "$0")/../.."

# Python's yaml is universally available via Homebrew + Linux repos.
python3 - <<'PY'
import sys
import yaml
import re
import pathlib

doc = yaml.safe_load(pathlib.Path('compose.yml').read_text())
services = doc.get('services', {})
raw = pathlib.Path('compose.yml').read_text()

missing = []
for name, svc in services.items():
    if isinstance(svc, dict) and svc.get('healthcheck'):
        continue
    # Allow explicit opt-out with "# no-healthcheck: <why>" on a line
    # within the service block.
    pat = re.compile(rf'^\s+{re.escape(name)}:\s*$.*?(?=^\s{{0,2}}\S|\Z)',
                     re.DOTALL | re.MULTILINE)
    m = pat.search(raw)
    block = m.group(0) if m else ''
    if '# no-healthcheck:' in block:
        continue
    missing.append(name)

if missing:
    print('healthcheck-declared: service(s) missing healthcheck:', file=sys.stderr)
    for s in missing:
        print(f'  - {s}', file=sys.stderr)
    print('→ add healthcheck: block or "# no-healthcheck: <why>" comment.', file=sys.stderr)
    sys.exit(1)
print('healthcheck-declared: OK')
PY
