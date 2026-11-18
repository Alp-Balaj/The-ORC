#!/usr/bin/env bash
# Free: kill The ORC with SIGKILL mid-mission (fake sessions), relaunch hidden on the same
# state file, and check the mission comes back. Usage: tests/crash.sh <out-dir>
set -u
out=${1:?usage: tests/crash.sh <out-dir>}
here=$(cd "$(dirname "$0")/.." && pwd)
rm -rf "$out"; mkdir -p "$out/a" "$out/b"
cd "$here" && pnpm -s build >/dev/null || exit 1
state="$out/missions.json"
ORC_SMOKE_OUT="$out/a" ORC_STATE_FILE="$state" ORC_SMOKE_FAKE=1 ORC_SMOKE_SCENARIO=crash-a \
  setsid timeout 120 node_modules/.bin/electron . >/dev/null 2>&1 &
pg=$!
for _ in $(seq 60); do grep -q ready-for-crash "$out/a/timeline.log" 2>/dev/null && break; sleep 1; done
grep -q ready-for-crash "$out/a/timeline.log" || { echo "part 1 never got ready"; kill -KILL -- -"$pg"; exit 1; }
kill -KILL -- -"$pg"   # the whole process group: Electron and its fake sessions, no cleanup
sleep 2
ORC_SMOKE_OUT="$out/b" ORC_STATE_FILE="$state" ORC_SMOKE_FAKE=1 ORC_SMOKE_SCENARIO=crash-b \
  timeout 120 node_modules/.bin/electron . 2>&1 | grep -E "SMOKE|ok|FAIL"
code=${PIPESTATUS[0]}
"$here/tests/clean-sandbox.sh"
exit "$code"
