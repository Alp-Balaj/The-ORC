#!/usr/bin/env bash
# The ORC you use day to day: a stable copy of `main`, separate from the checkout missions merge
# into. Running The ORC from that checkout (pnpm dev) means Merge to main changes the code of the
# running app under it.
#
#   scripts/orc-app.sh            start the stable copy (builds it the first time)
#   scripts/orc-app.sh update     move it to the latest local main, rebuild, start
#   scripts/orc-app.sh rebuild    same as update but does not start it (used by the app's Update app button;
#                                 a running copy keeps its old code until it is restarted)
#
# The copy is a detached git worktree at $ORC_APP_DIR (default ~/.local/share/the-orc/app). It
# uses the same app data as `pnpm dev` (~/.config/the-orc), so spaces and missions carry over.
# Quit any other ORC first: only one may run on that data.
set -euo pipefail
repo="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
app="${ORC_APP_DIR:-$HOME/.local/share/the-orc/app}"

build() {
  (cd "$app" && pnpm install --frozen-lockfile && pnpm build)
}

if [ "${1:-}" = rebuild ]; then
  # Exits inside this block: the checkout below may replace this very script while bash is reading it.
  if [ ! -d "$app/.git" ] && [ ! -f "$app/.git" ]; then
    mkdir -p "$(dirname "$app")"
    git -C "$repo" worktree add --detach "$app" main
  else
    git -C "$app" checkout -q --detach main
  fi
  build
  exit 0
fi

if [ ! -d "$app/.git" ] && [ ! -f "$app/.git" ]; then
  mkdir -p "$(dirname "$app")"
  git -C "$repo" worktree add --detach "$app" main
  build
elif [ "${1:-}" = update ]; then
  git -C "$app" checkout -q --detach main
  build
fi
[ -d "$app/out" ] || build
cd "$app"
exec node_modules/.bin/electron . >/dev/null 2>&1
