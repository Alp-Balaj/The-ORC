#!/usr/bin/env bash
# Billed end-to-end test (Haiku, ~3 sessions): hidden Electron, a real mission in orc-sandbox.
# Usage: tests/e2e.sh <out-dir> [prompt]
#        ORC_SMOKE_SCENARIO=permission tests/e2e.sh <out-dir> '<prompt that needs a Bash approval>'
set -u
out=${1:?usage: tests/e2e.sh <out-dir> [prompt]}
prompt=${2:-'Create two files in parallel with two workers: a.txt containing hello, and b.txt containing world.'}
here=$(cd "$(dirname "$0")/.." && pwd)
sandbox="$HOME/Documents/Projects/orc-sandbox"
# Clear worktrees and branches left by earlier smoke missions (sandbox only).
"$(dirname "$0")/clean-sandbox.sh"
# The mission test merges into the sandbox's main; start every run from the same baseline.
git -C "$sandbox" tag -l orc-baseline | grep -q . || git -C "$sandbox" tag orc-baseline 4599c7a
git -C "$sandbox" checkout -q main && git -C "$sandbox" reset -q --hard orc-baseline
rm -rf "$out"; mkdir -p "$out"
cd "$here" && pnpm -s build >/dev/null || exit 1
ORC_SMOKE_OUT="$out" ORC_SMOKE_REPO="$sandbox" ORC_SMOKE_PROMPT="$prompt" \
  ORC_SMOKE_TIMEOUT_S=${ORC_SMOKE_TIMEOUT_S:-600} timeout 800 node_modules/.bin/electron . 2>&1 | grep -v ozone
code=${PIPESTATUS[0]}
"$here/tests/kill-strays.sh"
echo "exit $code"
exit "$code"
