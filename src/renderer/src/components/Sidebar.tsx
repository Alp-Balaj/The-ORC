import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, ChevronRight, FolderGit2, FolderPlus, MonitorPlay, Plus, Settings2, X } from 'lucide-react'
import { shownAgents, type AppRunView, type Gating, type MissionView, type PermissionMode, type SpaceView } from '../../../shared/types'
import { cn, formatTokens } from '../lib/utils'
import { AgentCard, StatusDot } from './AgentCard'
import { Button } from './ui/button'
import { Input, NativeSelect } from './ui/input'

function NewMissionForm({ space, onStarted, onCancel }: {
  space: string
  onStarted: (missionId: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [mode, setMode] = useState<PermissionMode>('acceptEdits')
  const [gating, setGating] = useState<Gating>('none')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function start(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      onStarted(await window.orc.startMission({ repoPath: space, name, permissionMode: mode, gating }))
    } catch (err) {
      setError(String(err).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.form
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      onSubmit={start}
      data-testid="new-mission-form"
      className="mx-1 mb-2 space-y-1.5 overflow-hidden rounded-lg border bg-card p-2"
    >
      <Input autoFocus placeholder="Mission name, e.g. social feed" value={name} onChange={(e) => setName(e.target.value)} />
      <NativeSelect value={mode} onChange={(e) => setMode(e.target.value as PermissionMode)} title="Every session in the mission uses this permission mode">
        <option value="acceptEdits">Accept edits (ask for commands)</option>
        <option value="auto">Auto</option>
        <option value="manual">Ask for everything</option>
        <option value="bypassPermissions">Bypass permissions</option>
      </NativeSelect>
      <NativeSelect value={gating} onChange={(e) => setGating(e.target.value as Gating)} title="When a finished team's work merges into the mission's integration branch" data-testid="gating-select">
        <option value="none">No check: auto-merge (fastest)</option>
        <option value="plan">Plan check: approve the split, then auto-merge</option>
        <option value="checkpointed">Checkpointed: review every team's diff</option>
      </NativeSelect>
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" className="flex-1" disabled={busy || !name.trim()}>Start mission</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
      {error && <div className="text-[12px] text-destructive" data-testid="new-mission-error">{error}</div>}
    </motion.form>
  )
}

function SpaceSettings({ space, onClose }: { space: SpaceView; onClose: () => void }): React.JSX.Element {
  const [gate, setGate] = useState(space.gateCommand ?? '')
  const [max, setMax] = useState(String(space.maxLive))
  const [records, setRecords] = useState(space.recordsDir ?? '')
  const [run, setRun] = useState(space.runCommand ?? '')
  return (
    <motion.form
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      data-testid="space-settings"
      className="mx-1 mb-2 space-y-1.5 overflow-hidden rounded-lg border bg-card p-2 text-[12px]"
      onSubmit={(e) => {
        e.preventDefault()
        void window.orc.updateSpace(space.root, { gateCommand: gate || null, maxLive: Number(max) || space.maxLive, recordsDir: records || null, runCommand: run || null }).then(onClose)
      }}
    >
      <label className="block text-muted-foreground">Run command (Run app starts it in a mission's integration branch)</label>
      <Input value={run} onChange={(e) => setRun(e.target.value)} placeholder="e.g. pnpm install && pnpm dev" data-testid="run-command" />
      <label className="block text-muted-foreground">Gate command (runs on each merged result)</label>
      <Input value={gate} onChange={(e) => setGate(e.target.value)} placeholder="e.g. pnpm test" />
      <label className="block text-muted-foreground">Most live agents in this space</label>
      <Input type="number" min={1} max={50} value={max} onChange={(e) => setMax(e.target.value)} data-testid="max-live" />
      <label className="block text-muted-foreground">Mission records folder (empty: The ORC's own data folder)</label>
      <Input value={records} onChange={(e) => setRecords(e.target.value)} placeholder={space.recordsDir ? '' : space.recordsPath} title={`Now: ${space.recordsPath}`} data-testid="records-dir" />
      <div className="flex gap-1.5">
        <Button type="submit" size="sm" className="flex-1">Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </motion.form>
  )
}

export function Sidebar({ spaces, missions, appRun, selectedMission, selectedTerminal, onSelectMission, onSelectAgent, onReview }: {
  spaces: SpaceView[]
  appRun: AppRunView | null
  missions: MissionView[]
  selectedMission: string | null
  selectedTerminal: string | null
  onSelectMission: (id: string) => void
  onSelectAgent: (terminalId: string) => void
  onReview: (agent: string) => void
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // Missions whose cards you closed. Clicking the open mission's row toggles it; selecting
  // another mission opens that one.
  const [closedMissions, setClosedMissions] = useState<Set<string>>(new Set())
  const [formFor, setFormFor] = useState<string | null>(null)
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Every repository with a mission is a space, even if it was never added explicitly.
  const roots = [...spaces.map((s) => s.root), ...missions.map((m) => m.repoPath)].filter((r, i, a) => a.indexOf(r) === i)

  async function openRepo(): Promise<void> {
    setError(null)
    const path = await window.orc.pickRepo()
    if (!path) return
    try {
      const root = await window.orc.addSpace(path)
      setFormFor(root)
    } catch (err) {
      setError(String(err).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
    }
  }

  const toggle = (root: string): void =>
    setCollapsed((c) => {
      const n = new Set(c)
      if (n.has(root)) n.delete(root)
      else n.add(root)
      return n
    })

  return (
    <aside className="flex h-full min-h-0 flex-col border-r bg-panel">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Spaces</div>
        <Button size="sm" variant="ghost" onClick={openRepo} title="Open a repository as a space" data-testid="open-repo">
          <FolderPlus /> Open repo
        </Button>
      </div>
      {error && <div className="px-3 pb-2 text-[12px] text-destructive">{error}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {roots.length === 0 && (
          <div className="mx-1 mt-6 rounded-lg border border-dashed p-4 text-center text-[12px] leading-relaxed text-muted-foreground">
            Open a git repository to make it a space. Each space holds missions; each mission has a coordinator you talk to.
          </div>
        )}
        {roots.map((root) => {
          const name = root.split(/[\\/]/).pop()
          const ms = missions.filter((m) => m.repoPath === root)
          const open = !collapsed.has(root)
          const space = spaces.find((s) => s.root === root)
          const live = ms.filter((m) => m.state === 'running').flatMap((m) => m.agents).filter((a) => a.status !== 'done' && a.status !== 'exited').length
          return (
            <div key={root} className="mb-2" data-testid="space" data-space={name}>
              <div className="group flex items-center gap-1 rounded-md px-1 py-1 hover:bg-accent/50">
                <button className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left" onClick={() => toggle(root)} title={root}>
                  {open ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
                  <FolderGit2 className="size-3.5 text-muted-foreground" />
                  <span className="truncate font-semibold">{name}</span>
                  <span className="text-[11px] text-muted-foreground">{ms.length || ''}</span>
                </button>
                {space && (
                  <span className={cn('text-[10.5px] tabular-nums text-muted-foreground', live >= space.maxLive && 'text-needs')} title="Live agents in this space / most allowed" data-testid="live-count">
                    {live}/{space.maxLive}
                  </span>
                )}
                {space && (
                  <Button size="icon" variant="ghost" className="opacity-60 group-hover:opacity-100" title="Space settings" data-testid="space-settings-button" onClick={() => setSettingsFor(settingsFor === root ? null : root)}>
                    <Settings2 />
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="opacity-60 group-hover:opacity-100" title="New mission in this space" data-testid="new-mission" onClick={() => setFormFor(formFor === root ? null : root)}>
                  {formFor === root ? <X /> : <Plus />}
                </Button>
              </div>
              <AnimatePresence>
                {settingsFor === root && space && <SpaceSettings space={space} onClose={() => setSettingsFor(null)} />}
              </AnimatePresence>
              <AnimatePresence>
                {formFor === root && (
                  <NewMissionForm
                    space={root}
                    onCancel={() => setFormFor(null)}
                    onStarted={(id) => {
                      setFormFor(null)
                      onSelectMission(id)
                    }}
                  />
                )}
              </AnimatePresence>
              {open && ms.map((m) => {
                const active = m.id === selectedMission
                const expanded = active && !closedMissions.has(m.id)
                return (
                  <div key={m.id} className="ml-3" data-testid="mission" data-mission={m.name}>
                    <button
                      onClick={() => {
                        setClosedMissions((c) => {
                          const n = new Set(c)
                          if (active && !n.has(m.id)) n.add(m.id)
                          else n.delete(m.id)
                          return n
                        })
                        if (!active) onSelectMission(m.id)
                      }}
                      aria-expanded={expanded}
                      title={expanded ? 'Hide its agents' : 'Show its agents'}
                      className={cn('flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent/60', active && 'bg-accent')}
                    >
                      {expanded ? <ChevronDown className="size-3 text-muted-foreground" /> : <ChevronRight className="size-3 text-muted-foreground" />}
                      <span className={cn('truncate', m.state === 'stopped' && 'text-muted-foreground line-through')}>{m.name}</span>
                      {appRun?.missionId === m.id && appRun.status === 'running' && (
                        <MonitorPlay className="size-3 shrink-0 text-working" aria-label="Its app is running" data-testid="app-running-marker" />
                      )}
                      <span className="ml-auto flex items-center gap-0.5">
                        {shownAgents(m).slice(0, 6).map((a) => <StatusDot key={a.terminalId} status={a.status} className="size-1.5" />)}
                      </span>
                      {m.tokens > 0 && <span className="text-[10.5px] tabular-nums text-muted-foreground">{formatTokens(m.tokens)}</span>}
                    </button>
                    {expanded && (
                      <div className="mt-1 space-y-1.5 pb-1 pl-1 pr-0.5">
                        <AnimatePresence initial={false}>
                          {shownAgents(m).map((a) => (
                            <AgentCard key={a.terminalId} a={a} selected={a.terminalId === selectedTerminal} onSelect={() => onSelectAgent(a.terminalId)} onReview={() => onReview(a.name)}
                              onStop={m.state === 'running' && a.role === 'worker' && a.status !== 'exited' ? () => window.orc.stopWorker(m.id, a.name) : undefined}
                              onDismiss={a.role === 'worker' && a.status === 'exited' && a.merge !== 'review' ? () => void window.orc.dismissAgent(m.id, a.name) : undefined}
                            />
                          ))}
                        </AnimatePresence>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
