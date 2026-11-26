#!/usr/bin/env bash
# Terminal-less launcher used by the desktop shortcuts (see scripts/install-shortcut.*).
# Runs scripts/orc-app.sh and appends all output to ~/.local/state/the-orc/launch.log.
repo="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
log="${ORC_LAUNCH_LOG:-$HOME/.local/state/the-orc/launch.log}"
mkdir -p "$(dirname "$log")"
# Keep the log from growing forever: start fresh past 1 MB.
[ "$(wc -c <"$log" 2>/dev/null || echo 0)" -gt 1048576 ] && : >"$log"
{ echo "--- $(date '+%F %T') launching The ORC from $repo"; } >>"$log"
exec "$repo/scripts/orc-app.sh" "$@" >>"$log" 2>&1 </dev/null
