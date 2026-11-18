#!/usr/bin/env bash
# Kills `claude` processes left by TESTS: only those whose working directory is inside
# orc-sandbox (every test session, the Verifier included, runs there). Missions the owner runs
# in other repos are never touched, even though they carry the same ORC flags.
set -u
sandbox="$HOME/Documents/Projects/orc-sandbox"
found=0
for pid in $(pgrep -x claude; pgrep -f '/claude( |$)' | sort -u); do
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
  if [[ "$cwd" == "$sandbox" || "$cwd" == "$sandbox/"* ]]; then
    echo "killing $pid (cwd $cwd)"
    kill -HUP "$pid" 2>/dev/null; sleep 1; kill -KILL "$pid" 2>/dev/null
    found=1
  fi
done
[ "$found" = 0 ] && echo "no test claude processes"
exit 0
