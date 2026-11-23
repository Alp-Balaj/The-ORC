import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpDown, ChevronDown, CircleCheck, ChevronRight, Compass, FolderGit2, FolderPlus, MonitorPlay, Plus, Settings2, Upload, X } from 'lucide-react'
import { shownAgents, type AppRunView, type Gating, type MainSessionView, type MissionView, type PermissionMode, type PlanUsageView, type QueueView, type SpaceView } from '../../../shared/types'
import { isMac, onShortcut, withHint } from '../lib/shortcuts'
import { missionReady } from '../lib/ready'
import { cn, formatTokens } from '../lib/utils'
import { getMissionSort, MISSION_SORTS, saveMissionSort, sortMissions, type MissionSort } from '../lib/missionSort'
import { missionAttention, tierBg, tierGlow, topTier } from '../lib/attention'
import { AgentCard, StatusDot, statusLabel } from './AgentCard'
import { LOOP_SETUP_EVENT, LoopSetupDialog } from './LoopSetupDialog'
import { OnboardingDialog } from './OnboardingDialog'
import { SPACE_SETTINGS_EVENT, SpaceSettingsModal } from './SpaceSettingsModal'
import { Button } from './ui/button'
import { Input, NativeSelect } from './ui/input'
import { fromDraft, ModelFields, toDraft } from './ModelFields'
import { AutopilotSwitch } from './AutopilotSwitch'
import { modeOptions, PlanUsageMeter, QueuePanel } from './QueuePanel'

/** Push the repo's main branch when it has a remote and commits the remote lacks. Human click only; never forced. */
function SpacePush({ root, refreshKey }: { root: string; refreshKey: string }): React.JSX.Element | null {
  const [target, setTarget] = useState<{ branch: string; remote: string | null; ahead: number | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    void window.orc.pushTarget(root).then((t) => { if (live) setTarget(t) }).catch(() => { if (live) setTarget(null) })
    return () => { live = false }
  }, [root, refreshKey, tick])
  useEffect(() => {
    const on = (): void => setTick((n) => n + 1)
    window.addEventListener('focus', on)
    return () => window.removeEventListener('focus', on)
  }, [])
  if (!target?.remote || !target.ahead) return null
  return (
    <Button
      size="icon"
      variant="ghost"
      className={cn('h-6 w-auto shrink-0 gap-1 px-1.5 text-[10.5px] tabular-nums', result && !result.ok ? 'text-destructive hover:text-destructive' : 'text-primary hover:text-primary')}
      disabled={busy}
      title={`Push ${target.branch} to ${target.remote} (${target.ahead} unpushed commit${target.ahead === 1 ? '' : 's'}). Never forced.${result && !result.ok ? `\nLast try: ${result.message}` : ''}`}
      data-testid="space-push"
      onClick={async () => {
        setBusy(true)
        setResult(await window.orc.pushToRemote(root))
        setBusy(false)
        setTick((n) => n + 1)
      }}
    >
      <Upload className="size-3.5" />{busy ? '…' : target.ahead}
    </Button>
  )
}

