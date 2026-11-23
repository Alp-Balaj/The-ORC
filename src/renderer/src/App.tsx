import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, GitMerge, Keyboard, MessagesSquare, MonitorPlay, PanelLeft, Pause, Play, RotateCcw, Square, TerminalSquare, X } from 'lucide-react'
import { ModelRoles, missionFailure, shownAgents, type AppRunView, type MissionView, type SpaceView } from '../../shared/types'
import { roleLabel } from './components/ModelFields'
import { CommandPalette } from './components/CommandPalette'
import { Feed } from './components/Feed'
import { MergeScreen, ReviewScreen, SplitPanel } from './components/MissionScreens'
import { MissionTree } from './components/MissionTree'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { Sidebar } from './components/Sidebar'
import { PlanUsageHeader } from './components/PlanUsageHeader'
import { AccentPicker } from './components/AccentPicker'
import { ThemeToggle } from './components/ThemeToggle'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { ButtonGroup } from './components/ui/button-group'
import { focusActiveTerminal, TerminalView } from './TerminalView'
import { emitShortcut, installGlobalShortcuts, onShortcut, withHint, type ShortcutId } from './lib/shortcuts'
import { getThemePref, setThemePref } from './lib/theme'
import { cn, formatTokens } from './lib/utils'

const modeLabel: Record<string, string> = {
  acceptEdits: 'accept edits',
  auto: 'auto',
  manual: 'ask for everything',
  bypassPermissions: 'bypass permissions',
  dontAsk: "don't ask"
}

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
      className={cn('absolute inset-y-0 -left-[3px] z-20 w-[6px] cursor-col-resize transition-colors hover:bg-primary/40', active && 'bg-primary/60')}
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
  const [view, setView] = useState<'terminal' | 'merge' | 'app' | { review: string }>('terminal')
  // The app being built, running from one mission's integration branch (one at a time).
  const [appRun, setAppRun] = useState<AppRunView | null>(null)
  const [appBusy, setAppBusy] = useState(false)
  const [, tick] = useState(0)
  // A failed action (IPC rejected) shows here instead of disappearing into the console.
  const [actionError, setActionError] = useState<string | null>(null)
  // "Merged into main; cleared N missions": shown after the open mission was cleared out.
  const [mergeNotice, setMergeNotice] = useState<string | null>(null)
  // Missions The ORC brought back on its own at launch (each one is live, billed sessions).
  const [resumed, setResumed] = useState<{ id: string; name: string }[]>([])
  const [appRestore, setAppRestore] = useState<{ missionId: string; missionName: string } | null>(null)
  const [appRestoreBusy, setAppRestoreBusy] = useState(false)
  const [appRestoreError, setAppRestoreError] = useState<string | null>(null)
  // Keyboard: the quick switcher or the cheat sheet (one at a time), and whether the sidebar shows.
  const [dialog, setDialog] = useState<'palette' | 'shortcuts' | null>(null)
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
      setTerminalId(tid)
      setMissionId(tid.split(':')[0])
    })
    return () => {
      offM()
      offS()
      offN()
      offA()
    }
  }, [])

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
  const agent = shown.find((a) => a.terminalId === terminalId) ?? shown.find((a) => a.role === 'coordinator') ?? null

  useEffect(() => {
    window.orc.setSelection(mission?.id ?? null, agent?.terminalId ?? null)
  }, [mission?.id, agent?.terminalId])

  // Stable (they only call setters), so the memoized tree skips renders on unrelated updates.
  const selectMission = useCallback((id: string): void => {
    setView('terminal')
    setMissionId(id)
    setTerminalId(`${id}:coordinator`)
  }, [])
  const selectAgent = useCallback((tid: string): void => {
    setView('terminal')
    setTerminalId(tid)
    setMissionId(tid.split(':')[0])
  }, [])
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
  const canMerge = !!mission && (mission.merged.length > 0 || !!mission.mergedToMain)
  const roots = [...spaces.map((s) => s.root), ...missions.map((m) => m.repoPath)].filter((r, i, a) => a.indexOf(r) === i)
  const currentRoot = mission?.repoPath ?? roots[0] ?? null

  const openDialog = (d: 'palette' | 'shortcuts'): void => {
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
        const ordered = roots.flatMap((root) => missions.filter((m) => m.repoPath === root))
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
      case 'mergeScreen':
        if (canMerge) setView('merge')
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
    <div className="relative grid h-full grid-rows-[44px_minmax(0,1fr)]" style={{ gridTemplateColumns: `${sidebarOpen ? '300px ' : ''}minmax(0,1fr) ${side.width}px` }}>
      {actionError && (
        <div className="absolute bottom-3 left-1/2 z-50 flex max-w-xl -translate-x-1/2 items-center gap-2 rounded-lg border border-destructive/40 bg-card px-3 py-2 text-[12px] shadow-lg" data-testid="action-error" role="alert">
          <span className="shrink-0 font-medium text-destructive">Action failed:</span>
          <span className="min-w-0 break-words">{actionError}</span>
          <Button size="icon-sm" variant="ghost" className="ml-1 shrink-0" onClick={() => setActionError(null)} aria-label="Dismiss">
            <X />
          </Button>
        </div>
      )}
      {mergeNotice && (
        <div className={cn('absolute left-1/2 z-50 flex max-w-xl -translate-x-1/2 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-[12px] shadow-lg', actionError ? 'bottom-16' : 'bottom-3')} data-testid="merge-notice" role="status">
          <span className="min-w-0 break-words">{mergeNotice}</span>
          <Button size="icon-sm" variant="ghost" className="ml-1 shrink-0" onClick={() => setMergeNotice(null)} aria-label="Dismiss">
            <X />
          </Button>
        </div>
      )}
      {resumed.length > 0 && (
        <div className={cn('absolute left-1/2 z-50 flex max-w-xl -translate-x-1/2 items-center', actionError ? 'bottom-16' : 'bottom-3', 'gap-2 rounded-lg border bg-card px-3 py-2 text-[12px] shadow-lg')} data-testid="resumed-banner" role="status">
          <RotateCcw className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0">
            Resumed {resumed.length} mission{resumed.length === 1 ? '' : 's'} after restart: <span className="font-medium">{resumed.map((m) => m.name).join(', ')}</span>
          </span>
          <Button size="xs" variant="outline" className="ml-1 shrink-0" data-testid="stop-resumed" title="Stop every mission listed here. Worktrees are kept, and Restart brings each one back." onClick={() => void window.orc.stopResumed().then(() => setResumed([]))}>
            <Square /> Stop all
          </Button>
          <Button size="icon-sm" variant="ghost" className="shrink-0" onClick={() => void window.orc.dismissResumed().then(() => setResumed([]))} aria-label="Dismiss" data-testid="dismiss-resumed">
            <X />
          </Button>
        </div>
      )}
      {appRestore && (
        <div className={cn('absolute left-1/2 z-50 flex max-w-xl -translate-x-1/2 items-center', ['bottom-3', 'bottom-16', 'bottom-[116px]'][(actionError ? 1 : 0) + (resumed.length > 0 ? 1 : 0)], 'gap-2 rounded-lg border bg-card px-3 py-2 text-[12px] shadow-lg')} data-testid="app-restore-banner" role="status">
          <MonitorPlay className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="font-medium">{appRestore.missionName}</span>'s app was running before the restart
            {appRestoreError && <span className="block break-words text-destructive">{appRestoreError}</span>}
          </span>
          <Button
            size="xs"
            variant="outline"
            className="ml-1 shrink-0"
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
      <header className={cn('flex min-w-0 items-center gap-3 border-b bg-background px-3', sidebarOpen ? 'col-span-3' : 'col-span-2')} data-testid="header">
        <div className="flex w-[276px] shrink-0 items-center gap-2">
          <div className="grid h-6 w-9 place-items-center rounded-md bg-primary/15 text-[10.5px] font-black tracking-tight text-primary">ORC</div>
          <span className="font-semibold tracking-tight">The ORC</span>
          <Button size="icon-sm" variant="ghost" className="ml-auto text-muted-foreground" title={withHint('Toggle sidebar', 'toggleSidebar')} aria-label="Toggle sidebar" aria-pressed={sidebarOpen} data-testid="toggle-sidebar" onClick={() => setSidebarOpen((v) => !v)}>
            <PanelLeft />
          </Button>
        </div>
        {mission ? (
          <>
            <div className="flex min-w-0 items-center gap-1.5 text-[13px]" data-testid="header-mission">
              <span className="shrink-0 text-muted-foreground">{mission.repoPath.split(/[\\/]/).pop()}</span>
              <span className="shrink-0 text-faint">/</span>
              <span className="truncate font-semibold">{mission.name}</span>
            </div>
            <div className="flex min-w-0 shrink-[4] items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground">
              <span className="shrink-0" title="Every session in this mission uses this permission mode">{modeLabel[mission.permissionMode] ?? mission.permissionMode}</span>
              <span className="hidden text-faint xl:inline">·</span>
              <span
                className="hidden shrink-0 xl:inline"
                title={ModelRoles.map((r) => `${roleLabel[r]}: ${mission.models[r] ?? (r === 'advisor' ? 'none' : 'default')}`).join('\n')}
                data-testid="header-models"
              >
                {mission.models.coordinator ?? 'default'}
                {mission.models.subagent && mission.models.subagent !== mission.models.coordinator && <span className="text-faint"> · sub {mission.models.subagent}</span>}
                {mission.models.advisor && <span className="text-faint"> · adv {mission.models.advisor}</span>}
              </span>
              <span className={cn('text-faint', mission.state === 'stopped' && 'max-[1399px]:hidden')}>·</span>
              <span className={cn('truncate', mission.state === 'stopped' && 'max-[1399px]:hidden')} title="Gating mode" data-testid="gating">{{ plan: 'plan check', checkpointed: 'checkpointed', none: 'no check' }[mission.gating]}</span>
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
                <Badge variant="needs-you" className="hover:bg-needs/25">{needsLabel}</Badge>
              </button>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <span className="hidden text-[12px] tabular-nums text-faint min-[1400px]:inline" title="Tokens used by every session in this mission (input + cache writes + output)">
                {formatTokens(mission.tokens)} tokens
              </span>
              <ButtonGroup className="h-7">
                {missionApp && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={cn('h-full px-2.5 text-[12px]', view === 'app' && 'bg-selected text-foreground hover:bg-selected')}
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
                  <Button size="sm" variant="ghost" className="h-full px-2.5 text-[12px]" disabled={appBusy} data-testid="stop-app" title="End the app and everything it started" onClick={stopApp}>
                    <Square /> {appBusy ? 'Stopping…' : 'Stop app'}
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="h-full px-2.5 text-[12px]" disabled={appBusy || !!mission.mergedToMain} data-testid="run-app" title={mission.mergedToMain ? 'Merged to main: run the app from your own checkout' : runTitle} onClick={runApp}>
                    <MonitorPlay /> {appBusy ? 'Starting…' : 'Run app'}
                  </Button>
                )}
              </ButtonGroup>
              <span className="h-5 w-px bg-border" />
              <div className="flex items-center gap-0.5">
                {mission.paused ? (
                  <Button size="sm" variant="ghost" className="text-[12px]" onClick={() => void window.orc.resumeMission(mission.id)} data-testid="resume-mission" title="Release held merges and messages">
                    <Play /> Resume
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-[12px]"
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
                  className="text-[12px]"
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
                className="ml-1 text-[12px]"
                disabled={!canMerge}
                onClick={() => setView('merge')}
                data-testid="open-merge"
                title={mission.merged.length ? withHint('Review the combined diff, gate and Verifier, then merge', 'mergeScreen') : 'Nothing merged into the integration branch yet'}
              >
                <GitMerge /> Merge to main
              </Button>
            </div>
          </>
        ) : (
          <span className="ml-auto text-[12px] text-faint">No mission open</span>
        )}
        <span className="h-5 w-px shrink-0 bg-border" />
        <PlanUsageHeader warnAt={spaces.length > 0 ? Math.min(...spaces.map((s) => s.usageThreshold)) : 80} />
        <span className="h-5 w-px shrink-0 bg-border" />
        <ThemeToggle className="shrink-0" />
        <AccentPicker className="shrink-0" />
        <span className="h-5 w-px shrink-0 bg-border" />
        <Button size="icon-sm" variant="ghost" className="shrink-0" title={withHint('Keyboard shortcuts', 'shortcuts')} aria-label="Keyboard shortcuts" data-testid="open-shortcuts" onClick={() => openDialog('shortcuts')}>
          <Keyboard />
        </Button>
      </header>

      {sidebarOpen && <Sidebar
        spaces={spaces}
        currentRoot={currentRoot}
        missions={missions}
        appRun={appRun}
        selectedMission={mission?.id ?? null}
        selectedTerminal={agent?.terminalId ?? null}
        onSelectMission={selectMission}
        onSelectAgent={selectAgent}
        onReview={(name) => setView({ review: name })}
      />}

      {/* Terminal */}
      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-panel">
        {mission && failure && (
          <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-destructive/40 bg-destructive/5 px-3 py-1 text-[12px]" role="alert" data-testid="failure-banner" data-kind={failure.kind}>
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
        {mission && <SplitPanel mission={mission} />}
        {mission && view === 'merge' ? (
          <MergeScreen mission={mission} space={spaces.find((s) => s.root === mission.repoPath)} onBack={() => setView('terminal')} onCleared={(n) => { setView('terminal'); setMissionId(null); setTerminalId(null); setMergeNotice(`Merged into main; cleared ${n} mission${n === 1 ? '' : 's'}`) }} />
        ) : view === 'app' && missionApp ? (
          <>
            <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-[12px] text-muted-foreground" data-testid="app-head">
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
            <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-[12px] text-muted-foreground" data-testid="terminal-head" data-agent={agent.name}>
              <TerminalSquare className="size-3.5 shrink-0" />
              <span className="shrink-0 font-medium text-foreground">{agent.sessionName}</span>
              <span className="min-w-0 truncate font-mono text-[11px] text-faint">{agent.cwd}</span>
            </div>
            <TerminalView key={agent.terminalId} id={agent.terminalId} />
          </>
        ) : (
          <div className="m-auto flex w-full max-w-[380px] flex-col items-center px-4 text-center">
            <div className="mb-4 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <TerminalSquare className="size-5" />
            </div>
            <h2 className="text-[15px] font-semibold text-foreground">No mission open</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">Each mission runs a coordinator, a real Claude Code session you talk to, and the team leads it spawns.</p>
            <ol className="mt-5 w-full space-y-2.5 rounded-lg border bg-card p-3 text-left text-[12.5px]">
              {['Add a repository in the sidebar', 'Start a mission with +', 'Talk to its coordinator here'].map((step, i) => (
                <li key={step} className="flex items-center gap-2.5">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full border border-border-strong bg-secondary text-[11px] font-medium tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="text-foreground/90">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </main>

      {/* Tree + feed */}
      <aside className="relative flex min-h-0 flex-col border-l bg-background">
        {side.handle}
        <div className="flex h-8 items-center justify-between border-b px-3">
          <span className="text-[11px] font-medium uppercase tracking-wide text-faint">Mission tree</span>
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
        <div className="h-[46%] min-h-[180px] border-b" data-testid="tree">
          {mission ? (
            <MissionTree agents={shown} feed={mission.feed} selected={agent?.terminalId ?? null} onSelect={selectAgent} showMessages={showMessages} />
          ) : (
            <div className="p-4 text-[12px] text-muted-foreground">A node appears whenever an agent spawns a worker.</div>
          )}
        </div>
        <div className="flex h-8 items-center border-b px-3 text-[11px] font-medium uppercase tracking-wide text-faint">Feed</div>
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="feed">
          <Feed feed={mission?.feed ?? []} />
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
    </div>
  )
}
