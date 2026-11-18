#!/usr/bin/env bash
# Removes worktrees and orc/smoke-* branches left by test missions in orc-sandbox (only there).
set -u
sandbox="$HOME/Documents/Projects/orc-sandbox"
for wt in $(git -C "$sandbox" worktree list --porcelain | sed -n 's/^worktree //p' | grep '/.orc/worktrees/smoke-'); do
  git -C "$sandbox" worktree remove --force "$wt"
done
git -C "$sandbox" worktree prune
# for-each-ref patterns match whole path components, so list under orc/ and filter.
git -C "$sandbox" for-each-ref --format='%(refname:short)' refs/heads/orc/ | grep '^orc/smoke-' | while read -r b; do
  git -C "$sandbox" branch -D "$b" >/dev/null
done
