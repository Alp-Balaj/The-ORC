# Parallel backlog queue (lead: parallel-queue)

- New per-space setting `maxParallel` (1-10, default 2): `spaces.ts` (clamp, persisted), `SpaceView`, preload `SpacePatch`, Space settings form (`max-parallel` input), `QueueDeps.maxParallel` wired in `index.ts`.
- `queue.ts` `evaluate()` now judges every `running` item on its own: finished -> done, red flag -> that item `paused` (queue stops starting new items), mission removed -> paused. New items start while running count < maxParallel; after each start `evaluate` runs again to fill the next slot.
- Items start from the mission's default base branch. `stackOn()` is used only when maxParallel is 1 (old behaviour).
- Usage pause, resume acks (`start()` acks flags of all running/paused items) unchanged and queue-wide.
- Did not touch `missions.ts` / `mission-git.ts`; concurrent merges are the other lead's job. Only `pnpm typecheck` was run.
