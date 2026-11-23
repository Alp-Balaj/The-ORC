import { dialogPanel } from './ui/dialog'
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Copy, Loader2, UserRound, X } from 'lucide-react'
import type { GithubAccountView } from '../../../shared/types'
import { Button } from './ui/button'
import { ClaudeAccountsSection } from './ClaudeAccountsSection'

const POLL_MS = 1500

/** The accounts screen: GitHub (via the gh CLI) and, below, the Claude accounts section. */
export function AccountsScreen({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const [view, setView] = useState<GithubAccountView | null>(null)
  const [waiting, setWaiting] = useState(false) // a connect call is in flight
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const act = useCallback(async (call: () => Promise<GithubAccountView>, isConnect = false): Promise<void> => {
    if (isConnect) setWaiting(true)
    try {
      setView(await call())
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      setView((v) => (v ? { ...v, error } : { state: 'disconnected', user: null, connecting: null, error }))
    } finally {
      if (isConnect) setWaiting(false)
    }
  }, [])

  const load = useCallback(() => act(() => window.orc.githubStatus()), [act])
  const connect = useCallback(() => act(() => window.orc.githubConnect(), true), [act])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  // Poll while a code is pending or while the connect call has not returned yet.
  const polling = open && (waiting || view?.state === 'connecting')
  useEffect(() => {
    if (!polling) return
    const id = window.setInterval(() => {
      window.orc.githubStatus().then(setView, () => {})
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [polling])

  if (!open) return null

  const copyCode = async (code: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable: the code stays visible to copy by hand
    }
  }

  const gh = view
  let github: React.ReactNode
  if (!gh) {
    github = (
      <div className="space-y-2" aria-busy="true" data-testid="github-loading">
        <div className="h-3 w-40 animate-pulse rounded bg-muted" />
        <div className="h-7 w-28 animate-pulse rounded bg-muted" />
      </div>
    )
  } else if (gh.state === 'missing') {
    github = (
      <p className="text-[12.5px] text-muted-foreground" data-testid="github-missing">
        Pushing needs the GitHub CLI (<code className="font-mono text-[12px]">gh</code>), which is not installed. Install it from{' '}
        <a className="text-foreground underline underline-offset-2" href="https://cli.github.com" target="_blank" rel="noreferrer">
          https://cli.github.com
        </a>
        , then reopen this screen.
      </p>
    )
  } else if (gh.state === 'disconnected') {
    github = (
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted-foreground">Not connected. Connect a GitHub account to push branches.</p>
        <Button size="sm" variant="outline" disabled={waiting} onClick={() => void connect()} data-testid="github-connect">
          Connect
        </Button>
      </div>
    )
  } else if (gh.state === 'connecting') {
    const code = gh.connecting?.code ?? null
    github = (
      <div className="space-y-2.5" data-testid="github-connecting">
        {code ? (
          <>
            <p className="text-[12.5px] text-muted-foreground">
              Enter this one-time code at{' '}
              <a className="text-foreground underline underline-offset-2" href={gh.connecting?.url} target="_blank" rel="noreferrer">
                {gh.connecting?.url}
              </a>
            </p>
            <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
              <span className="font-mono text-[20px] font-semibold tracking-[0.2em] tabular-nums" data-testid="github-code">{code}</span>
              <Button size="sm" variant="ghost" onClick={() => void copyCode(code)} title="Copy code" aria-label="Copy code">
                {copied ? <CheckCircle2 /> : <Copy />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </>
        ) : (
          <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Loader2 className="animate-spin" /> Waiting for GitHub&apos;s one-time code…
          </p>
        )}
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => void act(() => window.orc.githubCancel())} data-testid="github-cancel">
            Cancel
          </Button>
        </div>
      </div>
    )
  } else {
    github = (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[13px] font-medium" data-testid="github-user">
            <CheckCircle2 className="text-faint" />
            <span className="truncate">@{gh.user}</span>
          </div>
          <p className="mt-0.5 text-[11.5px] text-faint">Push to GitHub uses this account.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void act(() => window.orc.githubDisconnect())} data-testid="github-disconnect">
          Disconnect
        </Button>
      </div>
    )
  }

  const retry = gh?.state === 'disconnected' ? () => void connect() : () => void load()

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Accounts"
        data-testid="accounts-screen"
        className={dialogPanel("md")}
      >
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
          <h2 className="text-[14px] font-semibold">Accounts</h2>
          <Button variant="ghost" size="icon" onClick={onClose} title="Close (Esc)" aria-label="Close">
            <X />
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto border-t px-4 py-4">
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 section-title">
              <UserRound className="size-3" /> GitHub
            </h3>
            {github}
            {gh?.error && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
                <p className="min-w-0 text-[12px] text-destructive" role="alert" data-testid="github-error">{gh.error}</p>
                <Button size="sm" variant="outline" disabled={waiting} onClick={retry} data-testid="github-retry">
                  Retry
                </Button>
              </div>
            )}
          </section>
          {/* SLOT: Claude accounts (owned by accounts-claude) */}
          <ClaudeAccountsSection />
        </div>
      </div>
    </div>
  )
}
