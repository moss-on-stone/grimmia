#!/bin/bash
#
# selftest.sh — run the headless renderer E2E self-test.
#
# Boots the app with `--dev --selftest`, which drives the REAL renderer DOM
# against a fake (no-network, no-upload) backend and asserts the search →
# facets → favorites → sort → item-modal → saved-search → theme flows. Prints a
# PASS/FAIL summary and exits 0 (pass) or non-zero (fail) so it is CI-runnable.
#
# Usage: scripts/selftest.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[INFO] running headless self-test…"
# 60s ceiling; the harness has its own 20s internal timeout. Use whichever
# timeout binary exists (gtimeout on macOS w/ coreutils, timeout on CI), or none.
if command -v gtimeout >/dev/null 2>&1; then TIMEOUT="gtimeout 60";
elif command -v timeout >/dev/null 2>&1; then TIMEOUT="timeout 60";
else TIMEOUT=""; fi
OUT="$($TIMEOUT ./node_modules/.bin/electron . --dev --selftest 2>&1)"
CODE=$?

echo "$OUT" | grep -E "SELFTEST (PASS|FAIL)|SELFTEST_FAIL" || true

if [ $CODE -eq 0 ]; then
  echo "[INFO] self-test PASSED"
else
  echo "[ERROR] self-test FAILED (exit $CODE)" >&2
fi
exit $CODE
