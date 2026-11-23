# orc-session-env

`sessionEnv()` in `src/main/claude-launch.ts` now sets `ORC_SESSION=1` on every ORC-launched claude session's env, so user Stop/Notification hooks (e.g. notify.sh) can detect and skip ORC sessions. Nothing else about env behaviour changed. Verified with a node one-liner importing `sessionEnv` (result had `ORC_SESSION === '1'`).