function NewMissionForm({ space, spaceView, onStarted, onCancel }: {
  space: string
  spaceView: SpaceView | undefined
  onStarted: (missionId: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [mode, setMode] = useState<PermissionMode>('acceptEdits')
  const [gating, setGating] = useState<Gating>('none')
  const [models, setModels] = useState(toDraft({}))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function start(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const m = fromDraft(models)
      onStarted(await window.orc.startMission({ repoPath: space, name, permissionMode: mode, gating, ...(Object.keys(m).length > 0 && { models: m }) }))
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
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
      data-testid="new-mission-form"
      className="mx-1 my-1.5 space-y-2 overflow-hidden rounded-lg border bg-card p-2.5"
    >
      <label className="block space-y-1">
        <span className="text-[12px] font-medium text-foreground">Mission name</span>
        <Input autoFocus placeholder="e.g. Add a search bar to the feed" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!name.trim() || undefined} />
        {!name.trim() && <span className="block text-[11px] text-faint">Required. This is the name you will see in the sidebar.</span>}
      </label>
      <label className="block space-y-1">
        <span className="text-[12px] font-medium text-foreground">Permission mode</span>
        <NativeSelect value={mode} onChange={(e) => setMode(e.target.value as PermissionMode)} title="Every session in the mission uses this permission mode">
          {modeOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </NativeSelect>
        <span className="block text-[11px] text-faint">Applies to every session in this mission.</span>
      </label>
      <label className="block space-y-1">
        <span className="text-[12px] font-medium text-foreground">Merge check</span>
        <NativeSelect value={gating} onChange={(e) => setGating(e.target.value as Gating)} title="When a finished team's work merges into the mission's integration branch" data-testid="gating-select">
          <option value="none">No check: auto-merge (fastest)</option>
          <option value="plan">Plan check: approve the split, then auto-merge</option>
          <option value="checkpointed">Checkpointed: review every team's diff</option>
        </NativeSelect>
        <span className="block text-[11px] text-faint">Decides whether you approve a team's work before it lands on the mission branch.</span>
      </label>
      <ModelFields draft={models} onChange={setModels} inherited={spaceView?.models} />
      <div className="flex gap-1.5 pt-0.5">
        <Button type="submit" size="sm" className="h-7 flex-1" disabled={busy || !name.trim()}>{busy ? 'Starting…' : 'Start mission'}</Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-muted-foreground hover:text-foreground" onClick={onCancel}>Cancel</Button>
      </div>
      {error && <div role="alert" className="text-[12px] text-destructive" data-testid="new-mission-error">{error}</div>}
    </motion.form>
  )
}

export function Sidebar({ spaces, missions, appRun, selectedMission, selectedTerminal, currentRoot, mains, mainRoot, dashRoot, onSelectRepo, onSelectMain, onSelectMission, onSelectAgent, onReview }: {
  spaces: SpaceView[]
  currentRoot: string | null
  appRun: AppRunView | null
  missions: MissionView[]
  selectedMission: string | null
  selectedTerminal: string | null
  mains: Record<string, MainSessionView>
  mainRoot: string | null
  /** The repo whose dashboard is open in the main area. */
  dashRoot: string | null
  onSelectRepo: (root: string) => void
  onSelectMain: (root: string) => void
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
  const [onboardFor, setOnboardFor] = useState<{ root: string; rerun: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<MissionSort>(getMissionSort)
  const [queues, setQueues] = useState<QueueView[]>([])
  const [loopRoot, setLoopRoot] = useState<string | null>(null)
  useEffect(() => {
    const open = (e: Event): void => setLoopRoot((e as CustomEvent<string>).detail)
    window.addEventListener(LOOP_SETUP_EVENT, open)
    return () => window.removeEventListener(LOOP_SETUP_EVENT, open)
  }, [])
  useEffect(() => {
    const open = (e: Event): void => setSettingsFor((e as CustomEvent<string>).detail)
    window.addEventListener(SPACE_SETTINGS_EVENT, open)
    return () => window.removeEventListener(SPACE_SETTINGS_EVENT, open)
  }, [])
  const [usage, setUsage] = useState<PlanUsageView | null>(null)
  useEffect(() => {
    void window.orc.listQueues().then(setQueues)
    void window.orc.planUsage().then(setUsage)
    const offQ = window.orc.onQueues(setQueues)
    const offU = window.orc.onPlanUsage(setUsage)
    return () => {
      offQ()
      offU()
    }
  }, [])

  // Every repository with a mission is a space, even if it was never added explicitly.
  const roots = [...spaces.map((s) => s.root), ...missions.map((m) => m.repoPath)].filter((r, i, a) => a.indexOf(r) === i)
  // Sidebar order, for the Mod+1..9 jump hints on mission rows (9 is the last).
  const ordered = roots.flatMap((root) => sortMissions(missions.filter((m) => m.repoPath === root), sort))
  const jumpHint = (id: string): string => {
    const i = ordered.findIndex((m) => m.id === id)
    const n = i >= 0 && i < 8 ? i + 1 : i >= 8 && i === ordered.length - 1 ? 9 : null
    return n === null ? '' : ` (${isMac ? `⌘${n}` : `Ctrl+${n}`})`
  }

  useEffect(
    () =>
      onShortcut((id) => {
        if (!currentRoot) return
        if (id === 'newMission') {
          setFormFor(currentRoot)
          setCollapsed((c) => {
            if (!c.has(currentRoot)) return c
            const n = new Set(c)
            n.delete(currentRoot)
            return n
          })
        } else if (id === 'spaceSettings' && spaces.some((s) => s.root === currentRoot)) {
          setSettingsFor(currentRoot)
        }
      }),
    [currentRoot, spaces]
  )

  async function openRepo(): Promise<void> {
    setError(null)
    const path = await window.orc.pickRepo()
    if (!path) return
    try {
      const root = await window.orc.addSpace(path)
      const added = (await window.orc.listSpaces()).find((s) => s.root === root)
      if (added && added.enrolledAt === null) setOnboardFor({ root, rerun: false })
      else setFormFor(root)
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
    <aside className="flex h-full min-h-0 flex-col border-r bg-background">
      <div className="panel-title flex items-center justify-between px-3 pb-2 pt-3">
        <div className="section-title">Spaces</div>
        <div className="flex items-center gap-0.5">
          <label className="relative flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors focus-within:ring-2 focus-within:ring-ring/25 hover:bg-accent hover:text-foreground" title={`Sort missions: ${MISSION_SORTS.find((o) => o.id === sort)?.label}`}>
            <ArrowUpDown className="size-3.5" />
            <select
              aria-label="Sort missions"
              data-testid="mission-sort"
              className="absolute inset-0 cursor-pointer opacity-0"
              value={sort}
              onChange={(e) => {
                const v = e.target.value as MissionSort
                setSort(v)
                saveMissionSort(v)
              }}
            >
              {MISSION_SORTS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="ghost" className="-mr-1.5 h-7 px-2 text-muted-foreground hover:text-foreground" onClick={openRepo} title="Open a repository as a space" data-testid="open-repo">
            <FolderPlus /> Open repo
          </Button>
        </div>
      </div>
      {error && <div className="px-3 pb-2 text-[12px] text-destructive">{error}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {roots.length === 0 && (
          <div className="mx-1 mt-6 rounded-lg border border-dashed border-border-strong p-4 text-center text-[12px] leading-relaxed text-muted-foreground">
            Open a git repository to make it a space. Each space holds missions; each mission has a coordinator you talk to.
          </div>
        )}
        {roots.map((root) => {
          const name = root.split(/[\\/]/).pop()
          const ms = sortMissions(missions.filter((m) => m.repoPath === root), sort)
          const open = !collapsed.has(root)
          const space = spaces.find((s) => s.root === root)
          const spaceTier = topTier(ms.map((m) => missionAttention(m).tier))
          const live = ms.filter((m) => m.state === 'running').flatMap((m) => m.agents).filter((a) => a.status !== 'done' && a.status !== 'exited').length
          return (
            <div key={root} className="mb-1.5" data-testid="space" data-space={name}>
              <div className={cn('group flex h-7 items-center gap-1 rounded-md px-1 transition-colors hover:bg-accent', dashRoot === root && 'bg-selected hover:bg-selected')}>
                <button
                  type="button"
                  className="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:text-foreground"
                  onClick={(e) => { e.stopPropagation(); toggle(root) }}
                  aria-expanded={open}
                  aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
                  data-testid="space-chevron"
                >
                  {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </button>
                <button
                  type="button"
                  className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-[13px]"
                  onClick={() => {
                    if (!open) toggle(root)
                    onSelectRepo(root)
                  }}
                  aria-current={dashRoot === root ? 'page' : undefined}
                  title={root}
                  data-testid="space-select"
                >
                  <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate font-medium">{name}</span>
                  {ms.length > 0 && <span className="shrink-0 text-[11px] tabular-nums text-faint">{ms.length}</span>}
                  {!open && spaceTier && spaceTier !== 'done' && <span className={cn('size-1.5 shrink-0 rounded-full', tierBg[spaceTier], tierGlow[spaceTier])} title="Something in this space needs a look" data-testid="space-marker" />}
                </button>
                <SpacePush root={root} refreshKey={ms.map((m) => m.mergedToMain?.commit ?? '').join()} />
                                {space && space.enrolledAt !== null && <span className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"><AutopilotSwitch root={root} /></span>}
                {space && (
                  <span className={cn('shrink-0 px-0.5 text-[10.5px] tabular-nums text-faint', live >= space.maxLive && 'font-medium text-needs')} title="Live agents in this space / most allowed" data-testid="live-count">
                    {live}/{space.maxLive}
                  </span>
                )}
                {space && space.enrolledAt === null && (
                  <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => setOnboardFor({ root, rerun: false })} title="Enroll this repository as a space" data-testid="space-onboard">
                    Set up
                  </Button>
                )}
                {space && (
                  <Button size="icon" variant="ghost" className={cn('size-6 shrink-0 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100', settingsFor === root && 'text-foreground opacity-100')} title={withHint('Space settings', 'spaceSettings')} data-testid="space-settings-button" onClick={() => setSettingsFor(root)}>
                    <Settings2 />
                  </Button>
                )}
                <Button size="icon" variant="ghost" className={cn('size-6 shrink-0 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100', formFor === root && 'text-foreground opacity-100')} title={withHint('New mission in this space', 'newMission')} data-testid="new-mission" onClick={() => setFormFor(formFor === root ? null : root)}>
                  {formFor === root ? <X /> : <Plus />}
                </Button>
              </div>
              <AnimatePresence>
                {formFor === root && (
                  <NewMissionForm
                    space={root}
                    spaceView={space}
                    onCancel={() => setFormFor(null)}
                    onStarted={(id) => {
                      setFormFor(null)
                      onSelectMission(id)
                    }}
                  />
                )}
              </AnimatePresence>
              {open && (() => {
                // Each space has its own main session; its dot uses the agent palette ("off" reads as exited).
                const main = mains[root]
                const mainDot = main && main.status !== 'off' ? main.status : 'exited'
                const mainSubtitle = !main || main.status === 'off' ? 'Not started' : main.activity || statusLabel[mainDot]
                const mainSelected = mainRoot === root
                return (
                  <div className="ml-2.5 mt-0.5 border-l border-border/50 pl-1.5" data-testid="main-session-entry">
                    <button
                      type="button"
                      onClick={() => onSelectMain(root)}
                      aria-current={mainSelected ? 'page' : undefined}
                      title={`Main session: oversees ${name}'s missions${main?.status === 'needs-you' ? ' (needs you)' : ''}`}
                      className={cn(
                        'flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-1.5 text-left text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                        mainSelected && 'bg-selected text-foreground hover:bg-selected'
                      )}
                    >
                      <Compass className="size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">Main session</span>
                      <span className="max-w-[45%] shrink truncate text-[11px] font-normal text-faint" data-testid="main-session-subtitle">{mainSubtitle}</span>
                      <StatusDot status={mainDot} />
                    </button>
                  </div>
                )
              })()}
              {open && ms.length > 0 && (
              <div className="ml-2.5 mt-0.5 space-y-px border-l border-border/50 pl-1.5">
              {ms.map((m) => {
                const active = m.id === selectedMission
                const expanded = active && !closedMissions.has(m.id)
                const att = missionAttention(m)
                return (
                  <div key={m.id} className="min-w-0" data-testid="mission" data-mission={m.name}>
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
                      title={(att.title ? att.title + '\n' : '') + (expanded ? 'Hide its agents' : 'Show its agents') + jumpHint(m.id)}
                      className={cn(
                        'group/m flex h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-left text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                        active && 'bg-selected text-foreground hover:bg-selected'
                      )}
                    >
                      {expanded ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
                      <span className={cn('min-w-0 truncate', m.state === 'stopped' && 'text-faint line-through')}>{m.name}</span>
                      {appRun?.missionId === m.id && appRun.status === 'running' && (
                        <MonitorPlay className="size-3 shrink-0 text-working" aria-label="Its app is running" data-testid="app-running-marker" />
                      )}
                      <span className="ml-auto flex shrink-0 items-center gap-1.5">
                        <span className="flex min-w-3.5 shrink-0 items-center justify-center">
                        {att.tier === 'error' || att.tier === 'needs' ? (
                          <span className={cn('rounded-full px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums text-background', tierBg[att.tier], tierGlow[att.tier])} title={att.title} data-testid="attention-pill" data-tier={att.tier}>{att.tier === 'error' ? att.errors : att.needs}</span>
                        ) : missionReady(m) ? (
                          <CircleCheck className="size-3.5 text-done" aria-label="Ready to integrate" data-testid="mission-ready"><title>Ready to integrate</title></CircleCheck>
                        ) : att.tier === 'ready' || att.tier === 'working' ? (
                          <span title={att.tier === 'ready' ? att.title : 'working'} className="flex items-center"><span className={cn('size-1.5 rounded-full', tierBg[att.tier], att.tier === 'working' && 'animate-orc-pulse')} /></span>
                        ) : null}
                        </span>
                        {m.tokens > 0 && <span className="hidden text-[10.5px] font-normal tabular-nums text-faint group-hover/m:inline">{formatTokens(m.tokens)}</span>}
                      </span>
                    </button>
                    {!expanded && att.question && (att.tier === 'needs') && (
                      <div className="truncate pb-0.5 pl-6 pr-1.5 text-[11px] font-normal text-needs/90" title={att.question} data-testid="mission-question">{att.question}</div>
                    )}
                    {expanded && (
                      <div className="mt-0.5 space-y-px pb-1.5">
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
              )}
              {open && space && <QueuePanel root={root} queue={queues.find((q) => q.root === root)} onSelectMission={onSelectMission} />}
            </div>
          )
        })}
      </div>
      <PlanUsageMeter usage={usage} threshold={spaces.length > 0 ? Math.min(...spaces.map((s) => s.usageThreshold)) : 80} />
      {onboardFor && (
        <OnboardingDialog
          root={onboardFor.root}
          rerun={onboardFor.rerun}
          onClose={() => setOnboardFor(null)}
          onFinish={(r) => {
            setOnboardFor(null)
            setCollapsed((c) => {
              if (!c.has(r)) return c
              const n = new Set(c)
              n.delete(r)
              return n
            })
            setFormFor(r)
          }}
        />
      )}
      {loopRoot && spaces.find((s) => s.root === loopRoot) && (
        <LoopSetupDialog space={spaces.find((s) => s.root === loopRoot)!} queue={queues.find((q) => q.root === loopRoot)} onClose={() => setLoopRoot(null)} />
      )}
      {settingsFor && spaces.find((s) => s.root === settingsFor) && (
        <SpaceSettingsModal
          space={spaces.find((s) => s.root === settingsFor)!}
          onClose={() => setSettingsFor(null)}
          onRerunOnboarding={() => {
            setOnboardFor({ root: settingsFor, rerun: true })
            setSettingsFor(null)
          }}
        />
      )}
    </aside>
  )
}
