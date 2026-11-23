import { Check, FolderPlus, Plus, TerminalSquare } from 'lucide-react'
import { cn } from '../lib/utils'
import { emitShortcut } from '../lib/shortcuts'
import { Button } from './ui/button'

// First-run guide: a checklist (done steps ticked, current step highlighted) and one real
// primary button that opens the same Sidebar form the step names.
export function EmptyState({ hasRepo, hasMission, sidebarOpen, openSidebar }: { hasRepo: boolean; hasMission: boolean; sidebarOpen: boolean; openSidebar: () => void }): React.JSX.Element {
  const steps = [
    { label: 'Add a repository', done: hasRepo },
    { label: 'Start a mission', done: hasMission },
    { label: 'Talk to its coordinator here', done: false }
  ]
  // The forms live in the Sidebar, which listens for the shortcut only while mounted.
  const go = (id: 'newMission' | 'spaceSettings'): void => {
    if (sidebarOpen) return emitShortcut(id)
    openSidebar()
    window.setTimeout(() => emitShortcut(id), 50)
  }
  const current = steps.findIndex((s) => !s.done)
  return (
    <div className="m-auto flex w-full max-w-[380px] flex-col items-center px-4 text-center" data-testid="empty-state">
      <div className="mb-4 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
        <TerminalSquare className="size-5" />
      </div>
      <h2 className="text-[15px] font-semibold text-foreground">{hasRepo ? 'Start your first mission' : 'Add a repository to begin'}</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">Each mission runs a coordinator, a real Claude Code session you talk to, and the team leads it spawns.</p>
      <ol className="mt-5 w-full space-y-1 rounded-lg border bg-card p-1.5 text-left text-[12.5px]">
        {steps.map((s, i) => (
          <li key={s.label} className={cn('flex items-center gap-2.5 rounded-md px-2 py-1.5', i === current && 'bg-selected', i > current && 'opacity-55')} aria-current={i === current ? 'step' : undefined}>
            <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-medium tabular-nums', s.done ? 'border-transparent bg-primary text-primary-foreground' : i === current ? 'border-primary text-primary' : 'border-border-strong bg-secondary text-muted-foreground')}>
              {s.done ? <Check className="size-3" /> : i + 1}
            </span>
            <span className={cn(s.done ? 'text-muted-foreground line-through' : 'text-foreground/90', i === current && 'font-medium text-foreground')}>{s.label}</span>
          </li>
        ))}
      </ol>
      {hasRepo ? (
        <Button className="mt-4 w-full" data-testid="empty-start-mission" onClick={() => go('newMission')}>
          <Plus /> Start mission
        </Button>
      ) : (
        <Button className="mt-4 w-full" data-testid="empty-add-repo" onClick={() => go('spaceSettings')}>
          <FolderPlus /> Add repository
        </Button>
      )}
    </div>
  )
}
