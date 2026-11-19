#!/usr/bin/env bash
# Kills `claude` processes left by TESTS: only those whose working directory is inside
# orc-sandbox (every test session, the Verifier included, runs there). Missions the owner runs
# in other repos are never touched, even though they carry the same ORC flags.
set -u
here=$(cd "$(dirname "$0")" && pwd)
. "$here/proc.sh"
sandbox="$HOME/Documents/Projects/orc-sandbox"
found=0
if is_windows; then
  # No /proc/<pid>/cwd on Windows: proc-cwd.ps1 reads it from each process. Paths compare
  # case-insensitively, with forward slashes.
  win_sandbox=$(cygpath -m "$sandbox" | tr '[:upper:]' '[:lower:]')
  while IFS=$'\t' read -r pid cwd; do
    [ -n "$pid" ] || continue
    c=$(printf '%s' "$cwd" | tr '\\' '/' | tr '[:upper:]' '[:lower:]')
    if [[ "$c" == "$win_sandbox" || "$c" == "$win_sandbox/"* ]]; then
      echo "killing $pid (cwd $cwd)"
      taskkill //F //T //PID "$pid" >/dev/null 2>&1
      found=1
    fi
  done < <(powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$(cygpath -w "$here/proc-cwd.ps1")" claude | tr -d '\r')
else
  for pid in $(pgrep -x claude; pgrep -f '/claude( |$)' | sort -u); do
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
    if [[ "$cwd" == "$sandbox" || "$cwd" == "$sandbox/"* ]]; then
      echo "killing $pid (cwd $cwd)"
      kill -HUP "$pid" 2>/dev/null; sleep 1; kill -KILL "$pid" 2>/dev/null
      found=1
    fi
  done
fi
[ "$found" = 0 ] && echo "no test claude processes"
exit 0
