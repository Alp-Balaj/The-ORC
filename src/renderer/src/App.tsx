import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CircleCheck, GitMerge, MessagesSquare, MonitorPlay, PanelLeft, Pause, Play, RotateCcw, Square, TerminalSquare, X } from 'lucide-react'
import { isMainSessionTerminal, missionFailure, shownAgents, type AgentView, type AppRunView, type MainSessionView, type MissionView, type SpaceView } from '../../shared/types'
import { CommandPalette } from './components/CommandPalette'
import { Banner } from './components/Banner'
import { EmptyState } from './components/EmptyState'
import { Feed } from './components/Feed'
import { MergedScreen, MergeScreen, OrcMergeScreen, ReviewScreen, SplitPanel } from './components/MissionScreens'
import { MissionTree } from './components/MissionTree'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { AccountsScreen } from './components/AccountsScreen'
import { Sidebar } from './components/Sidebar'
import { RepoDashboard } from './components/RepoDashboard'
import { PlanUsageHeader } from './components/PlanUsageHeader'
import { HeaderSettingsMenu } from './components/HeaderSettingsMenu'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { ButtonGroup } from './components/ui/button-group'
import { focusActiveTerminal, TerminalView } from './TerminalView'
import { getMissionSort, sortMissions } from './lib/missionSort'
import { emitShortcut,installGlobalShortcuts, onShortcut, withHint, type ShortcutId } from './lib/shortcuts'
import { getThemePref, setThemePref } from './lib/theme'
import { cn } from './lib/utils'
import { markReadyBandSeen, missionReady, readyBandSeen, readyChecks } from './lib/ready'


/** Pushes arrive as fresh objects every time. Keep each mission whose content is unchanged as the
 *  same object (and the list as the same array when nothing changed), so memoized children skip
 *  re-rendering for pushes that only touched other missions. */
function sameMissions(prev: MissionView[], next: MissionView[]): MissionView[] {
  const before = new Map(prev.map((m) => [m.id, m]))
  const out = next.map((m) => {
    const old = before.get(m.id)
    return old && JSON.stringify(old) === JSON.stringify(m) ? old : m
  })
  const changed = out.length !== prev.length || out.some((m, i) => m !== prev[i])
  return changed ? out : prev
}

