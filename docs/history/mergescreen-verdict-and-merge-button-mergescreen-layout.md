# MergeScreen verdict + merge button (mergescreen-layout)

- MergeScreen's right column now starts with a verdict card (`verdict-panel`): Gate, Verifier, Conflicts rows (StatusIcon + label + result, "(stale)" suffix) and the single Merge to main button (`confirm-merge`, still only in MergeScreen). Gate/Verifier panels sit below, scrollable.
- Conflicts = Fast-forward-only merge: clean when every worker is merged, warn when some are not.
- After `mission.mergedToMain` the diff area becomes `merged-success` (green check, short commit, Remove mission / New mission). Remove calls `removeMission` then the new optional `onRemoved` prop (App clears selection); New mission uses `emitShortcut('newMission')`. The `onCleared` banner flow is unchanged.
