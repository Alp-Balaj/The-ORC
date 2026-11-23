# The ORC

A desktop app for running Claude Code missions: talk to one coordinator session per mission, watch it spawn worker sessions in their own git worktrees, and click into any of them.

Milestones M1–M4 work: spaces and missions, a coordinator you talk to, workers in their own worktrees, a live tree and feed, app-owned commits and an integration branch per mission, gating, a Verifier, Merge to main, and recovery after a restart. The plan is [`docs/PLAN.md`](docs/PLAN.md), and where the build stands is [`docs/HANDOFF.md`](docs/HANDOFF.md).

## Merging and pushing to GitHub

Only your click merges or pushes: agents never commit, merge or push.

**One-time setup**
1. Install the [`gh` CLI](https://cli.github.com).
2. In the Accounts screen, press **Connect GitHub**. The app shows a device code and opens the browser; the token stays in `gh`, never in The ORC.
3. Make sure the repo has a remote: `git remote add origin <url>`.

**Per mission**
1. When the mission finishes, press **Integrate**. That puts its work on the repo's ORC branch.
2. Press **Merge to main** in the header. It opens the "Merge the ORC branch into main" screen; press **Merge to main** there.
3. Press **Push to GitHub**, the last item in the right-hand panel (scroll the panel if the window is short). It is greyed out without a remote. It runs `git push -u <remote> <main>` and is never forced.

**If the Push button is missing**, the running app is an old build. Run `scripts/orc-app.sh update` and restart. Only one ORC can run on the app data, so quit any other, including `pnpm dev`.
