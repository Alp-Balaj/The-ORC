import { useEffect, useMemo, useState } from 'react'
import type { AgentView, MissionView, PermissionMode } from '../../shared/types'
import { TerminalView } from './TerminalView'

function NewMission({ onStarted }: { onStarted: (terminalId: string) => void }): React.JSX.Element {
  const [repo, setRepo] = useState('')
  const [name, setName] = useState('')
  const [mode, setMode] = useState<PermissionMode>('acceptEdits')
  const [error, setError] = useState<string | null>(null)

  async function start(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    try {
      const id = await window.orc.startMission({ repoPath: repo, name, permissionMode: mode })
      onStarted(`${id}:coordinator`)
      setName('')
    } catch (err) {
      setError(String(err).replace(/^Error: (Error invoking remote method '[^']+': )?/, ''))
    }
  }

  return (
    <form className="new-mission" onSubmit={start}>
      <h2>New mission</h2>
      <button type="button" className="ghost" onClick={async () => setRepo((await window.orc.pickRepo()) ?? repo)}>
        {repo ? repo.split('/').slice(-2).join('/') : 'Choose repository…'}
      </button>
      <input placeholder="Mission name, e.g. social feed" value={name} onChange={(e) => setName(e.target.value)} />
      <select value={mode} onChange={(e) => setMode(e.target.value as PermissionMode)}>
        <option value="acceptEdits">Accept edits (ask for commands)</option>
        <option value="auto">Auto</option>
        <option value="manual">Ask for everything</option>
        <option value="bypassPermissions">Bypass permissions</option>
      </select>
      <button type="submit" disabled={!repo || !name.trim()}>Start mission</button>
      {error && <div className="error">{error}</div>}
    </form>
  )
}

function ago(t: number | null): string {
  if (!t) return ''
  const s = Math.round((Date.now() - t) / 1000)
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`
}

function AgentCard({ a, selected, onSelect }: { a: AgentView; selected: boolean; onSelect: () => void }): React.JSX.Element {
  return (
    <div className={`card ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="row"><span className={`dot ${a.status}`} /><strong>{a.name}</strong><span className="meta">{a.status}</span></div>
      <div className="meta">{a.activity}</div>
      {a.lastInstructionBy && <div className="meta">last instruction: {a.lastInstructionBy}, {ago(a.lastInstructionAt)}</div>}
      {a.branch && <div className="meta">{a.branch}</div>}
      {a.question && <div className="question">? {a.question}</div>}
      {a.doneSummary && <div className="meta">✓ {a.doneSummary}</div>}
    </div>
  )
}

function Tree({ agents, parent, depth, selected, onSelect }: {
  agents: AgentView[]; parent: string | null; depth: number; selected: string | null; onSelect: (id: string) => void
}): React.JSX.Element {
  return (
    <>
      {agents.filter((a) => a.parent === parent).map((a) => (
        <div key={a.terminalId}>
          <div className={`node ${selected === a.terminalId ? 'selected' : ''}`} style={{ marginLeft: depth * 14 }} onClick={() => onSelect(a.terminalId)}>
            <span className={`dot ${a.status}`} />{depth > 0 ? '└ ' : ''}{a.name}
          </div>
          <Tree agents={agents} parent={a.name} depth={depth + 1} selected={selected} onSelect={onSelect} />
        </div>
      ))}
    </>
  )
}

export function App(): React.JSX.Element {
  const [missions, setMissions] = useState<MissionView[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    void window.orc.listMissions().then(setMissions)
    const off = window.orc.onMissions(setMissions)
    const timer = setInterval(() => tick((n) => n + 1), 10_000)
    return () => { off(); clearInterval(timer) }
  }, [])

  const all = useMemo(() => missions.flatMap((m) => m.agents.map((a) => ({ m, a }))), [missions])
  const current = all.find((x) => x.a.terminalId === selected)
  const mission = current?.m ?? missions[missions.length - 1]

  return (
    <div className="layout">
      <aside className="panel left">
        <NewMission onStarted={setSelected} />
        <h2>Agents</h2>
        {missions.map((m) => (
          <div className="mission" key={m.id}>
            <div className="mission-name">{m.repoPath.split('/').pop()} › {m.name}</div>
            {m.agents.map((a) => (
              <AgentCard key={a.terminalId} a={a} selected={a.terminalId === selected} onSelect={() => setSelected(a.terminalId)} />
            ))}
          </div>
        ))}
      </aside>
      <main className="center">
        {current ? (
          <>
            <div className="center-head">{current.a.sessionName} · {current.a.cwd}</div>
            <TerminalView key={current.a.terminalId} id={current.a.terminalId} />
          </>
        ) : (
          <div className="empty">Choose a repository and start a mission. Its coordinator opens here, a real Claude Code session you can talk to.</div>
        )}
      </main>
      <aside className="panel right">
        <h2>Mission tree</h2>
        {mission && <Tree agents={mission.agents} parent={null} depth={0} selected={selected} onSelect={setSelected} />}
      </aside>
    </div>
  )
}
