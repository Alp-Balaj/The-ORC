# Queue stop control (queue-stop)

- The control already existed: `queue:pause` IPC -> `Queues.pause()` sets `running=false`, `pausedReason='paused by you'`; Start/Resume calls `queue:start`. Persisted in the queue state file like other pauses.
- Stopping only stops *starting* new tasks; running missions are untouched (tooltip says so).
- `clear()`, `add()`, `remove()` never touch `running`/`pausedReason`, so a stopped queue stays stopped after clearing or adding tasks; nothing auto-starts until Resume.
- Change: `QueuePanel.tsx` showed the button only when `pending > 0`, so an emptied queue had no Stop/Resume. Now it shows whenever the queue is running or paused. Button label "Pause" -> "Stop"; tooltip explains the behaviour. The "Paused: paused by you" line shows while stopped.
