#!/usr/bin/env bash
# Billed (1 Haiku session): pause mid-turn, SIGKILL The ORC, relaunch, the real session resumes.
# Usage: tests/resume.sh <out-dir>
set -u
out=${1:?usage: tests/resume.sh <out-dir>}
here=$(cd "$(dirname "$0")/.." && pwd)
. "$here/tests/proc.sh"
rm -rf "$out"; mkdir -p "$out/a" "$out/b"
cd "$here" && pnpm -s build >/dev/null || exit 1
state="$out/missions.json"
start_group env ORC_SMOKE_OUT="$out/a" ORC_STATE_FILE="$state" ORC_SMOKE_SCENARIO=resume-a \
  timeout 240 node_modules/.bin/electron .
pg=$group
for _ in $(seq 200); do grep -q ready-for-crash "$out/a/timeline.log" 2>/dev/null && break; sleep 1; done
grep -q ready-for-crash "$out/a/timeline.log" || { echo "part 1 never got ready"; kill_group "$pg"; exit 1; }
kill_group "$pg"   # the whole process group: Electron and its fake sessions, no cleanup
sleep 2
ORC_SMOKE_OUT="$out/b" ORC_STATE_FILE="$state" ORC_SMOKE_SCENARIO=resume-b \
  timeout 240 node_modules/.bin/electron . 2>&1 | grep -E "SMOKE|ok|FAIL"
code=${PIPESTATUS[0]}
if grep -q " FAIL " "$out/a/timeline.log"; then echo "part 1 had failures:"; grep " FAIL " "$out/a/timeline.log"; code=1; fi
"$here/tests/kill-strays.sh"; "$here/tests/clean-sandbox.sh"
exit "$code"
