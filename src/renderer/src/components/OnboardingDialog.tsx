import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, CircleCheck, LoaderCircle, RotateCw, X } from 'lucide-react'
import type { EnrollmentScan } from '../../../shared/types'
import { cn } from '../lib/utils'
import { Button } from './ui/button'

const STEPS = ['Scan', 'Git check', 'Permissions', 'CLAUDE.md and enroll'] as const
const STEP_HELP = [
  'We read this folder to pick sensible defaults. Nothing is changed yet.',
  'Missions need a git repository with at least one commit.',
  'These are the rules Claude sessions in this space run under.',
  'Nothing is saved until you press the button below.',
] as const
type StepIndex = 0 | 1 | 2 | 3

const errText = (err: unknown): string => String(err).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')

function Fact({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[9.5rem_1fr] gap-2 border-b border-border py-1.5 text-[12px] last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-mono text-[11.5px] text-foreground">{children}</dd>
    </div>
  )
}

function CheckRow({ ok, warn, label, detail, children }: { ok: boolean; warn?: boolean; label: string; detail: string; children?: React.ReactNode }): React.JSX.Element {
  const Icon = ok ? CircleCheck : warn ? AlertTriangle : X
  return (
    <li className="flex items-start gap-2.5 py-2" data-ok={ok}>
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', ok ? 'text-working' : warn ? 'text-needs' : 'text-destructive')} />
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-foreground">{label}</div>
        <p className="text-[11.5px] leading-snug text-muted-foreground">{detail}</p>
        {children}
      </div>
    </li>
  )
}

