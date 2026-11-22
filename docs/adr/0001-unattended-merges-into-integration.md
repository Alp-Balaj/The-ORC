# ADR 0001: Finished work merges into the integration branch without a human

- **Status:** accepted
- **Date:** 2026-11-22
- **Decided by:** the owner

## Context

Kickoff §10 said "no cross-checkpoint autonomy": no agent's work should move on without a human
looking at it. The ORC's gating modes (plan § Gating, D3) break that rule:

- **Plan check:** once you approve the split, each finished team merges into
  `integration/<mission>` on its own.
- **No check:** teams merge on their own, and there is no split to approve either.

On 2026-11-20 the owner made **No check** the default in the New mission form, because the aim is
fast, continuous delivery. The plan said accepting this needed an ADR. This is that ADR.

## Decision

We accept that work merges into the integration branch with no human review. **No check is the
default**, both in the New mission form and when a mission is started without a gating mode
(`startMission` used to fall back to plan check).

**Merge to main is the one human checkpoint.** Before it, the integration branch is a staging area
that can be thrown away. Nothing reaches `main` except through the owner's click, after:

- **the combined diff** of the whole mission, shown on the Merge to main screen;
- **the gate**, if the space has a gate command, run on every merged result;
- **the Verifier report.** It now runs on its own once every team is finished and merged (see
  below), so it's always on the screen without anyone having to remember it.

Checkpointed and Plan check stay available for missions where you want to look sooner.

## The Verifier runs on its own

`Missions.maybeAutoVerify` (`src/main/missions.ts`) starts the Verifier only when all of these
hold:

- every worker is done or exited;
- every worker's work is merged, or it had nothing to merge (a stopped worker that never
  committed counts as finished);
- the mission is running and not paused;
- the integration commit has no report yet.

It runs once per integration commit. If work is merged after a report, the report is marked as
being about an older commit, and the Verifier runs again once the new work has settled. Each run is
billed (one `claude -p` per run). The Verifier button still works, and while a run is already
going it waits for that run instead of starting a second one.

## Consequences

- A bad team can put broken work on the integration branch with nobody looking. The cost is
  bounded: it stays off `main`, Run app shows it, and the Verifier and gate flag it before the
  merge.
- The Verifier reads untrusted diffs. Prompt injection into it ([[BF-10 - Prompt injection paths
  into the judges]]) matters more now that it is the only automatic review. The diff is still
  fenced off as untrusted data, and the Verifier stays read-only (`Read,Grep,Glob`, `dontAsk`).
- Teams merge in the order they finish, not in dependency order. The coordinator is told to give
  each lead an area that owns its own files, so the order rarely matters. A conflict goes back to the
  team that hit it.
