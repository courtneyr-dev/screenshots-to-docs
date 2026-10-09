#!/usr/bin/env bash
# setup.sh — idempotent installer for the screenshots-to-docs tool.
# Verifies node + npm, finds Chrome/Chromium, runs npm install, smoke-checks the scripts.
# Safe to re-run. Pass --force to reinstall.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

log()  { printf '[screenshots-to-docs] %s\n' "$*"; }
die()  { printf '[screenshots-to-docs] ERROR: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "node is required but not on PATH"
command -v npm  >/dev/null 2>&1 || die "npm is required but not on PATH"

chromium=""
for c in "${NEXTJS_SCREENSHOTS_CHROMIUM:-}" "${PUPPETEER_EXECUTABLE_PATH:-}" \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  /usr/bin/chromium-browser /usr/bin/chromium /usr/bin/google-chrome /usr/bin/google-chrome-stable; do
  if [[ -n "$c" && -x "$c" ]]; then chromium="$c"; break; fi
done
if [[ -n "$chromium" ]]; then log "chromium: $chromium"
else log "WARN: no Chrome/Chromium found; set NEXTJS_SCREENSHOTS_CHROMIUM=/path/to/chrome"; fi

cd "$SKILL_DIR"
if [[ -d node_modules/puppeteer-core && $FORCE -eq 0 ]]; then
  log "dependencies present"
else
  rm -rf node_modules
  npm install --no-audit --no-fund
fi

for s in scripts/*.mjs; do node --check "$s" || die "$s failed to parse"; done
log "ready. Next: npm run setup -- --only config (asks which app you capture), or copy examples/<preset>.config.example.json to <preset>.config.json, fill it in, and run: node scripts/preflight.mjs --config <preset>.config.json"
