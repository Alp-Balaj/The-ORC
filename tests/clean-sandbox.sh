#!/usr/bin/env bash
# Removes worktrees and orc/smoke-* branches left by test missions in orc-sandbox (only there).
set -u
sandbox="$HOME/Documents/Projects/orc-sandbox"
for wt in $(git -C "$sandbox" worktree list --porcelain | sed -n 's/^worktree //p' | grep '/.orc/worktrees/smoke-'); do
  # Windows: a session that is still exiting (or the virus scanner) can hold a file briefly.
  for try in 1 2 3 4 5; do
    git -C "$sandbox" worktree remove --force "$wt" 2>/dev/null && break
    # A failed delete can still unregister it; the leftover folder is removed below.
    git -C "$sandbox" worktree list --porcelain | grep -qxF "worktree $wt" || break
    [ "$try" = 5 ] && git -C "$sandbox" worktree remove --force "$wt"
    sleep 2
  done
done
git -C "$sandbox" worktree prune
# Windows can leave the folders behind (emptied, or half-deleted while a file was held):
# remove test folders git no longer lists as worktrees.
registered=$(git -C "$sandbox" worktree list --porcelain | sed -n 's/^worktree //p')
for d in "$sandbox"/.orc/worktrees/smoke-*/ "$sandbox"/.orc/worktrees/smoke-*/*/; do
  [ -d "$d" ] || continue
  d=${d%/}
  grep -qF "$(cygpath -m "$d" 2>/dev/null || echo "$d")" <<<"$registered" || rm -rf "$d"
done
# for-each-ref patterns match whole path components, so list under orc/ and filter.
git -C "$sandbox" for-each-ref --format='%(refname:short)' refs/heads/orc/ refs/heads/integration/ | grep -E '^(orc|integration)/smoke-' | while read -r b; do
  git -C "$sandbox" branch -D "$b" >/dev/null
done
