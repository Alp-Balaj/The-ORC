import { useCallback, useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, CircleDashed, ExternalLink, LoaderCircle, Plus, Trash2, X } from 'lucide-react'
import type { ClaudeAccountView } from '../../../shared/claude-accounts-types'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'

/** The preload methods this section needs (wired by the AccountsScreen lead). */
interface Api {
  listClaudeAccounts(): Promise<ClaudeAccountView[]>
  addClaudeAccount(name: string): Promise<string>
  loginClaudeAccount(id: string): Promise<void>
  cancelClaudeLogin(id: string): Promise<void>
  submitClaudeLoginCode(id: string, code: string): Promise<void>
  setActiveClaudeAccount(id: string): Promise<void>
  renameClaudeAccount(id: string, name: string): Promise<void>
  removeClaudeAccount(id: string): Promise<void>
}
const api = (): Api => window.orc as unknown as Api
const errText = (err: unknown): string => String(err).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')

function StateIcon({ state }: { state: ClaudeAccountView['state'] }): React.JSX.Element {
  if (state === 'logging-in') return <LoaderCircle className="size-3.5 shrink-0 animate-spin text-working" aria-label="logging in" />
  if (state === 'logged-in') return <CircleCheck className="size-3.5 shrink-0 text-done" aria-label="logged in" />
  if (state === 'logged-out') return <CircleDashed className="size-3.5 shrink-0 text-faint" aria-label="logged out" />
  return <CircleAlert className="size-3.5 shrink-0 text-needs" aria-label={state} />
}

function stateText(a: ClaudeAccountView): string {
  if (a.state === 'logging-in') return 'Waiting for sign-in in your browser…'
  if (a.state === 'logged-in') return [a.email, a.plan].filter(Boolean).join(' · ') || 'Logged in'
  if (a.state === 'expired') return `Login expired${a.email ? ` · ${a.email}` : ''}. Sign in again.`
  if (a.state === 'error') return a.error ?? 'Could not check this account.'
  return a.error ?? 'Not logged in'
}

function Row({ a, busy, onAct }: { a: ClaudeAccountView; busy: boolean; onAct: (fn: () => Promise<unknown>) => void }): React.JSX.Element {
  const [code, setCode] = useState('')
  const needsLogin = a.state === 'logged-out' || a.state === 'expired' || a.state === 'error'
  return (
    <li className="px-3 py-2.5" data-testid={`claude-account-${a.id}`}>
      <div className="flex items-center gap-2.5">
        <StateIcon state={a.state} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px]">
            <span className="truncate font-medium">{a.name}</span>
            {a.active && <span className="rounded-sm bg-accent/15 px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-accent">Active</span>}
          </div>
          <div className={cn('truncate text-[11.5px]', a.state === 'expired' || a.state === 'error' ? 'text-needs' : 'text-muted-foreground')}>{stateText(a)}</div>
        </div>
        {a.state === 'logging-in' && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onAct(() => api().cancelClaudeLogin(a.id))}>Cancel</Button>
        )}
        {needsLogin && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onAct(() => api().loginClaudeAccount(a.id))}>
            {a.state === 'expired' ? 'Sign in again' : 'Sign in'}
          </Button>
        )}
        {a.state === 'logged-in' && !a.active && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onAct(() => api().setActiveClaudeAccount(a.id))}>Make active</Button>
        )}
        {!a.isDefault && (
          <Button variant="ghost" size="icon" aria-label={`Remove ${a.name}`} title="Remove account" disabled={busy} onClick={() => onAct(() => api().removeClaudeAccount(a.id))}>
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
      {a.state === 'logging-in' && (
        <div className="mt-2 space-y-1.5 pl-6 text-[11.5px] text-muted-foreground">
          {a.loginUrl && (
            <a className="inline-flex max-w-full items-center gap-1 truncate text-accent hover:underline" href={a.loginUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3 shrink-0" />
              <span className="truncate">Open the sign-in page</span>
            </a>
          )}
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (!code.trim()) return
              onAct(() => api().submitClaudeLoginCode(a.id, code))
              setCode('')
            }}
          >
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste the code if the browser shows one" aria-label="Sign-in code" className="h-7 flex-1 text-[12px]" />
            <Button type="submit" variant="outline" size="sm" disabled={!code.trim()}>Submit</Button>
          </form>
        </div>
      )}
    </li>
  )
}

/** Claude Code logins: add several, choose the active one, new missions start with it. */
export function ClaudeAccountsSection(): React.JSX.Element {
  const [accounts, setAccounts] = useState<ClaudeAccountView[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const refresh = useCallback(async () => {
    try {
      setAccounts(await api().listClaudeAccounts())
    } catch (err) {
      setError(errText(err))
    }
  }, [])
  const loggingIn = accounts?.some((a) => a.state === 'logging-in') ?? false

  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    if (!loggingIn) return
    const t = setInterval(() => void refresh(), 1500)
    return () => clearInterval(t)
  }, [loggingIn, refresh])

  const act = (fn: () => Promise<unknown>): void => {
    setBusy(true)
    setError(null)
    fn().catch((err) => setError(errText(err))).finally(() => {
      setBusy(false)
      void refresh()
    })
  }

  return (
    <section className="space-y-2" data-testid="claude-accounts">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-medium">Claude accounts</h2>
          <p className="text-[11.5px] text-muted-foreground">New missions use the active account. A running mission keeps the one it started with.</p>
        </div>
        {!adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add account
          </Button>
        )}
      </div>
      {adding && (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            act(() => api().addClaudeAccount(name))
            setName('')
            setAdding(false)
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Work" aria-label="Account name" className="h-7 flex-1 text-[12px]" />
          <Button type="submit" size="sm" disabled={busy}>Sign in</Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Cancel" onClick={() => setAdding(false)}><X className="size-3.5" /></Button>
        </form>
      )}
      {error && <div role="alert" className="rounded-md border border-needs/40 bg-needs/10 px-3 py-1.5 text-[12px] text-needs">{error}</div>}
      {accounts === null ? (
        <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" /> Checking logins…</div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {accounts.map((a) => <Row key={a.id} a={a} busy={busy} onAct={act} />)}
        </ul>
      )}
      {accounts?.length === 1 && accounts[0].state === 'logged-out' && (
        <p className="text-[11.5px] text-muted-foreground">No Claude login found. Sign in to the default account, or add another.</p>
      )}
    </section>
  )
}
