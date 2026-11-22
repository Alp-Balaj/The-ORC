import { useEffect, useMemo, useRef, useState } from 'react'
import { GitMerge, MessagesSquare, MonitorPlay, Pause, Play, RotateCcw, Square, TerminalSquare } from 'lucide-react'
import { shownAgents, type AppRunView, type MissionView, type SpaceView } from '../../shared/types'
import { Feed } from './components/Feed'
import { MergeScreen, ReviewScreen, SplitPanel } from './components/MissionScreens'
import { MissionTree } from './components/MissionTree'
import { Sidebar } from './components/Sidebar'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { TerminalView } from './TerminalView'
import { cn, formatTokens } from './lib/utils'

const modeLabel: Record<string, string> = {
  acceptEdits: 'accept edits',
  auto: 'auto',
  manual: 'ask for everything',
  bypassPermissions: 'bypass permissions',
  dontAsk: "don't ask"
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
  // Missions The ORC brought back on its own at launch (each one is live, billed sessions).
  const [resumed, setResumed] = useState<{ id: string; name: string }[]>([])
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
    const offA = window.orc.onApp(setAppRun)
    const offM = window.orc.onMissions(setMissions)
    const offS = window.orc.onSpaces(setSpaces)
    const timer = setInterval(() => tick((n) => n + 1), 10_000)
    return () => {
      offM()
      offS()
      offA()
      clearInterval(timer)
    }
  }, [])

  const mission = useMemo(
    () => missions.find((m) => m.id === missionId) ?? missions[missions.length - 1] ?? null,
    [missions, missionId]
  )
  // A removed (exited) worker's terminal falls back to the coordinator's.
  const shown = useMemo(() => (mission ? shownAgents(mission) : []), [mission])
  const agent = shown.find((a) => a.terminalId === terminalId) ?? shown.find((a) => a.role === 'coordinator') ?? null

  const selectMission = (id: string): void => {
    setView('terminal')
    setMissionId(id)
    setTerminalId(`${id}:coordinator`)
  }
  const selectAgent = (tid: string): void => {
    setView('terminal')
    setTerminalId(tid)
    setMissionId(tid.split(':')[0])
  }
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
  const side = useSideWidth()
  const needsYou = mission?.agents.filter((a) => a.status === 'needs-you').length ?? 0

  return (
    <div className="relative grid h-full grid-rows-[44px_minmax(0,1fr)]" style={{ gridTemplateColumns: `300px minmax(0,1fr) ${side.width}px` }}>
      {actionError && (
        <div className="absolute bottom-3 left-1/2 z-50 flex max-w-xl -translate-x-1/2 items-start gap-2 rounded-lg border border-destructive/40 bg-card px-3 py-2 text-[12px] shadow-lg" data-testid="action-error" role="alert">
          <span className="text-destructive">Action failed:</span>
          <span className="min-w-0 break-words">{actionError}</span>
          <button className="ml-2 cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => setActionError(null)} aria-label="Dismiss">✕</button>
        </div>
      )}
      {resumed.length > 0 && (
        <div className={cn('absolute left-1/2 z-50 flex max-w-xl -translate-x-1/2 items-center', actionError ? 'bottom-16' : 'bottom-3', 'gap-2 rounded-lg border bg-card px-3 py-2 text-[12px] shadow-lg')} data-testid="resumed-banner" role="status">
          <RotateCcw className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0">
            Resumed {resumed.length} mission{resumed.length === 1 ? '' : 's'} after restart: <span className="font-medium">{resumed.map((m) => m.name).join(', ')}</span>
          </span>
          <Button size="sm" variant="outline" className="ml-2 h-6 shrink-0 px-2 text-[11px]" data-testid="stop-resumed" title="Stop every mission listed here. Worktrees are kept, and Restart brings each one back." onClick={() => void window.orc.stopResumed().then(() => setResumed([]))}>
            <Square /> Stop all
          </Button>
          <button className="cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => void window.orc.dismissResumed().then(() => setResumed([]))} aria-label="Dismiss" data-testid="dismiss-resumed">✕</button>
        </div>
      )}
      {/* Header */}
      <header className="col-span-3 flex items-center gap-3 border-b bg-panel px-3" data-testid="header">
        <div className="flex w-[276px] items-center gap-2">
          <div className="grid h-6 w-9 place-items-center rounded-md bg-primary/15 text-[10.5px] font-black tracking-tight text-primary">ORC</div>
          <span className="font-semibold tracking-tight">The ORC</span>
        </div>
        {mission ? (
          <>
            <div className="flex min-w-0 items-center gap-1.5 text-[13px]" data-testid="header-mission">
              <span className="text-muted-foreground">{mission.repoPath.split(/[\\/]/).pop()}</span>
              <span className="text-muted-foreground/50">/</span>
              <span className="truncate font-semibold">{mission.name}</span>
            </div>
            <Badge variant="outline" title="Every session in this mission uses this permission mode">{modeLabel[mission.permissionMode] ?? mission.permissionMode}</Badge>
            {mission.model && <Badge variant="outline">{mission.model}</Badge>}
            <Badge variant="outline" title="Gating mode" data-testid="gating">{{ plan: 'plan check', checkpointed: 'checkpointed', none: 'no check' }[mission.gating]}</Badge>
            {mission.state === 'stopped' && <Badge variant="exited">stopped</Badge>}
            {mission.state === 'stopped' && !mission.mergedToMain && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                data-testid="restart-mission"
                title="Bring back every session Stop ended, each with its conversation (claude --resume). Workers you shut down one by one stay down."
                onClick={() => void window.orc.restartMission(mission.id)}
              >
                <RotateCcw /> Restart
              </Button>
            )}
            {mission.state === 'stopped' && (
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" data-testid="remove-mission" title="Forget this mission. Its branches and worktrees stay in git." onClick={() => void window.orc.removeMission(mission.id).then(() => setMissionId(null))}>
                Remove
              </Button>
            )}
            {mission.paused && <Badge variant="needs-you" data-testid="paused-badge">paused</Badge>}
            {needsYou > 0 && <Badge variant="needs-you">{needsYou} need{needsYou === 1 ? 's' : ''} you</Badge>}
            <div className="ml-auto flex items-center gap-1.5">
              <span className="mr-2 text-[12px] tabular-nums text-muted-foreground" title="Tokens used by every session in this mission (input + cache writes + output)">
                {formatTokens(mission.tokens)} tokens
              </span>
              {missionApp && (
                <Button
                  size="sm"
                  variant="outline"
                  className={cn(view === 'app' && 'border-primary/60 bg-accent')}
                  data-testid="open-app"
                  title="Show the app's terminal"
                  onClick={() => setView(view === 'app' ? 'terminal' : 'app')}
                >
                  <span className={cn('size-1.5 rounded-full', missionApp.status === 'running' ? 'bg-working' : 'bg-exited')} />
                  App
                </Button>
              )}
              {missionApp?.status === 'running' ? (
                <Button size="sm" variant="outline" disabled={appBusy} data-testid="stop-app" title="End the app and everything it started" onClick={stopApp}>
                  <Square /> {appBusy ? 'Stopping…' : 'Stop app'}
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled={appBusy || !!mission.mergedToMain} data-testid="run-app" title={mission.mergedToMain ? 'Merged to main: run the app from your own checkout' : runTitle} onClick={runApp}>
                  <MonitorPlay /> {appBusy ? 'Starting…' : 'Run app'}
                </Button>
              )}
              <span className="mx-1 h-5 w-px bg-border" />
              {mission.paused ? (
                <Button size="sm" variant="outline" onClick={() => void window.orc.resumeMission(mission.id)} data-testid="resume-mission" title="Release held merges and messages">
                  <Play /> Resume
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
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
                variant="destructive"
                disabled={mission.state === 'stopped'}
                data-testid="stop-mission"
                onClick={() => void window.orc.stopMission(mission.id)}
                title="End every session in this mission. Worktrees are kept."
              >
                <Square /> Stop
              </Button>
              <Button
                size="sm"
                disabled={mission.merged.length === 0 && !mission.mergedToMain}
                onClick={() => setView('merge')}
                data-testid="open-merge"
                title={mission.merged.length ? 'Review the combined diff, gate and Verifier, then merge' : 'Nothing merged into the integration branch yet'}
              >
                <GitMerge /> Merge to main
              </Button>
            </div>
          </>
        ) : (
          <span className="text-muted-foreground">No mission open</span>
        )}
      </header>

      <Sidebar
        spaces={spaces}
        missions={missions}
        appRun={appRun}
        selectedMission={mission?.id ?? null}
        selectedTerminal={agent?.terminalId ?? null}
        onSelectMission={selectMission}
        onSelectAgent={selectAgent}
        onReview={(name) => setView({ review: name })}
      />

      {/* Terminal */}
      <main className="flex min-h-0 min-w-0 flex-col bg-background">
        {mission && <SplitPanel mission={mission} />}
        {mission && view === 'merge' ? (
          <MergeScreen mission={mission} space={spaces.find((s) => s.root === mission.repoPath)} onBack={() => setView('terminal')} />
        ) : view === 'app' && missionApp ? (
          <>
            <div className="flex h-8 items-center gap-2 border-b px-3 text-[12px] text-muted-foreground" data-testid="app-head">
              <MonitorPlay className="size-3.5" />
              <span className="font-medium text-foreground">App</span>
              <span className="truncate font-mono">· {missionApp.command}</span>
              <span className="truncate">· {missionApp.cwd}</span>
              {missionApp.status === 'exited' && (
                <Badge variant="exited" className="ml-auto shrink-0" data-testid="app-exited">exited{missionApp.exitCode !== null ? ` (${missionApp.exitCode})` : ''}</Badge>
              )}
              <Button size="sm" variant="ghost" className={cn('h-6 shrink-0 px-2 text-[11px]', missionApp.status === 'running' && 'ml-auto')} disabled={appBusy} onClick={runApp} title="Stop the app and start it again (picks up newly merged work)" data-testid="restart-app">
                <RotateCcw /> Restart
              </Button>
            </div>
            <TerminalView key={`${missionApp.terminalId}:${missionApp.startedAt}`} id={missionApp.terminalId} />
          </>
        ) : mission && typeof view === 'object' ? (
          <ReviewScreen mission={mission} agent={view.review} onBack={() => setView('terminal')} />
        ) : agent ? (
          <>
            <div className="flex h-8 items-center gap-2 border-b px-3 text-[12px] text-muted-foreground" data-testid="terminal-head" data-agent={agent.name}>
              <TerminalSquare className="size-3.5" />
              <span className="font-medium text-foreground">{agent.sessionName}</span>
              <span className="truncate">· {agent.cwd}</span>
            </div>
            <TerminalView key={agent.terminalId} id={agent.terminalId} />
          </>
        ) : (
          <div className="m-auto max-w-sm text-center text-muted-foreground">
            <TerminalSquare className="mx-auto mb-3 size-8 opacity-40" />
            <p className="leading-relaxed">Open a repository, then start a mission with <span className="text-foreground">+</span>. Its coordinator opens here: a real Claude Code session you talk to.</p>
          </div>
        )}
      </main>

      {/* Tree + feed */}
      <aside className="relative flex min-h-0 flex-col border-l bg-panel">
        {side.handle}
        <div className="flex h-8 items-center justify-between border-b px-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Mission tree</span>
          <Button
            size="sm"
            variant="ghost"
            className={cn('h-6 px-1.5 text-[11px]', showMessages ? 'text-done' : 'text-muted-foreground')}
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
        <div className="flex h-8 items-center border-b px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Feed</div>
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="feed">
          <Feed feed={mission?.feed ?? []} />
        </div>
      </aside>
    </div>
  )
}
