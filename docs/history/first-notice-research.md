# What the user should notice first (research brief, 2026-11-22)

Mission `figure-out-what-the-users-should-not`, lead `first-notice`. Research only: no code in `src/` changed.
Sources: the current source (`App.tsx`, `AgentCard.tsx`, `Sidebar.tsx`, `Feed.tsx`, `MissionScreens.tsx`, `app.css`), `docs/HANDOFF.md`, history records (mobbin-ui, the-node-tree, ux-friendliness, accent colors) and Mobbin. The hidden replay was **not** run; everything below comes from reading source and Mobbin screens.

## What earlier missions already did (not redone)

- mobbin-ui: status-coloured cards, the amber "needs you" family (`bg-needs`, left bar, glow dot), red-tinted feed rows for failures, tree nodes with a 3px status bar.
- the-node-tree: stacked/folded tree for >3 live agents.
- accent colours: user-chosen `--color-primary` (7 accents, indigo default). Status colours (`working` green, `needs` amber, `done` blue, `destructive` red) are separate and fixed.
- Sidebar mission row already shows an amber count pill when agents need you.

So **status vocabulary is good**. The gap is *where* it appears and *how loud*, not the palette.

## Core finding

The ORC has one rule for a human-in-the-loop tool: **the user's next required action must be the brightest thing on screen; everything else is calm.** Today the loudest static element is always the same: the header (14+ controls) and the filled primary "Merge to main" button, which is lit even when there is nothing to merge, and the terminal, which is big but undifferentiated. "Needs you" signals exist but are small (a 10px pill, a 2px bar, a header badge using the same variant as "paused") and live in three separate places (sidebar, header, right-side cards/feed). Nothing travels with the user when they are looking at a *different* mission or at the terminal.

## Per state: first thing, what competes, change

