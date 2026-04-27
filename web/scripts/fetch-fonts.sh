#!/usr/bin/env bash
# Self-host the four font families used by Tricho UI design system.
# Downloads woff2 files into public/fonts/ subset to Latin + Czech (latin-ext).
#
# Usage: bash scripts/fetch-fonts.sh
#   (also runs automatically as `prebuild` before `npm run build`)
#
# The URLs pin the exact file revisions Google Fonts CSS API v2 currently
# returns. Google rotates them periodically; if you get 404s, regenerate via:
#   curl -H "User-Agent: Mozilla/5.0 ... Chrome/120 ..." \
#     "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..700&family=Geist:wght@300..700&family=Caveat:wght@400..700&family=Patrick+Hand&display=swap"
# and refresh this script. Without a modern Chrome User-Agent Google serves
# legacy TTF, so the UA header is required.

set -euo pipefail

DEST="$(cd "$(dirname "$0")/.." && pwd)/public/fonts"
mkdir -p "$DEST/fraunces" "$DEST/geist" "$DEST/caveat" "$DEST/patrick-hand"

# Fraunces — variable, opsz + wght axes, italic + roman.
curl -sSfLo "$DEST/fraunces/fraunces-roman-latin-ext.woff2" \
  "https://fonts.gstatic.com/s/fraunces/v38/6NU78FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0KxCFTeO-U.woff2"
curl -sSfLo "$DEST/fraunces/fraunces-roman-latin.woff2" \
  "https://fonts.gstatic.com/s/fraunces/v38/6NU78FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0KxC9TeA.woff2"

# Geist — variable, wght axis, sans-serif.
curl -sSfLo "$DEST/geist/geist-latin-ext.woff2" \
  "https://fonts.gstatic.com/s/geist/v4/gyByhwUxId8gMEwSGFWfOw.woff2"
curl -sSfLo "$DEST/geist/geist-latin.woff2" \
  "https://fonts.gstatic.com/s/geist/v4/gyByhwUxId8gMEwcGFU.woff2"

# Caveat — variable, wght axis (cursive handwriting).
curl -sSfLo "$DEST/caveat/caveat-latin-ext.woff2" \
  "https://fonts.gstatic.com/s/caveat/v23/Wnz6HAc5bAfYB2Q7aDYYmg8.woff2"
curl -sSfLo "$DEST/caveat/caveat-latin.woff2" \
  "https://fonts.gstatic.com/s/caveat/v23/Wnz6HAc5bAfYB2Q7ZjYY.woff2"

# Patrick Hand — single weight (printed handwriting).
curl -sSfLo "$DEST/patrick-hand/patrick-hand-latin-ext.woff2" \
  "https://fonts.gstatic.com/s/patrickhand/v25/LDI1apSQOAYtSuYWp8ZhfYe8UMLLq7s.woff2"
curl -sSfLo "$DEST/patrick-hand/patrick-hand-latin.woff2" \
  "https://fonts.gstatic.com/s/patrickhand/v25/LDI1apSQOAYtSuYWp8ZhfYe8XsLL.woff2"

echo "Fonts written to $DEST"