// The tree/feed column: draggable from its left edge, kept between 300px and 45% of the window.
const SideDefault = 420
const SideKey = 'orc.sideWidth'
const clampSide = (w: number): number => Math.round(Math.max(300, Math.min(w, window.innerWidth * 0.45)))
function useSideWidth(): { width: number; handle: React.JSX.Element } {
  const [width, setWidth] = useState(() => {
    let w = SideDefault
    try { w = Number(localStorage.getItem(SideKey)) || SideDefault } catch { /* storage unavailable */ }
    return clampSide(w)
  })
  const drag = useRef<{ x: number; w: number } | null>(null)
  const [active, setActive] = useState(false)
  const save = (w: number): void => {
    try { localStorage.setItem(SideKey, String(w)) } catch { /* storage unavailable */ }
  }
  useEffect(() => {
    const onResize = (): void => setWidth((w) => clampSide(w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const handle = (
    <div
      className={cn('absolute inset-y-0 -left-0.75 z-20 w-1.5 cursor-col-resize transition-colors hover:bg-primary/40', active && 'bg-primary/60')}
      data-testid="side-resize"
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize. Double-click to reset."
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, w: width }
        setActive(true)
      }}
      onPointerMove={(e) => {
        if (drag.current) setWidth(clampSide(drag.current.w + drag.current.x - e.clientX))
      }}
      onPointerUp={(e) => {
        if (!drag.current) return
        drag.current = null
        setActive(false)
        e.currentTarget.releasePointerCapture(e.pointerId)
        save(width)
      }}
      onPointerCancel={() => { drag.current = null; setActive(false) }}
      onDoubleClick={() => { const w = clampSide(SideDefault); setWidth(w); save(w) }}
    />
  )
  return { width, handle }
}

export function App(): React.JSX.Element {
  const [spaces, setSpaces] = useState<SpaceView[]>([])
  const [missions, setMissions] = useState<MissionView[]>([])
  const [missionId, setMissionId] = useState<string | null>(null)
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [showMessages, setShowMessages] = useState(true)
  const [view, setView] = useState<'terminal' | 'merge' | 'main-merge' | 'app' | { review: string }>('terminal')
  // The app being built, running from one mission's integration branch (one at a time).
  const [appRun, setAppRun] = useState<AppRunView | null>(null)
  const [appBusy, setAppBusy] = useState(false)
  const [, tick] = useState(0)
  // A failed action (IPC rejected) shows here instead of disappearing into the console.
  const [actionError, setActionError] = useState<string | null>(null)
  // "Merged into main; cleared N missions": shown after the open mission was cleared out.
  // After Merge to main: stays on a result screen with Push to GitHub until dismissed (or the selection moves).
  const [merged, setMerged] = useState<{ repo: string; branch: string; message: string; sel: string | null } | null>(null)
  const [mergeNotice, setMergeNotice] = useState<string | null>(null)
  // Missions The ORC brought back on its own at launch (each one is live, billed sessions).
  const [resumed, setResumed] = useState<{ id: string; name: string }[]>([])
  const [appRestore, setAppRestore] = useState<{ missionId: string; missionName: string } | null>(null)
  const [appRestoreBusy, setAppRestoreBusy] = useState(false)
  const [appRestoreError, setAppRestoreError] = useState<string | null>(null)
  // Each space has its own main session (above that repo's missions). Selecting one shows its terminal in place of a mission.
  const [mains, setMains] = useState<Record<string, MainSessionView>>({})
  const [mainRoot, setMainRoot] = useState<string | null>(null)
  // A repo's dashboard (its missions, backlog, activity) shown in place of the terminal.
  const [dashRoot, setDashRoot] = useState<string | null>(null)
  const main = mainRoot ? mains[mainRoot] ?? null : null
  const mainSelected = mainRoot !== null
  const mainTid = main?.terminalId ?? ''
  // Keyboard: the quick switcher or the cheat sheet (one at a time), and whether the sidebar shows.
  const [dialog, setDialog] = useState<'palette' | 'shortcuts' | 'accounts' | null>(null)
  const dialogFromTerminal = useRef(false)
  const jumpRef = useRef<() => void>(() => {})
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem('orc-sidebar') !== 'closed'
    } catch {
      return true
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('orc-sidebar', sidebarOpen ? 'open' : 'closed')
    } catch {
      // storage unavailable
    }
  }, [sidebarOpen])
  useEffect(() => {
    const onReject = (e: PromiseRejectionEvent): void => {
      e.preventDefault() // shown in the banner: handled, not an uncaught error
      setActionError(String(e.reason?.message ?? e.reason).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
    window.addEventListener('unhandledrejection', onReject)
    return () => window.removeEventListener('unhandledrejection', onReject)
  }, [])

  useEffect(() => {
    void window.orc.listMissions().then(setMissions)
    void window.orc.listSpaces().then(setSpaces)
    void window.orc.currentApp().then(setAppRun)
    void window.orc.resumedAtLaunch().then(setResumed)
    void window.orc.pendingAppRestore().then(setAppRestore)
    const offA = window.orc.onApp(setAppRun)
    const offM = window.orc.onMissions((next) => setMissions((prev) => sameMissions(prev, next)))
    const offS = window.orc.onSpaces(setSpaces)
    const offN = window.orc.onNotifySelect((_m, tid) => {
      setView('terminal')
      setDashRoot(null)
      if (isMainSessionTerminal(tid)) {
        setMains((cur) => {
          const hit = Object.values(cur).find((v) => v.terminalId === tid)
          if (hit) setMainRoot(hit.repoPath)
          return cur
        })
        return
      }
      setMainRoot(null)
      setTerminalId(tid)
      setMissionId(tid.split(':')[0])
    })
    const offMain = window.orc.onMainSession((v) => setMains((cur) => ({ ...cur, [v.repoPath]: v })))
    return () => {
      offM()
      offS()
      offN()
      offA()
      offMain()
    }
  }, [])

  // Every space's main session view, for the sidebar rows.
  useEffect(() => {
    for (const sp of spaces) {
      void window.orc.mainSession(sp.root).then((v) => setMains((cur) => (cur[v.repoPath] ? cur : { ...cur, [v.repoPath]: v })))
    }
  }, [spaces])

  // Re-renders every 10s so "x ago" labels stay current. Hidden windows need no refresh: the
  // clock stops with the window and catches up as soon as it is shown again.
  useEffect(() => {
    let timer: number | undefined
    const sync = (): void => {
      if (document.hidden) {
        window.clearInterval(timer)
        timer = undefined
        return
      }
      tick((n) => n + 1)
      timer ??= window.setInterval(() => tick((n) => n + 1), 10_000)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.clearInterval(timer)
    }
  }, [])

  const mission = useMemo(
    () => missions.find((m) => m.id === missionId) ?? missions[missions.length - 1] ?? null,
    [missions, missionId]
  )
  // A removed (exited) worker's terminal falls back to the coordinator's.
  const shown = useMemo(() => (mission ? shownAgents(mission) : []), [mission])
  // The main session's graph: it at the top, every mission's coordinator under it (live: missions push).
  const mainGraph = useMemo<AgentView[]>(() => {
    const blank: Pick<AgentView, 'lastInstructionBy' | 'lastInstructionAt' | 'task' | 'question' | 'doneSummary' | 'tokens' | 'contextTokens' | 'merge' | 'conflictFiles' | 'branch' | 'cwd'> = { lastInstructionBy: null, lastInstructionAt: null, task: '', question: null, doneSummary: null, tokens: 0, contextTokens: 0, merge: null, conflictFiles: [], branch: null, cwd: '' }
    const root: AgentView = { ...blank, name: 'main', sessionName: main?.sessionName ?? 'orc-main', role: 'coordinator', parent: null, status: !main || main.status === 'off' ? 'exited' : main.status, activity: main?.activity ?? '', sessionId: '', terminalId: mainTid, startedAt: 0 }
    const coords = missions.filter((m) => m.repoPath === mainRoot).flatMap((m) => m.agents.filter((a) => a.role === 'coordinator').map((a) => ({ ...a, name: a.sessionName, parent: 'main' })))
    return [root, ...coords]
  }, [missions, main, mainRoot, mainTid])
  const agent = shown.find((a) => a.terminalId === terminalId) ?? shown.find((a) => a.role === 'coordinator') ?? null

  useEffect(() => {
    if (dashRoot) window.orc.setSelection(null, null)
    else window.orc.setSelection(mainSelected ? null : mission?.id ?? null, mainSelected ? mainTid : agent?.terminalId ?? null)
  }, [dashRoot, mainSelected, mainTid, mission?.id, agent?.terminalId])

  // Stable (they only call setters), so the memoized tree skips renders on unrelated updates.
  const selectMission = useCallback((id: string): void => {
    setDashRoot(null)
    setMainRoot(null)
    setView('terminal')
    setMissionId(id)
    setTerminalId(`${id}:coordinator`)
  }, [])
  const selectAgent = useCallback((tid: string): void => {
    setDashRoot(null)
    setMainRoot(null)
    setView('terminal')
    setTerminalId(tid)
    setMissionId(tid.split(':')[0])
  }, [])
  // Starting it on first select: a session nobody has started yet opens straight into a live terminal.
  const selectMain = (root: string): void => {
    setDashRoot(null)
    setMainRoot(root)
    setView('terminal')
    const v = mains[root]
    if (!v || v.status === 'off') void window.orc.startMainSession(root)
  }
  // The repo dashboard: no terminal, and it never starts the main session.
  const selectRepo = useCallback((root: string): void => {
    setDashRoot(root)
    setMainRoot(null)
    setView('terminal')
  }, [])
  const mainRunning = !!main && main.status !== 'off' && main.status !== 'exited'
  const space = mission ? spaces.find((s) => s.root === mission.repoPath) : undefined
  const missionApp = appRun && mission && appRun.missionId === mission.id ? appRun : null
  const runApp = (): void => {
    if (!mission) return
    setAppBusy(true)
    void window.orc.runApp(mission.id).then(() => setView('app')).finally(() => setAppBusy(false))
  }
  const stopApp = (): void => {
    setAppBusy(true)
    void window.orc.stopApp().finally(() => setAppBusy(false))
  }
  const runTitle = !space?.runCommand
    ? 'Set a run command for this space first (the gear next to the space)'
    : appRun?.status === 'running' && appRun.missionId !== mission?.id
      ? `Stops ${appRun.missionName}'s app, then runs "${space.runCommand}" from this mission's integration branch`
      : `Runs "${space.runCommand}" from this mission's integration branch`
  const ready = !!mission && missionReady(mission)
  // One-time band: shown while ready, until dismissed or the merge view has been opened.
  const [bandGone, setBandGone] = useState<Set<string>>(new Set())
  const showBand = !!mission && ready && view !== 'merge' && !bandGone.has(mission.id) && !readyBandSeen(mission.id)
  const dismissBand = (id: string): void => {
    markReadyBandSeen(id)
    setBandGone((s) => new Set(s).add(id))
  }
  useEffect(() => {
    if (mission && view === 'merge') markReadyBandSeen(mission.id)
  }, [mission?.id, view])
  const canMerge = !!mission && (mission.merged.length > 0 || !!mission.mergedToMain)
  const isOnOrc = (m: MissionView): boolean => !m.mergedToMain && !!m.integrated && m.integrated.integrationCommit === m.integrationCommit
  // Missions in this repo whose work is on the ORC branch, waiting for Merge to main.
  const onOrc = mission ? missions.filter((m) => m.repoPath === mission.repoPath && isOnOrc(m)).length : 0
  const roots = [...spaces.map((s) => s.root), ...missions.map((m) => m.repoPath)].filter((r, i, a) => a.indexOf(r) === i)
  // A repo disconnected while its dashboard or main session was open: fall back to the next repo (or the empty state).
  useEffect(() => {
    if (dashRoot && !roots.includes(dashRoot)) setDashRoot(null)
    if (mainRoot && !roots.includes(mainRoot)) setMainRoot(null)
  })
  const currentRoot = dashRoot ?? mainRoot ?? mission?.repoPath ?? roots[0] ?? null
  // Nothing mission-specific is on screen while the dashboard is open (its tree, feed and header are idle).
  const asideIdle = !mainSelected && (!mission || dashRoot !== null)

  const openDialog = (d: 'palette' | 'shortcuts' | 'accounts'): void => {
    if (dialog === d) return closeDialog()
    if (!dialog) dialogFromTerminal.current = !!document.activeElement?.closest('.xterm')
    setDialog(d)
  }
  const closeDialog = (): void => {
    setDialog(null)
    if (dialogFromTerminal.current) focusActiveTerminal()
    dialogFromTerminal.current = false
  }

  // Shortcut handlers read this render's state through a ref, so they never see stale state.
  const onKey = (id: ShortcutId, arg?: number): void => {
    switch (id) {
      case 'nextMission':
      case 'prevMission':
      case 'missionN': {
        // Same order as the sidebar (it sorts each space by the saved sort), so next = down the list.
        const sort = getMissionSort()
        const ordered = roots.flatMap((root) => sortMissions(missions.filter((m) => m.repoPath === root), sort))
        if (ordered.length === 0) return
        const cur = mission ? ordered.findIndex((m) => m.id === mission.id) : -1
        let i: number
        if (id === 'missionN') {
          i = arg === 9 ? ordered.length - 1 : (arg ?? 1) - 1
          if (i >= ordered.length) return
        } else {
          const step = id === 'nextMission' ? 1 : -1
          i = cur < 0 ? 0 : (cur + step + ordered.length) % ordered.length
        }
        selectMission(ordered[i].id)
        focusActiveTerminal()
        return
      }
      case 'nextAgent':
      case 'prevAgent': {
        if (shown.length === 0) return
        const cur = agent ? shown.findIndex((a) => a.terminalId === agent.terminalId) : -1
        const step = id === 'nextAgent' ? 1 : -1
        const i = cur < 0 ? 0 : (cur + step + shown.length) % shown.length
        selectAgent(shown[i].terminalId)
        focusActiveTerminal()
        return
      }
      case 'coordinator':
        if (!mission) return
        selectAgent(`${mission.id}:coordinator`)
        focusActiveTerminal()
        return
      case 'jumpNeedsYou':
        jumpRef.current()
        return
      case 'focusTerminal':
        setView('terminal')
        focusActiveTerminal()
        return
      case 'palette':
      case 'shortcuts':
        openDialog(id)
        return
      case 'integrate':
        if (mission && (mission.merged.length > 0 || !!mission.mergedToMain)) setView('merge')
        return
      case 'mergeScreen':
        if (mission) setView('main-merge')
        return
      case 'toggleSidebar':
        setSidebarOpen((v) => !v)
        return
      case 'toggleTheme': {
        const order = ['light', 'dark', 'system'] as const
        setThemePref(order[(order.indexOf(getThemePref()) + 1) % order.length])
        return
      }
      case 'newMission':
      case 'spaceSettings':
        // The Sidebar opens these forms itself; when it's hidden, show it and ask again once it's mounted.
        if (!sidebarOpen) {
          setSidebarOpen(true)
          setTimeout(() => emitShortcut(id), 50)
        }
        return
    }
  }
  const onKeyRef = useRef(onKey)
  onKeyRef.current = onKey
  useEffect(() => {
    if (merged && (merged.sel !== missionId || view !== 'main-merge')) setMerged(null)
  }, [merged, missionId, view])
  const escRef = useRef(() => {})
  escRef.current = () => {
    if (!dialog && view !== 'terminal') setView('terminal')
  }
  useEffect(() => {
    const offInstall = installGlobalShortcuts()
    const offSub = onShortcut((id, arg) => onKeyRef.current(id, arg))
    // Escape leaves the merge/review/app screens; never taken from a terminal or a field.
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const t = e.target instanceof Element ? e.target : null
      if (t?.closest('.xterm') || t?.closest('input, textarea, select')) return
      escRef.current()
    }
    window.addEventListener('keydown', onEsc)
    return () => {
      offInstall()
      offSub()
      window.removeEventListener('keydown', onEsc)
    }
  }, [])

  const side = useSideWidth()
  const failure = mission ? missionFailure(mission) : null
  const needsYou = mission?.agents.filter((a) => a.status === 'needs-you').length ?? 0
  // Needs-you agents across all missions, this mission's first: the header chip and its shortcut jump to the first.
  const needsList = missions
    .flatMap((m) => m.agents.filter((a) => a.status === 'needs-you').map((a) => ({ m, a })))
    .sort((x, y) => Number(y.m.id === mission?.id) - Number(x.m.id === mission?.id))
  const needsOther = needsList.length - needsYou
  const needsTotal = needsList.length
  useEffect(() => {
    document.title = needsTotal > 0 ? `(${needsTotal}) The ORC` : 'The ORC'
  }, [needsTotal])
  const working = shown.filter((a) => a.status === 'working' || a.status === 'starting').length
  const doneCount = shown.filter((a) => a.status === 'done' || a.merge === 'merged').length
  const warnAt = spaces.length > 0 ? Math.min(...spaces.map((s) => s.usageThreshold)) : 80
  const needsLabel = [
    needsYou > 0 && `${needsYou} need${needsYou === 1 ? 's' : ''} you`,
    needsOther > 0 && `${needsYou > 0 ? '' : needsOther + ' '}${needsYou > 0 ? needsOther + ' ' : ''}in other mission${needsOther === 1 ? '' : 's'}`
  ].filter(Boolean).join(' · ')
  const jumpNeedsYou = (): void => {
    const first = needsList[0]
    if (!first) return
    selectAgent(first.a.terminalId)
    if (first.a.merge === 'review') setView({ review: first.a.name })
    else focusActiveTerminal()
  }
  jumpRef.current = jumpNeedsYou
  const [ring, setRing] = useState(0)
  const prevNeeds = useRef<number | null>(null)
  useEffect(() => {
    if (prevNeeds.current !== null && needsTotal > prevNeeds.current) setRing((n) => n + 1)
    prevNeeds.current = needsTotal
  }, [needsTotal])

  return (
    <div className={cn('relative grid h-full', showBand && mission ? 'grid-rows-[44px_auto_minmax(0,1fr)]' : 'grid-rows-[44px_minmax(0,1fr)]')} style={{ gridTemplateColumns: `${sidebarOpen ? '300px ' : ''}minmax(0,1fr)${` ${side.width}px`}` }}>
      {mergeNotice && (
        <div className={cn('absolute left-1/2 z-50 flex max-w-xl -translate-x-1/2 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs shadow-lg', 'bottom-3')} data-testid="merge-notice" role="status">
          <span className="min-w-0 break-words">{mergeNotice}</span>
          <Button size="icon-sm" variant="ghost" className="shrink-0" onClick={() => setMergeNotice(null)} aria-label="Dismiss">
            <X />
          </Button>
        </div>
      )}
      {resumed.length > 0 && (
        <div className={cn('absolute left-1/2 z-50 flex max-w-xl -translate-x-1/2 items-center', 'bottom-3', 'gap-2 rounded-lg border bg-card px-3 py-2 text-xs shadow-lg')} data-testid="resumed-banner" role="status">
          <RotateCcw className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0">
            Resumed {resumed.length} mission{resumed.length === 1 ? '' : 's'} after restart: <span className="font-medium">{resumed.map((m) => m.name).join(', ')}</span>
          </span>
          <Button size="xs" variant="outline" className="shrink-0" data-testid="stop-resumed" title="Stop every mission listed here. Worktrees are kept, and Restart brings each one back." onClick={() => void window.orc.stopResumed().then(() => setResumed([]))}>
            <Square /> Stop all
          </Button>
          <Button size="icon-sm" variant="ghost" className="shrink-0" onClick={() => void window.orc.dismissResumed().then(() => setResumed([]))} aria-label="Dismiss" data-testid="dismiss-resumed">
            <X />
          </Button>
        </div>
      )}
      {appRestore && (
        <div className={cn('absolute left-1/2 z-50 flex max-w-xl -translate-x-1/2 items-center', ['bottom-3', 'bottom-16'][resumed.length > 0 ? 1 : 0], 'gap-2 rounded-lg border bg-card px-3 py-2 text-xs shadow-lg')} data-testid="app-restore-banner" role="status">
          <MonitorPlay className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="font-medium">{appRestore.missionName}</span>'s app was running before the restart
            {appRestoreError && <span className="block break-words text-destructive">{appRestoreError}</span>}
          </span>
          <Button
            size="xs"
            variant="outline"
            className="shrink-0"
            data-testid="start-app-restore"
            disabled={appRestoreBusy}
            onClick={() => {
              setAppRestoreBusy(true)
              setAppRestoreError(null)
              window.orc
                .startAppRestore()
                .then(() => setAppRestore(null))
                .catch((err: unknown) => setAppRestoreError(String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
                .finally(() => setAppRestoreBusy(false))
            }}
          >
            <MonitorPlay /> {appRestoreBusy ? 'Starting…' : 'Start again'}
          </Button>
          <Button size="icon-sm" variant="ghost" className="shrink-0" onClick={() => void window.orc.dismissAppRestore().then(() => setAppRestore(null))} aria-label="Dismiss" data-testid="dismiss-app-restore">
            <X />
          </Button>
        </div>
      )}
      {/* Header */}
      <header className={cn('accent-hairline flex min-w-0 items-center gap-3 border-b bg-background px-3', 'col-span-full')} data-testid="header">
        <div className="flex w-69 shrink-0 items-center gap-2">
          <div className="grid h-6 w-9 place-items-center rounded-md bg-primary/15 text-[10.5px] font-black tracking-tight text-primary">ORC</div>
          <span className="font-semibold tracking-tight">The ORC</span>
          <Button size="icon-sm" variant="ghost" className="ml-auto text-muted-foreground" title={withHint('Toggle sidebar', 'toggleSidebar')} aria-label="Toggle sidebar" aria-pressed={sidebarOpen} data-testid="toggle-sidebar" onClick={() => setSidebarOpen((v) => !v)}>
            <PanelLeft />
          </Button>
        </div>
        {dashRoot ? (
          <div className="flex min-w-0 items-center gap-1.5 text-[13px]" data-testid="header-dash">
            <span className="shrink-0 text-muted-foreground">Repo</span>
            <span className="shrink-0 text-faint">/</span>
            <span className="truncate font-semibold" title={dashRoot}>{dashRoot.split(/[\\/]/).pop()}</span>
          </div>
        ) : mainSelected ? (
          <>
            <div className="flex min-w-0 items-center gap-1.5 text-[13px]" data-testid="header-main">
              <span className="shrink-0 font-semibold">Main session</span>
              <span className="truncate text-muted-foreground">oversees {main?.repoName ?? 'this repo'}</span>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {mainRunning ? (
                <Button size="sm" variant="ghost-destructive" className="text-xs" data-testid="main-stop" title="End the main session. Start begins a new conversation." onClick={() => mainRoot && void window.orc.stopMainSession(mainRoot)}>
                  <Square /> Stop
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="text-xs" data-testid="main-start" onClick={() => mainRoot && void window.orc.startMainSession(mainRoot)}>
                  <Play /> Start
                </Button>
              )}
            </div>
          </>
        ) : mission ? (
          <>
            <div className="flex min-w-0 items-center gap-1.5 text-[13px]" data-testid="header-mission">
              <span className="shrink-0 text-muted-foreground">{mission.repoPath.split(/[\\/]/).pop()}</span>
              <span className="shrink-0 text-faint">/</span>
              <span className="truncate font-semibold">{mission.name}</span>
            </div>
            {mission.state === 'stopped' && (
              <div className="flex shrink-0 items-center gap-1">
                <Badge variant="exited">stopped</Badge>
                {!mission.mergedToMain && (
                  <Button
                    variant="outline"
                    size="xs"
                    data-testid="restart-mission"
                    title="Bring back every session Stop ended, each with its conversation (claude --resume). Workers you shut down one by one stay down."
                    onClick={() => void window.orc.restartMission(mission.id)}
                  >
                    <RotateCcw /> Restart
                  </Button>
                )}
                <Button size="xs" variant="ghost-destructive" data-testid="remove-mission" title="Forget this mission. Its branches and worktrees stay in git." onClick={() => void window.orc.removeMission(mission.id).then(() => setMissionId(null))}>
                  Remove
                </Button>
              </div>
            )}
            {mission.paused && <Badge variant="needs-you" className="shrink-0" data-testid="paused-badge">paused</Badge>}
            {needsTotal > 0 && (
              <button
                key={ring}
                type="button"
                data-testid="needs-you-chip"
                onClick={jumpNeedsYou}
                title="Jump to the first agent that needs you (Ctrl+Shift+J)"
                aria-label={`Jump to the first agent that needs you: ${needsLabel}`}
                className={cn('shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring', ring > 0 && 'animate-orc-ring')}
              >
                <Badge variant="needs-you" className="shrink-0 hover:bg-needs/25">{needsLabel}</Badge>
              </button>
            )}
            {(working > 0 || doneCount > 0) && (
              <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground" data-testid="progress-summary" title="Agents in this mission">
                {[working > 0 && `${working} working`, doneCount > 0 && `${doneCount} done`].filter(Boolean).join(' · ')}
              </span>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <ButtonGroup className="h-7">
                {missionApp && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={cn('h-full px-2.5 text-xs', view === 'app' && 'bg-selected text-foreground hover:bg-selected')}
                      data-testid="open-app"
                      title="Show the app's terminal"
                      onClick={() => setView(view === 'app' ? 'terminal' : 'app')}
                    >
                      <span className={cn('size-1.5 rounded-full', missionApp.status === 'running' ? 'bg-working' : 'bg-exited')} />
                      App
                    </Button>
                    <span className="h-3.5 w-px bg-border" />
                  </>
                )}
                {missionApp?.status === 'running' ? (
                  <Button size="sm" variant="ghost" className="h-full px-2.5 text-xs" disabled={appBusy} data-testid="stop-app" title="End the app and everything it started" onClick={stopApp}>
                    <Square /> {appBusy ? 'Stopping…' : 'Stop app'}
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="h-full px-2.5 text-xs" disabled={appBusy || !!mission.mergedToMain} data-testid="run-app" title={mission.mergedToMain ? 'Merged to main: run the app from your own checkout' : runTitle} onClick={runApp}>
                    <MonitorPlay /> {appBusy ? 'Starting…' : 'Run app'}
                  </Button>
                )}
              </ButtonGroup>
              <span className="h-5 w-px bg-border" />
              <div className="flex items-center gap-0.5">
                {mission.paused ? (
                  <Button size="sm" variant="ghost" className="text-xs" onClick={() => void window.orc.resumeMission(mission.id)} data-testid="resume-mission" title="Release held merges and messages">
                    <Play /> Resume
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs"
                    disabled={mission.state !== 'running'}
                    onClick={() => void window.orc.pauseMission(mission.id)}
                    data-testid="pause-mission"
                    title="Interrupt every agent mid-turn (Esc) and hold new workers, merges and messages from The ORC. You can still type to any agent."
                  >
                    <Pause /> Pause
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost-destructive"
                  className="text-xs"
                  disabled={mission.state === 'stopped'}
                  data-testid="stop-mission"
                  onClick={() => void window.orc.stopMission(mission.id)}
                  title="End every session in this mission. Worktrees are kept."
                >
                  <Square /> Stop
                </Button>
              </div>
              <Button
                size="sm"
                variant={ready ? 'default' : 'outline'}
                disabled={!canMerge}
                onClick={() => setView('merge')}
                data-testid="open-merge"
                aria-label="Integrate into the ORC branch"
                title={mission.merged.length ? withHint('Review the combined diff, gate and Verifier, then integrate this mission into the ORC branch', 'integrate') : 'Nothing merged into the integration branch yet'}
              >
                <GitMerge /> <span className="max-[1599px]:hidden">{mission.integrated ? (isOnOrc(mission) ? 'Integrated' : 'Integrate new work') : 'Integrate'}</span>
              </Button>
              <Button
                size="sm"
                className="text-xs"
                disabled={onOrc === 0}
                onClick={() => setView('main-merge')}
                data-testid="open-main-merge"
                title={onOrc ? withHint(`Merge the ORC branch (${onOrc} integrated mission${onOrc === 1 ? '' : 's'}) into ${mission.mainBranch}`, 'mergeScreen') : 'No mission integrated into the ORC branch yet'}
              >
                <GitMerge /> Merge to main{onOrc > 0 && <span className="rounded bg-primary-foreground/20 px-1 font-mono text-[11px]" data-testid="orc-count">{onOrc}</span>}
              </Button>
            </div>
          </>
        ) : (
          <span className="ml-auto text-xs text-faint">No mission open</span>
        )}
        <PlanUsageHeader warnAt={warnAt} warnOnly className="max-[1099px]:hidden" />
        <HeaderSettingsMenu mission={mission} warnAt={warnAt} onShortcuts={() => openDialog('shortcuts')} onAccounts={() => openDialog('accounts')} />
      </header>
      {showBand && mission && !mainSelected && !dashRoot && (
        <div className={cn('flex shrink-0 items-center gap-2 border-b bg-done/8 px-3 py-1.5 text-xs', 'col-span-full')} data-testid="ready-band" role="status">
          <CircleCheck className="size-4 shrink-0 text-done" />
          <span className="min-w-0 truncate">
            <span className="font-medium">All leads are done.</span> <span className="text-muted-foreground">{readyChecks(mission).text}</span>
          </span>
          <Button size="xs" variant="outline" className="ml-auto shrink-0" data-testid="ready-review-merge" onClick={() => { dismissBand(mission.id); setView('merge') }}>
            Review &amp; integrate
          </Button>
          <Button size="icon-sm" variant="ghost" className="shrink-0" onClick={() => dismissBand(mission.id)} aria-label="Dismiss">
            <X />
          </Button>
        </div>
      )}

      {sidebarOpen && <Sidebar
        spaces={spaces}
        currentRoot={currentRoot}
        missions={missions}
        appRun={appRun}
        selectedMission={mainSelected || dashRoot ? null : mission?.id ?? null}
        selectedTerminal={mainSelected || dashRoot ? null : agent?.terminalId ?? null}
        mains={mains}
        mainRoot={mainRoot}
        dashRoot={dashRoot}
        onSelectRepo={selectRepo}
        onSelectMain={selectMain}
        onSelectMission={selectMission}
        onSelectAgent={selectAgent}
        onReview={(name) => setView({ review: name })}
      />}

      {/* Terminal */}
      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-panel">
        {!mainSelected && !dashRoot && mission && failure && (
          <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-destructive/40 bg-destructive/5 px-3 py-1 text-xs" role="alert" data-testid="failure-banner" data-kind={failure.kind}>
            <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
            <span className="min-w-0 flex-1 truncate text-foreground" title={failure.text}>{failure.text}</span>
            <Button
              size="xs"
              variant="outline"
              className="shrink-0"
              data-testid="failure-action"
              onClick={() => {
                if (failure.kind === 'gate') setView('merge')
                else {
                  selectAgent(failure.agent.terminalId)
                  if (failure.kind === 'conflict' && failure.agent.merge === 'review') setView({ review: failure.agent.name })
                  else focusActiveTerminal()
                }
              }}
            >
              {failure.kind === 'crash' ? 'Open its terminal' : failure.kind === 'conflict' ? 'Open the conflict' : 'Open the gate'}
            </Button>
          </div>
        )}
        {/* Under the header; keep below the failure banner when both show. */}
        {actionError && <Banner text={`Action failed: ${actionError}`} testId="action-error" onDismiss={() => setActionError(null)} />}
        {!mainSelected && !dashRoot && mission && <SplitPanel mission={mission} />}
        {dashRoot ? (
          <RepoDashboard
            root={dashRoot}
            space={spaces.find((s) => s.root === dashRoot)}
            missions={missions}
            main={mains[dashRoot]}
            onOpenMission={selectMission}
            onOpenMain={() => selectMain(dashRoot)}
          />
        ) : !mainSelected && merged && merged.sel === missionId && view === 'main-merge' ? (
          <MergedScreen repo={merged.repo} branch={merged.branch} message={merged.message} onDone={() => { setMerged(null); setView('terminal') }} />
        ) : mainSelected ? (
          main && main.status !== 'off' ? (
            <>
              <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground" data-testid="terminal-head" data-agent="main-session">
                <TerminalSquare className="size-3.5 shrink-0" />
                <span className="shrink-0 font-medium text-foreground">{main.sessionName}</span>
                <span className="min-w-0 truncate text-[11px] text-faint">{main.activity || (mainRunning ? '' : 'Ended. Start begins a new conversation.')}</span>
              </div>
              <TerminalView key={main.terminalId} id={main.terminalId} />
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center" data-testid="main-empty">
              <div className="text-sm font-medium">Main session</div>
              <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">
                One Claude Code session above {main?.repoName ?? 'this repo'}'s missions. It sees only this repo's missions, queue and docs, and it does not own any of them.
              </p>
              <Button size="sm" data-testid="main-start-empty" onClick={() => mainRoot && void window.orc.startMainSession(mainRoot)}>
                <Play /> Start main session
              </Button>
            </div>
          )
        ) : mission && view === 'merge' ? (
          <MergeScreen mission={mission} space={spaces.find((s) => s.root === mission.repoPath)} onBack={() => setView('terminal')} onRemoved={() => { setView('terminal'); setMissionId(null) }} />
        ) : mission && view === 'main-merge' ? (
          <OrcMergeScreen
            repo={mission.repoPath}
            missions={missions}
            onBack={() => setView('terminal')}
            onCleared={(n, message) => {
              // The open mission went to main with the rest: it is cleared out.
              const gone = isOnOrc(mission)
              if (gone) { setMissionId(null); setTerminalId(null) }
              setMerged({ repo: mission.repoPath, branch: mission.mainBranch, message, sel: gone ? null : missionId })
              setMergeNotice(`Merged the ORC branch into ${mission.mainBranch}; cleared ${n} mission${n === 1 ? '' : 's'}`)
            }}
          />
        ) : view === 'app' && missionApp ? (
          <>
            <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground" data-testid="app-head">
              <MonitorPlay className="size-3.5 shrink-0" />
              <span className="shrink-0 font-medium text-foreground">App</span>
              <span className="min-w-0 truncate font-mono text-[11px]">{missionApp.command}</span>
              <span className="min-w-0 truncate font-mono text-[11px] text-faint">{missionApp.cwd}</span>
              {missionApp.status === 'exited' && (
                <Badge variant="exited" className="ml-auto shrink-0" data-testid="app-exited">exited{missionApp.exitCode !== null ? ` (${missionApp.exitCode})` : ''}</Badge>
              )}
              <Button size="xs" variant="ghost" className={cn('shrink-0', missionApp.status === 'running' && 'ml-auto')} disabled={appBusy} onClick={runApp} title="Stop the app and start it again (picks up newly merged work)" data-testid="restart-app">
                <RotateCcw /> Restart
              </Button>
            </div>
            <TerminalView key={`${missionApp.terminalId}:${missionApp.startedAt}`} id={missionApp.terminalId} />
          </>
        ) : mission && typeof view === 'object' ? (
          <ReviewScreen mission={mission} agent={view.review} onBack={() => setView('terminal')} />
        ) : agent ? (
          <>
            <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground" data-testid="terminal-head" data-agent={agent.name}>
              <TerminalSquare className="size-3.5 shrink-0" />
              <span className="shrink-0 font-medium text-foreground">{agent.sessionName}</span>
              <span className="min-w-0 truncate font-mono text-[11px] text-faint">{agent.cwd}</span>
            </div>
            {agent.question && (
              <div className="question-banner" data-testid="question-banner" title={agent.question}>
                {agent.question}
              </div>
            )}
            <TerminalView key={agent.terminalId} id={agent.terminalId} />
          </>
        ) : (
          <EmptyState hasRepo={spaces.length > 0} hasMission={missions.length > 0} sidebarOpen={sidebarOpen} openSidebar={() => setSidebarOpen(true)} />
        )}
      </main>

      {/* Tree + feed */}
      <aside className={cn('relative flex min-h-0 flex-col border-l bg-background transition-opacity', asideIdle && 'pointer-events-none opacity-40')} aria-disabled={asideIdle}>
        {side.handle}
        <div className="panel-title flex h-8 items-center justify-between border-b px-3">
          <span className="text-[11px] font-medium uppercase tracking-wide text-faint">{mainSelected ? 'Repo coordinators' : 'Mission tree'}</span>
          <Button
            size="sm"
            variant="ghost"
            className={cn('h-6 px-1.5 text-[11px]', showMessages && 'bg-selected text-foreground hover:bg-selected')}
            onClick={() => setShowMessages((v) => !v)}
            title="Draw messages between agents on the tree"
            data-testid="toggle-messages"
          >
            <MessagesSquare /> messages
          </Button>
        </div>
        <div className="h-[46%] min-h-45 border-b" data-testid="tree">
          {mainSelected ? (
            <MissionTree agents={mainGraph} feed={[]} selected={null} onSelect={(tid) => { if (tid !== mainTid) selectAgent(tid) }} showMessages={false} />
          ) : mission && !dashRoot ? (
            <MissionTree agents={shown} feed={mission.feed} selected={agent?.terminalId ?? null} onSelect={selectAgent} showMessages={showMessages} />
          ) : (
            <div className="p-4 text-xs text-muted-foreground">A node appears whenever an agent spawns a worker.</div>
          )}
        </div>
        <div className="panel-title flex h-8 items-center border-b px-3 text-[11px] font-medium uppercase tracking-wide text-faint">Feed</div>
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="feed">
          <Feed feed={mainSelected || dashRoot ? [] : mission?.feed ?? []} />
        </div>
      </aside>

      <CommandPalette
        open={dialog === 'palette'}
        onClose={closeDialog}
        missions={missions}
        currentMissionId={mission?.id ?? null}
        onSelectMission={(id) => {
          selectMission(id)
          focusActiveTerminal()
        }}
        onSelectAgent={(tid) => {
          selectAgent(tid)
          focusActiveTerminal()
        }}
      />
      <ShortcutsDialog open={dialog === 'shortcuts'} onClose={closeDialog} />
      <AccountsScreen open={dialog === 'accounts'} onClose={closeDialog} />
    </div>
  )
}
