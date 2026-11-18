import { useEffect, useMemo, useState } from 'react'
import { GitMerge, MessagesSquare, Pause, Square, TerminalSquare } from 'lucide-react'
import type { MissionView, SpaceView } from '../../shared/types'
import { Feed } from './components/Feed'
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

export function App(): React.JSX.Element {
  const [spaces, setSpaces] = useState<SpaceView[]>([])
  const [missions, setMissions] = useState<MissionView[]>([])
  const [missionId, setMissionId] = useState<string | null>(null)
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [showMessages, setShowMessages] = useState(true)
  const [, tick] = useState(0)

  useEffect(() => {
    void window.orc.listMissions().then(setMissions)
    void window.orc.listSpaces().then(setSpaces)
    const offM = window.orc.onMissions(setMissions)
    const offS = window.orc.onSpaces(setSpaces)
    const timer = setInterval(() => tick((n) => n + 1), 10_000)
    return () => {
      offM()
      offS()
      clearInterval(timer)
    }
  }, [])

  const mission = useMemo(
    () => missions.find((m) => m.id === missionId) ?? missions[missions.length - 1] ?? null,
    [missions, missionId]
  )
  const agent = mission?.agents.find((a) => a.terminalId === terminalId) ?? mission?.agents.find((a) => a.role === 'coordinator') ?? null

  const selectMission = (id: string): void => {
    setMissionId(id)
    setTerminalId(`${id}:coordinator`)
  }
  const selectAgent = (tid: string): void => {
    setTerminalId(tid)
    setMissionId(tid.split(':')[0])
  }
  const needsYou = mission?.agents.filter((a) => a.status === 'needs-you').length ?? 0

  return (
    <div className="grid h-full grid-cols-[300px_minmax(0,1fr)_320px] grid-rows-[44px_minmax(0,1fr)]">
      {/* Header */}
      <header className="col-span-3 flex items-center gap-3 border-b bg-panel px-3" data-testid="header">
        <div className="flex w-[276px] items-center gap-2">
          <div className="grid h-6 w-9 place-items-center rounded-md bg-primary/15 text-[10.5px] font-black tracking-tight text-primary">ORC</div>
          <span className="font-semibold tracking-tight">The ORC</span>
        </div>
        {mission ? (
          <>
            <div className="flex min-w-0 items-center gap-1.5 text-[13px]" data-testid="header-mission">
              <span className="text-muted-foreground">{mission.repoPath.split('/').pop()}</span>
              <span className="text-muted-foreground/50">/</span>
              <span className="truncate font-semibold">{mission.name}</span>
            </div>
            <Badge variant="outline" title="Every session in this mission uses this permission mode">{modeLabel[mission.permissionMode] ?? mission.permissionMode}</Badge>
            {mission.model && <Badge variant="outline">{mission.model}</Badge>}
            {mission.state === 'stopped' && <Badge variant="exited">stopped</Badge>}
            {needsYou > 0 && <Badge variant="needs-you">{needsYou} need{needsYou === 1 ? 's' : ''} you</Badge>}
            <div className="ml-auto flex items-center gap-1.5">
              <span className="mr-2 text-[12px] tabular-nums text-muted-foreground" title="Tokens used by every session in this mission (input + cache writes + output)">
                {formatTokens(mission.tokens)} tokens
              </span>
              <Button size="sm" variant="outline" disabled title="Pause mission arrives in M4">
                <Pause /> Pause
              </Button>
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
              <Button size="sm" disabled title="Merge to main arrives in M3: it shows the combined diff first">
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
        selectedMission={mission?.id ?? null}
        selectedTerminal={agent?.terminalId ?? null}
        onSelectMission={selectMission}
        onSelectAgent={selectAgent}
      />

      {/* Terminal */}
      <main className="flex min-h-0 min-w-0 flex-col bg-background">
        {agent ? (
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
      <aside className="flex min-h-0 flex-col border-l bg-panel">
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
            <MissionTree agents={mission.agents} feed={mission.feed} selected={agent?.terminalId ?? null} onSelect={selectAgent} showMessages={showMessages} />
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
