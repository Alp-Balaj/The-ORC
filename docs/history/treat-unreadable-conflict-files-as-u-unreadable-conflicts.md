# Unreadable conflicted files are unresolved

`Missions.afterDone` (src/main/missions.ts) and `markersLeft` (src/main/mission-git.ts) used to
treat a conflicted file whose `readFileSync` threw as resolved. Now any read error other than
`ENOENT` counts the file as still conflicted and is logged with `console.error`. `ENOENT` (file
deleted on purpose while resolving) still counts as resolved.