### 1. First launch / no mission
- **Notice first:** one primary action, "Add a repository / start a mission".
- **Competes:** `App.tsx:520-534` shows the 3 steps as a passive numbered list (no button). Meanwhile the header shows "No mission open", the theme and accent pickers and the shortcut button; the right panel shows a grey "A node appears whenever…" line and an empty Feed. The only action lives in the sidebar, 300px away.
- **Change (low effort, high impact):** make step 1/2 a real filled primary button in the empty state ("Add repository", then "Start mission") that triggers the same Sidebar forms (the `emitShortcut('newMission'/'spaceSettings')` path exists). Show the step list as a checklist with the current step highlighted and done steps struck/checked, like Graphite/Devin. Hide or dim the right tree/feed panel until a mission exists (collapse to ~0 or a one-line placeholder) so the centre owns the eye. Files: `App.tsx` (empty branch), small `EmptyState` component.
- Mobbin: [Devin first-run checklist with one input](https://mobbin.com/screens/f331a9f7-d2be-4082-9c8a-e584d43df6a8), [Graphite stepwise checklist, current step boxed, rest dimmed](https://mobbin.com/screens/1505178e-213c-48aa-b5bf-9a46a9c91684), [Adaline quest list with current step tinted](https://mobbin.com/screens/8ad4a415-bff7-4350-91af-75519784b729), [Stripe ticked steps each with one button](https://mobbin.com/screens/92c629f3-bf5a-49a0-9a6a-4cb187cb1b52).

### 2. Mission running, nobody needs you
- **Notice first:** "it's working, and how far along": the live terminal with the coordinator and a single progress glance (X of N leads done, which are working).
- **Competes:** the header repeats config nobody changes mid-run (permission mode, model string, gating, token count) at the same weight as the title; "Merge to main" is a disabled but full-fill primary; Pause/Stop/Run app/theme/accent/keyboard all sit at equal visual weight; the tree and feed share equal height with the terminal's neighbours.
- **Change (medium effort, high impact):** (a) in the header demote the config strip into one muted "settings" tooltip/popover chip; keep title + a progress summary ("3 working · 1 done") as the only mid-weight text. (b) Make "Merge to main" `variant="outline"` until `canMerge` and the Verifier/gate are ready, then promote to primary (see state 5). (c) Move theme/accent/shortcuts into a single overflow/settings menu. (d) Keep the green working dot pulse (already `animate-orc-pulse`) as the only motion in this state. Files: `App.tsx` header (lines ~338-473), `AccentPicker`/`ThemeToggle` placement.
- Mobbin: [Replit, chat/log left with a quiet "waiting for design subagent" line and big status empty-preview](https://mobbin.com/screens/20a3ac62-d3ef-4bd1-9feb-235af79faa5c), [Laravel Cloud deploy, one spinner row per phase, Cancel is the only button](https://mobbin.com/screens/f9a999ee-f498-4a02-b17f-be383d866950), [Cursor agents list with Draft/Branch/Merged chips](https://mobbin.com/screens/ef7c23a0-61cc-4d41-8988-7c3d84610f2f).

### 3. A lead is waiting for the human (needs you: question, plan check, diff review, permission)
- **Notice first:** "Something is waiting for you", and one click to land on it.
- **Competes:** the signal is fragmented and small. Sidebar pill 10px (`Sidebar.tsx:315`); header badge `"N need you"` (`App.tsx:388`) is the same amber `needs-you` badge as `paused` and it is not clickable; the card (`AgentCard.tsx`) is only tinted in the side panel and only for the *current* mission; the plan-check `SplitPanel` is a full-width amber band but only appears above the terminal of the open mission, and nothing moves the focus. If you are viewing another mission or are deep in the terminal, you see nothing but a 10px pill.
- **Change (best ratio of all):**
  1. Make the header "N need you" chip a **button**: click or a new shortcut jumps to the first `needs-you` agent/review (`selectAgent` / `setView({review})`), pulse the ring once on state change (`animate-orc-pulse` is already defined). Lift it to the left of the title so it is the first chip read after the name; extend it to *all* missions ("2 need you · 1 in other mission").
  2. Put the waiting question text in the sidebar row on hover/expanded and make the pill ≥ 11px with the existing glow.
  3. Window title / dock badge / OS notification when something becomes `needs-you` while the window is not focused (`document.title = "(2) The ORC"`, Electron `Notification`; nothing exists today, grep found no notifications).
  4. In the terminal strip (`terminal-head`, `App.tsx:512`), when the agent has `a.question`, show it as a one-line amber banner above the terminal so the user sees *what* is asked without looking right.
  5. Keep `SplitPanel` as is: it is already the right pattern; add a count to the sidebar when a split is pending (verify it counts today).
- Mobbin: [Relevance AI "To review 4" tab and amber Pending approval pills](https://mobbin.com/screens/63d33c52-d5a2-46c1-8441-a87a381ea758), [Cofounder floating "2 agent updates · Review" chip bottom-left](https://mobbin.com/screens/2e10afc9-7866-492f-9e43-2813af44235f), [AirOps Decline all / Accept all bulk review](https://mobbin.com/screens/88aed5b3-f244-49e5-94c6-a8b8df2790be), [Wix "Ready for approval" panel plus amber required-action cards](https://mobbin.com/screens/3d65e1ae-6d3f-417f-a242-265a64072cd8), [Wrike inbox red count badge](https://mobbin.com/screens/a2b51485-af81-4c80-8f06-b357e0fe5bda), [n8n question card pinned over the chat with Skip/Next](https://mobbin.com/screens/a76feec1-a5e0-4f57-8efa-1f7ddcdc2180).

### 4. Error / crash / conflict / stopped
- **Notice first:** "what broke, in which agent, and the one button to recover" (Restart, Open conflict, Retry).
- **Competes:** failures are *red-tinted rows in the Feed* (`Feed.tsx` tone `attention`) at the bottom of the right column; merge conflicts show as a small red line inside a card; a stopped/crashed agent is dimmed (`opacity-70`, transparent card) which actively hides it; a stopped mission shows a grey `exited` badge in the header plus a strike-through name in the sidebar. `actionError` toast is bottom-centre, 12px, away from where the user is looking. Because `done` and `exited` share the same recede treatment, "died unexpectedly" looks the same as "finished and cleaned up".
- **Change (medium effort, high impact):**
  1. Split `exited` into two looks: clean exit (receded, as now) vs crash/unexpected (card keeps the `destructive` left bar, label "crashed", not dimmed). Needs a flag from main (`exitedUnexpectedly`/exit code) in `AgentView`; check `src/main` for what is known.
  2. Failure banner under the header (full width, `border-destructive/40 bg-destructive/5`, icon + one-line cause + primary recovery button) for the open mission when any agent crashed, a merge conflicts, or the gate failed, like Vercel/AWS. Gate-failed currently exists only inside MergeScreen.
  3. Move `actionError` to top, under the header, same banner component.
  4. Sidebar: red dot beside the amber pill when a mission has a conflict/crash (state priority: error > needs > working).
- Mobbin: [Vercel build failed: bordered red "Build Failed" box above logs, Redeploy button](https://mobbin.com/screens/ff81f1e9-25b1-46f9-8448-31fa40a77e4b), [Railway red banner plus a purple "Fix start command" action right under the error](https://mobbin.com/screens/a772bb45-e352-4362-bcb6-48ba146bd3e9), [AWS full-width red banner with Diagnose button](https://mobbin.com/screens/4003c814-1ffa-45f4-ac66-fbb543217963), [Databricks failed pipeline, empty state with "View details"](https://mobbin.com/screens/9c966582-c3cd-4129-ac8d-af9c70a1a62e), [Render error under the config with Retry](https://mobbin.com/screens/513c655c-8cb3-406b-a45b-a3a978a0b504), [Slack Lists red "Blocked" column](https://mobbin.com/screens/50a69d82-266a-4785-8cfe-7bc829b1c3b2).

### 5. Mission done / ready to merge
- **Notice first:** "It's finished: review and merge", the Merge button becomes THE primary action, with the verdict next to it.
- **Competes:** there is no "done" moment at all. `MissionView.state` is only `running | stopped`; workers go `done` (blue, receded). The header Merge button has the same fill before and after; the Verifier verdict and gate result live inside the MergeScreen, one click away; the Feed shows a calm "milestone" row. In MergeScreen, the Gate and Verifier panels sit above the Merge card, and the merge card has only a `border-ring/40` highlight.
- **Change (medium effort, medium-high impact):**
  1. Derive a `ready` flag on the client (all leads done/merged, `merged.length > 0`, no pending review) and render a one-time success band under the header: "All leads are done. Gate passed · Verifier PASS" with `Review & merge` as the single filled button (using the **accent** primary, here the only filled button), and a green check. Demote the header Merge to outline until then.
  2. Sidebar: show a `done` blue/green check instead of a dot when a mission is ready.
  3. MergeScreen: put the verdict summary (3 check rows) and the Merge button at the top of the right column (or sticky bottom bar); the long reports stay below.
  4. After `mergedToMain`, replace the diff with a success state (green check, commit hash, "Merged to main", Remove mission / New mission).
- Mobbin: [Cursor "Setup is done" with next-step cards](https://mobbin.com/screens/b0623233-c114-4011-ae72-66f7530d950a), [Wix "You're all caught up" empty state](https://mobbin.com/screens/3d65e1ae-6d3f-417f-a242-265a64072cd8), [Codecademy 7/7 done column](https://mobbin.com/screens/bb0fd38c-13f3-4b7c-af63-46fbce6066d4), [Stripe all steps ticked, one Continue link](https://mobbin.com/screens/92c629f3-bf5a-49a0-9a6a-4cb187cb1b52).

## Cross-cutting rules (one design system, no new tokens)

1. One attention ladder, used everywhere: **error (red, persistent, banner) > needs you (amber, count + pulse once) > ready (accent fill, one button) > working (green, slow pulse) > done/idle (muted)**. Only one thing at a time is filled.
2. Status colours stay separate from the accent. The accent picker must never recolour attention states; keep `needs` and `destructive` fixed. Primary = "your next action", so it should appear on at most one button per screen.
3. Motion budget: one pulse for working, one 1-shot ring pulse on a new needs-you; nothing else animates (respect `prefers-reduced-motion`).
4. Cross-mission awareness: attention state shows in the sidebar, the window title and (new) OS notifications, not only for the open mission.
5. Config is background: permission mode, models, gating, tokens and theme/accent go in a quiet settings area; the header keeps name, attention chip, primary action.

## Ranked recommendations

| # | Change | Impact | Effort |
|---|--------|--------|--------|
| 1 | Header "N need you" chip becomes a clickable jump (to agent/review), placed next to the mission name; count across all missions | Very high | Low (App.tsx, ~30 lines) |
| 2 | Window title count and OS notification when a lead becomes `needs-you` while unfocused | Very high | Low-medium (renderer effect + Electron `Notification` in main, new IPC) |
| 3 | Merge-to-main is outline until ready; "ready to merge" band with gate/Verifier verdict, then primary | High | Medium (derive `ready`, App.tsx header + band) |
| 4 | Empty state with real primary buttons and a highlighted current step; collapse right panel before the first mission | High (first impression) | Low |
| 5 | Question text banner above the terminal when `agent.question` is set | High | Low |
| 6 | Crash vs clean-exit distinction; stop dimming crashed agents; failure banner under the header (conflict, gate failed, crash) | High | Medium (needs a field from main + banner component) |
| 7 | De-emphasise header config (mode/model/gating/theme/accent into one settings menu) | Medium | Low-medium |
| 8 | Sidebar priority marker (error > needs > ready > working), bigger pill | Medium | Low |
| 9 | MergeScreen: verdict + button at the top/sticky, success state after merge | Medium | Medium |
| 10 | Move `actionError` toast to a banner under the header | Low-medium | Low |

Suggested first batch: 1, 4, 5, 3 (all renderer-only, mostly `App.tsx` and `AgentCard.tsx`), then 2 and 6 which touch `src/main`.

## How far the current UI is from this

Roughly **60% there on vocabulary, 30% on hierarchy**. The status colours, card treatments, feed tones and plan-check band are correct and consistent. The distance is in four places: (a) the header is flat, so no single control is primary except an always-on Merge; (b) attention signals are small, local to the open mission, and not clickable; (c) there is no "done/ready" or "crashed" moment, so those states look like the receded/stopped ones; (d) the empty state is informative but offers no action. Not verified: live rendering (replay not run), whether a split-pending state is counted in the sidebar pill, and what main knows about unexpected exits.
