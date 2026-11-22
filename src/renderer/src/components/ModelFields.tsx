import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { DefaultRoleModels, ModelRoles, type ModelRole, type RoleModels } from '../../../shared/types'
import { Input } from './ui/input'

export const roleLabel: Record<ModelRole, string> = { coordinator: 'Coordinator', lead: 'Team leads', subagent: 'Subagents', advisor: 'Advisor', verifier: 'Verifier' }

/** Text per role; '' = not set here (inherits). 'none'/'default' stand for null. */
export type ModelDraft = Record<ModelRole, string>

const nullWord = (role: ModelRole): string => (role === 'advisor' ? 'none' : 'default')

export function toDraft(models: Partial<RoleModels>): ModelDraft {
  return Object.fromEntries(ModelRoles.map((r) => [r, r in models ? (models[r] ?? nullWord(r)) : ''])) as ModelDraft
}

/** Only filled fields; "none"/"default" become null. */
export function fromDraft(draft: ModelDraft): Partial<RoleModels> {
  const out: Partial<RoleModels> = {}
  for (const r of ModelRoles) {
    const v = draft[r].trim()
    if (v) out[r] = v === 'none' || v === 'default' ? null : v
  }
  return out
}

/** A collapsed "Models" section: one field per role, placeholder = what it inherits. */
export function ModelFields({ draft, onChange, inherited, label = 'Models' }: {
  draft: ModelDraft
  onChange: (d: ModelDraft) => void
  /** What each role falls back to (space settings over defaults). */
  inherited?: Partial<RoleModels>
  label?: string
}): React.JSX.Element {
  const set = Object.values(draft).filter((v) => v.trim()).length
  const [open, setOpen] = useState(set > 0)
  return (
    <div className="text-[12px]">
      <button type="button" className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)} aria-expanded={open} data-testid="models-toggle">
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {label}
        {set > 0 && <span className="text-faint">· {set} set</span>}
      </button>
      {open && (
        <div className="mt-1.5 grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1" data-testid="model-fields">
          {ModelRoles.map((r) => {
            const base = inherited && r in inherited ? inherited[r] : DefaultRoleModels[r]
            return (
              <label key={r} className="contents">
                <span className="text-[11px] text-muted-foreground">{roleLabel[r]}</span>
                <Input
                  className="h-6 px-2 text-[12px]"
                  list={`models-${r}`}
                  value={draft[r]}
                  placeholder={base ?? nullWord(r)}
                  onChange={(e) => onChange({ ...draft, [r]: e.target.value })}
                  data-testid={`model-${r}`}
                />
                <datalist id={`models-${r}`}>
                  {['sonnet', 'opus', 'haiku', 'fable', nullWord(r)].map((m) => <option key={m} value={m} />)}
                </datalist>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