/** Guided enrollment of a repository as a space: scan, git readiness, permissions, CLAUDE.md, then enroll. */
export function OnboardingDialog({ root, rerun = false, onClose, onFinish }: { root: string; rerun?: boolean; onClose: () => void; onFinish: (root: string) => void }): React.JSX.Element {
  const name = root.split(/[\\/]/).pop() || root
  const [step, setStep] = useState<StepIndex>(0)
  const [scan, setScan] = useState<EnrollmentScan | null>(null)
  const [scanning, setScanning] = useState(true)
  const [scanError, setScanError] = useState<string | null>(null)
  const [makeClaudeMd, setMakeClaudeMd] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  const runScan = useCallback(() => {
    setScanning(true)
    setScanError(null)
    window.orc
      .scanRepo(root)
      .then(setScan)
      .catch((err: unknown) => setScanError(errText(err)))
      .finally(() => setScanning(false))
  }, [root])

  useEffect(() => {
    runScan()
  }, [runScan])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const blocking = !scan || !scan.isGitRepo || !scan.hasCommits
  const canNext = step === 0 ? scan !== null : step === 1 ? !blocking : true

  async function finish(): Promise<void> {
    if (!scan) return
    setBusy(true)
    setError(null)
    try {
      if (!scan.hasClaudeMd && makeClaudeMd) await window.orc.createClaudeMd(root)
      await window.orc.enrollSpace(root)
      if (rerun) onClose()
      else onFinish(root)
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  const shownDirty = scan?.dirtyFiles.slice(0, 8) ?? []
  const moreDirty = (scan?.dirtyFiles.length ?? 0) - shownDirty.length

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={rerun ? 'Re-run onboarding' : 'Set up space'} data-testid="onboarding-dialog" className="flex outline-none max-h-[85vh] w-full max-w-[600px] flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl">
        <div className="flex items-start gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-foreground">{rerun ? 'Re-run onboarding' : 'Set up space'}: <span className="font-mono">{name}</span></div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-faint" title={root}>{root}</div>
          </div>
          <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground" data-testid="onboarding-step-indicator">Step {step + 1} of {STEPS.length}</span>
          <Button size="icon" variant="ghost" className="-mr-1.5 size-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={onClose} disabled={busy} title="Close (Esc)" aria-label="Close">
            <X />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <ol className="flex shrink-0 gap-1 overflow-x-auto border-b p-2.5 sm:w-44 sm:flex-col sm:border-b-0 sm:border-r">
            {STEPS.map((label, i) => {
              const done = i < step
              const current = i === step
              return (
                <li key={label} aria-current={current ? 'step' : undefined} className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px]', current && 'bg-selected font-medium text-foreground', !current && !done && 'text-faint', done && 'text-muted-foreground')}>
                  <span className={cn('grid size-4 shrink-0 place-items-center rounded-full border text-[10px] tabular-nums', done ? 'border-transparent bg-primary text-primary-foreground' : current ? 'border-primary text-primary' : 'border-border-strong text-muted-foreground')}>
                    {done ? <Check className="size-2.5" /> : i + 1}
                  </span>
                  <span className="whitespace-nowrap">{label}</span>
                </li>
              )
            })}
          </ol>

          <div className="min-h-[280px] min-w-0 flex-1 overflow-y-auto px-4 py-3" data-testid="onboarding-body">
            <div className="mb-3">
              <h3 className="text-[13px] font-semibold text-foreground">{STEPS[step]}</h3>
              <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{STEP_HELP[step]}</p>
            </div>

            {step === 0 && (
              scanning ? (
                <div className="flex h-full min-h-[240px] items-center justify-center gap-2 text-[12.5px] text-muted-foreground" data-testid="onboarding-scanning">
                  <LoaderCircle className="size-4 animate-spin" /> Scanning {name}…
                </div>
              ) : scanError ? (
                <div className="space-y-2.5 py-2" data-testid="onboarding-scan-error">
                  <div className="flex items-start gap-2 text-[12.5px] text-destructive"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Couldn't scan this folder: {scanError}</div>
                  <Button size="sm" variant="outline" className="h-7" onClick={runScan}><RotateCw /> Retry</Button>
                </div>
              ) : scan ? (
                <dl data-testid="onboarding-scan">
                  <Fact label="Branch">{scan.branch ?? (scan.isGitRepo ? 'detached' : 'not a git repository')}</Fact>
                  <Fact label="Default branch">{scan.defaultBranch ?? 'unknown'}</Fact>
                  <Fact label="Package manager">{scan.packageManager ?? 'not detected'}</Fact>
                  <Fact label="CLAUDE.md">{scan.hasClaudeMd ? 'found' : 'not found'}</Fact>
                  <Fact label=".claude folder">{scan.hasClaudeDir ? 'found' : 'not found'}</Fact>
                  <Fact label="Settings files">{scan.claudeSettings.length > 0 ? scan.claudeSettings.join(', ') : 'none'}</Fact>
                  <Fact label="Suggested gate">{scan.suggestedGate ?? 'none'}</Fact>
                </dl>
              ) : (
                <div className="flex items-center justify-between gap-2 py-2 text-[12.5px] text-muted-foreground" data-testid="onboarding-scan-empty">
                  <span>No scan results yet.</span>
                  <Button size="sm" variant="outline" className="h-7" onClick={runScan}><RotateCw /> Scan again</Button>
                </div>
              )
            )}

            {step === 1 && scan && (
              <div data-testid="onboarding-git">
                <ul className="divide-y divide-border">
                  <CheckRow ok={scan.isGitRepo} label={scan.isGitRepo ? 'Git repository' : 'Not a git repository'} detail={scan.isGitRepo ? 'Missions branch worktrees from this repository.' : 'Run git init in this folder, then make a first commit.'} />
                  {scan.isGitRepo && (
                    <CheckRow ok={scan.hasCommits} label={scan.hasCommits ? 'Has commits' : 'No commits yet'} detail={scan.hasCommits ? 'There is committed state to branch from.' : 'Make a first commit (git add, then git commit). Worktrees branch from committed state.'} />
                  )}
                  {scan.isGitRepo && scan.hasCommits && (
                    <CheckRow ok={scan.dirtyFiles.length === 0} warn label={scan.dirtyFiles.length === 0 ? 'Working tree clean' : `${scan.dirtyFiles.length} uncommitted ${scan.dirtyFiles.length === 1 ? 'change' : 'changes'}`} detail="Worktrees branch from committed state; uncommitted changes won't be in a mission. You can continue.">
                      {shownDirty.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 rounded-md border bg-background/60 px-2 py-1.5 font-mono text-[11px] text-muted-foreground" data-testid="onboarding-dirty">
                          {shownDirty.map((f) => <li key={f} className="truncate" title={f}>{f}</li>)}
                          {moreDirty > 0 && <li className="font-sans text-faint">and {moreDirty} more</li>}
                        </ul>
                      )}
                    </CheckRow>
                  )}
                </ul>
                {blocking && (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-needs/40 px-2.5 py-2 text-[12px] text-muted-foreground">
                    <span>Fix this in the repository, then re-scan. Next unlocks once git is ready.</span>
                    <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={runScan} disabled={scanning} data-testid="onboarding-rescan"><RotateCw /> Re-scan</Button>
                  </div>
                )}
              </div>
            )}

            {step === 2 && scan && (
              <div className="space-y-3" data-testid="onboarding-permissions">
                <dl>
                  <Fact label="Main session">{scan.mainPermissionMode}</Fact>
                  <Fact label="Default mission mode">{scan.missionPermissionMode}</Fact>
                </dl>
                <p className="text-[11.5px] leading-snug text-muted-foreground">Missions can pick another mode when they start. Every session in one mission uses the same mode.</p>
                <div>
                  <div className="mb-1 text-[12px] font-medium text-foreground">Git-write rules</div>
                  <ul className="space-y-0.5 rounded-md border bg-background/60 px-2 py-1.5 font-mono text-[11px] text-muted-foreground" data-testid="onboarding-deny-rules">
                    {scan.denyRules.map((r) => <li key={r} className="truncate" title={r}>{r}</li>)}
                  </ul>
                  <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">The ORC applies these to every session; agents never commit, The ORC owns git.</p>
                </div>
              </div>
            )}

            {step === 3 && scan && (
              <div className="space-y-3" data-testid="onboarding-confirm">
                {scan.hasClaudeMd ? (
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">Your existing CLAUDE.md is kept as it is.</p>
                ) : (
                  <label className="flex items-start gap-2.5 rounded-md border p-2.5 text-[12.5px]">
                    <input type="checkbox" checked={makeClaudeMd} onChange={(e) => setMakeClaudeMd(e.target.checked)} className="mt-0.5 accent-primary" data-testid="onboarding-claude-md" />
                    <span className="min-w-0">
                      <span className="block font-medium text-foreground">Create a starter CLAUDE.md</span>
                      <span className="block text-[11.5px] leading-snug text-muted-foreground">Created only because this repository has none. An existing file is never overwritten.</span>
                    </span>
                  </label>
                )}
                <p className="text-[11.5px] leading-snug text-muted-foreground">
                  {rerun ? 'Saving keeps this space enrolled and closes the dialog.' : 'Enrolling marks this repository as a space. Next you start its first mission.'}
                </p>
                {error && <div className="rounded-md border border-destructive/40 px-2.5 py-1.5 text-[12px] text-destructive" data-testid="onboarding-error">Couldn't enroll: {error}</div>}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5">
          <Button size="sm" variant="ghost" className="h-7 text-muted-foreground hover:text-foreground" onClick={() => setStep((s) => (s - 1) as StepIndex)} disabled={step === 0 || busy} data-testid="onboarding-back">
            Back
          </Button>
          {step < 3 ? (
            <Button size="sm" className="h-7" onClick={() => setStep((s) => (s + 1) as StepIndex)} disabled={!canNext} data-testid="onboarding-next">
              Next
            </Button>
          ) : (
            <Button size="sm" className="h-7" onClick={() => void finish()} disabled={busy || !scan} data-testid="onboarding-finish">
              {busy && <LoaderCircle className="animate-spin" />}
              {busy ? (rerun ? 'Saving…' : 'Enrolling…') : rerun ? 'Save and close' : 'Enroll and start first mission'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
