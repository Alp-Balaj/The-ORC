# Sourced by the test scripts: start a command as its own killable group, and hard-kill it,
# on Linux/macOS (setsid + process-group SIGKILL) and in Git Bash on Windows (taskkill /T).
is_windows() { case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; *) return 1 ;; esac; }

# start_group <cmd...>: runs it in the background, output discarded; sets $group.
start_group() {
  if is_windows; then "$@" >/dev/null 2>&1 &
  else setsid "$@" >/dev/null 2>&1 &
  fi
  group=$!
}

# kill_group <group>: SIGKILL-equivalent for the whole tree, no cleanup runs.
kill_group() {
  if is_windows; then
    # Windows has no process groups: kill the native process tree under the background job.
    local w
    w=$(cat "/proc/$1/winpid" 2>/dev/null) && taskkill //F //T //PID "$w" >/dev/null 2>&1
    kill -KILL "$1" 2>/dev/null
  else
    kill -KILL -- -"$1" 2>/dev/null
  fi
  return 0
}
