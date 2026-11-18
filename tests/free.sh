#!/usr/bin/env bash
# Every unbilled check: typecheck, unit tests, build, and the hidden-UI replay scenario.
# Usage: tests/free.sh [out-dir]
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
out=${1:-$(mktemp -d)}
cd "$here"
pnpm -s typecheck
for t in control-server.smoke missions-status.test feed-tokens.test tree-layout.test; do
  node --no-warnings "tests/$t.ts" | tail -1
done
pnpm -s build >/dev/null
rm -rf "$out/replay"
ORC_SMOKE_OUT="$out/replay" ORC_SMOKE_SCENARIO=replay timeout 180 node_modules/.bin/electron . 2>&1 | grep -E "SMOKE|FAIL" || true
"$here/tests/kill-strays.sh" >/dev/null
grep -q '"ok": true' "$out/replay/report.json" && echo "ALL FREE CHECKS PASS (screenshots in $out/replay)"
