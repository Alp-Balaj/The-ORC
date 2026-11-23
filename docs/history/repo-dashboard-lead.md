# Repo dashboard (lead notes)

**What:** clicking a repo (space) row in the sidebar shows that repo's dashboard in the main area,
in place of the terminal. The chevron on the row still expands and collapses it.

**How:**
- `App.tsx` holds `dashRoot` (the repo shown). `selectRepo(root)` sets it, clears `mainRoot`, and
  switches to the terminal view. Every user selection that picks a mission, agent or main session
  (`selectMission`, `selectAgent`, `selectMain`, notify-select) clears `dashRoot`.
- While `dashRoot` is set, the main area renders `RepoDashboard` first. The header shows the repo
  name, and the mission header controls, ready band, failure banner, split panel and tree/feed
  are hidden or idle. `setSelection` sends `(null, null)`. The main session is not started.
- `currentRoot` prefers `dashRoot`.
- `components/Sidebar.tsx`: the repo row has a chevron button (toggle, stops propagation) and a name
  button (selects the repo and expands it if collapsed). The selected row gets `bg-selected` and
  `aria-current`.
- `components/RepoDashboard.tsx` is read-only except for opening things. Sections: header (path,
  main and ORC branch chips, gate command), stat strip, missions, main session, backlog, recent
  activity. It loads the queue with `listQueues` and `onQueues`, filtered to the repo.

**Not done:** plan usage in the dashboard, autopilot state, and an `onOpenAgent` hook.
