#!/usr/bin/env bash
# Free: The ORC must bring missions back after
#   1. a crash (SIGKILL of the whole process group), fake sessions;
#   2. a normal quit (app.quit, as Ctrl+Q), fake sessions;
#   3. a normal quit with a REAL coordinator that never got a prompt (relaunched with its same
#      --session-id; nothing is ever sent to the model, so it is not billed).
# Usage: tests/crash.sh <out-dir>
set -u
out=${1:?usage: tests/crash.sh <out-dir>}
here=$(cd "$(dirname "$0")/.." && pwd)
. "$here/tests/proc.sh"
rm -rf "$out"; mkdir -p "$out"
cd "$here" && pnpm -s build >/dev/null || exit 1
fail=0
round() { # name scenario-a scenario-b extra-env-for-a... ; fake sessions unless REAL=1
  local name=$1 a=$2 b=$3; shift 3
  mkdir -p "$out/$name/a" "$out/$name/b"
  local state="$out/$name/missions.json" fake=1
  [ "${REAL:-}" = 1 ] && fake=
  start_group env ORC_SMOKE_OUT="$out/$name/a" ORC_STATE_FILE="$state" ORC_SMOKE_FAKE=$fake ORC_SMOKE_SCENARIO=$a "$@" \
    timeout 120 node_modules/.bin/electron .
  local pg=$group
  for _ in $(seq 90); do grep -q ready-for-crash "$out/$name/a/timeline.log" 2>/dev/null && break; sleep 1; done
  grep -q ready-for-crash "$out/$name/a/timeline.log" || { echo "$name: part 1 never got ready"; fail=1; }
  if [ "${QUIT:-}" = 1 ]; then for _ in $(seq 20); do kill -0 "$pg" 2>/dev/null || break; sleep 1; done; fi
  kill_group "$pg"
  sleep 2
  "$here/tests/kill-strays.sh" >/dev/null
  env ORC_SMOKE_OUT="$out/$name/b" ORC_STATE_FILE="$state" ORC_SMOKE_FAKE=$fake ORC_SMOKE_SCENARIO=$b \
    timeout 120 node_modules/.bin/electron . 2>&1 | grep -E "SMOKE|FAIL" | sed "s/^/$name: /"
  grep -q '^  "ok": true' "$out/$name/b/report.json" 2>/dev/null || fail=1
  "$here/tests/kill-strays.sh" >/dev/null
}
round crash crash-a crash-b
QUIT=1 round quit crash-a crash-b ORC_SMOKE_QUIT=1
QUIT=1 REAL=1 round fresh fresh-a fresh-b
"$here/tests/clean-sandbox.sh"
[ $fail = 0 ] && echo "CRASH TESTS PASS" || echo "CRASH TESTS FAIL"
exit $fail
