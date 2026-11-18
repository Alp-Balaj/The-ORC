#!/usr/bin/env bash
# Kills `claude` processes started by The ORC (they carry its MCP config: an "orc" server on
# 127.0.0.1) or running inside orc-sandbox. Never matches an ordinary claude session.
set -u
sandbox="$HOME/Documents/Projects/orc-sandbox"
found=0
for pid in $(pgrep -x claude; pgrep -f '/claude( |$)'); do
  [ -r "/proc/$pid/cmdline" ] || continue
  args=$(tr '\0' ' ' < "/proc/$pid/cmdline")
  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
  if [[ "$args" == *'"orc":{"type":"http","url":"http://127.0.0.1:'* ]] || [[ "$cwd" == "$sandbox" || "$cwd" == "$sandbox/"* ]]; then
    echo "killing $pid (cwd $cwd)"
    kill -HUP "$pid" 2>/dev/null; sleep 1; kill -KILL "$pid" 2>/dev/null
    found=1
  fi
done
[ "$found" = 0 ] && echo "no ORC claude processes"
exit 0
