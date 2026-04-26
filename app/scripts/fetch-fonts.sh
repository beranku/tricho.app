#!/usr/bin/env bash
# Self-host the four font families used by Tricho UI design system.
# Downloads woff2 files into public/fonts/ subset to Latin + Czech (latin-ext).
#
# Usage: bash scripts/fetch-fonts.sh
#
# The URLs pin the exact file revisions Google Fonts CSS API v2 currently
# returns; if Google rotates them, run `curl https://fonts.googleapis.com/css2?…`
# and refresh this script.

set -euo pipefail

DEST="$(cd "$(dirname "$0")/.." && pwd)/public/fonts"
mkdir -p "$DEST/fraunces" "$DEST/geist" "$DEST/caveat" "$DEST/patrick-hand"

# Fraunces — variable, opsz + wght axes, italic + roman.
curl -sSfLo "$DEST/fraunces/fraunces-roman-latin-ext.woff2" \
  "https://fonts.gstatic.com/s/fraunces/v37/6NUh8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0Kw9p61Q-Js9yLg9HXh_77sMzs8M3w7e3p9SDi8MTXpz_ZjJ4Q3K6mO2dkRPCUhJ8.woff2" || true
curl -sSfLo "$DEST/fraunces/fraunces-roman-latin.woff2" \
  "https://fonts.gstatic.com/s/fraunces/v37/6NUh8FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0Kw9p61Q-Js9yLg9HXh_77sMzs8M3w7e3p9SDi8MTXpz_ZjJ4Q3K6mO2dkRPCSp5g.woff2" || true

# Geist — variable, wght axis, sans-serif.
curl -sSfLo "$DEST/geist/geist-latin-ext.woff2" \
  "https://fonts.gstatic.com/s/geist/v6/gyBhhwUxId8gMGYQMKR3pzfaWI_RnOM4nuwgPRQg7l32hl_rOXNEi4_kS6ZsWY1KQA.woff2" || true
curl -sSfLo "$DEST/geist/geist-latin.woff2" \
  "https://fonts.gstatic.com/s/geist/v6/gyBhhwUxId8gMGYQMKR3pzfaWI_RnOM4nuwgPRQg7l32hl_rOXNEi4_kS6ZsW41KQA.woff2" || true

# Caveat — variable, wght axis (cursive handwriting).
curl -sSfLo "$DEST/caveat/caveat-latin-ext.woff2" \
  "https://fonts.gstatic.com/s/caveat/v18/WBLgrEDQfcVroHE4M3R9TQfKy7LzTEzQOg.woff2" || true
curl -sSfLo "$DEST/caveat/caveat-latin.woff2" \
  "https://fonts.gstatic.com/s/caveat/v18/WBLgrEDQfcVroHE4M3R9TQfKy7L9TEzQ.woff2" || true

# Patrick Hand — single weight (printed handwriting).
curl -sSfLo "$DEST/patrick-hand/patrick-hand-latin-ext.woff2" \
  "https://fonts.gstatic.com/s/patrickhand/v23/LDI1apSQOAYtSuYWp8ZhfYeMWcjKm7sp8g.woff2" || true
curl -sSfLo "$DEST/patrick-hand/patrick-hand-latin.woff2" \
  "https://fonts.gstatic.com/s/patrickhand/v23/LDI1apSQOAYtSuYWp8ZhfYeMWcjKm7sm8g.woff2" || true

echo "Fonts written to $DEST. Verify checksums match the prototype before committing."
