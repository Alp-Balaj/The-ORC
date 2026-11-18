# Decisions pending — for the owner

Cases where the plan as written may be wrong, or needs an ADR. The build follows the plan as
written until you decide.

## 1. Plan check lets work merge into the integration branch without a human (needs the ADR)

The plan (§ Gating) says approving it triggers an ADR, because "plan check" (the default) lets
finished workers merge into `integration/<mission>` with no human look. That overturns kickoff §10
("no cross-checkpoint autonomy").

**Built as written:** plan check is the default. `main` still changes only on your click, behind
the Verifier report and the combined diff.

**To decide:** accept this in an ADR, or make Checkpointed the default.

## 2. How approvals and conflicts reach an idle coordinator

`propose_split` returns "pending" at once (as planned). Your approval then has to reach the
coordinator. Claude Code has no CLI for sending a session a message from outside. Hook
`additionalContext` only arrives on the session's *next* hook, and an idle coordinator has none.

**Built:**
- If the coordinator is idle, The ORC types the notice into its terminal as a prompt beginning
  `[The ORC]`.
- If the coordinator is busy, the notice rides on its next hook.

**To decide:** whether typing into the coordinator's terminal is acceptable. It shows in the
transcript as if you typed it, but tagged `[The ORC]`.

## 3. The gate command lives in app state, per space

The plan says "run the repo's build/test gate on the merged result" but not where that command
comes from.

**Built:** a per-space setting, saved in the app's `spaces.json`. Nothing is written into your
repository. With no gate command set, the gate shows "not configured" and doesn't block the merge.

## 4. Where the build differs from the plan's wording (small)

- **The Verifier runs when you press its button** on the Merge to main screen, not automatically
  before the button appears. It is billed, and a stale report is marked as such. Making it
  automatic is a one-line change.
- **Conflicts go to the worker that conflicted:** the markers are left in its worktree, and its
  coordinator is told. The plan says "a ◐ question to the coordinator, or to you". The card shows
  the conflict in red, but the agent doesn't turn ◐.
- **Workers merge into the integration branch in the order they report done**, not in dependency
  order. The ORC has no dependency information between workers yet.
- **The vault (D4) is not built.** It is still "suggested, awaiting owner", and your real vault is
  off-limits overnight.
