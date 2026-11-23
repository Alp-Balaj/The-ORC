import { readFileSync, writeFileSync } from 'node:fs'
import { renameOver } from './rename-over.ts'
import { basename } from 'node:path'
import { ModelRoles, type RoleModels, type SpaceView } from '../shared/types.ts'
import { repoRoot } from './git-worktrees.ts'
import { defaultRecordsDir } from './records.ts'
import { suggestGate } from './gate-suggest.ts'

export const DefaultMaxLive = 6
export const DefaultUsageThreshold = 80
export const DefaultIdleStopMinutes = 15
export const DefaultMaxParallel = 2
const clampParallel = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.min(10, Math.round(n))) : DefaultMaxParallel

/** Known roles with a non-empty string (trimmed); an explicit null is kept for advisor only
 *  ("no advisor"). Anything else is dropped. */
function cleanModels(v: unknown): Partial<RoleModels> {
  const out: Partial<RoleModels> = {}
  if (!v || typeof v !== 'object') return out
  for (const role of ModelRoles) {
    const m = (v as Record<string, unknown>)[role]
    if (typeof m === 'string' && m.trim()) out[role] = m.trim()
    else if (m === null && role === 'advisor') out[role] = null
  }
  return out
}

const clampThreshold = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.min(100, Math.round(n))) : DefaultUsageThreshold

const clampIdleStop = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1440, Math.round(n))) : DefaultIdleStopMinutes

interface Settings {
  gateCommand: string | null
  maxLive: number
  /** Where mission records go instead of the default folder. Null: the default. */
  recordsDir: string | null
  runCommand: string | null
  models: Partial<RoleModels>
  /** Plan usage % at which this space's queue pauses. */
  usageThreshold: number
  /** Minutes after which a finished lead's session is stopped. 0: never. */
  idleStopMinutes: number
  /** Most backlog-queue items running at once. 1: one at a time, each stacked on the last. */
  maxParallel: number
  /** Desktop notifications (and the needs-you badge) for this space's missions. */
  notifications: boolean
  /** Verified queue missions are integrated into the ORC branch on their own. Default on. */
  autoIntegrate: boolean
  /** Onboarding finished for this space (epoch ms), or null: not enrolled yet. */
  enrolledAt: number | null
}

/** A saved enrolledAt: numbers and null are kept; anything else (no key: saved before
 *  onboarding existed) counts as enrolled now. */
const cleanEnrolledAt = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : v === null ? null : Date.now())

/** The repositories the user has opened, in order, with per-space settings. Saved to a JSON
 *  file so they come back after a restart. `file: null` keeps them in memory (tests). */
export class Spaces {
  private roots: string[] = []
  private readonly settings = new Map<string, Settings>()
  private readonly file: string | null

  /** Base folder for the default mission records (`<userData>/records`). */
  private readonly recordsBase: string

  constructor(file: string | null, recordsBase: string) {
    this.file = file
    this.recordsBase = recordsBase
    if (!file) return
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as unknown
      // v1 saved plain paths; v2 saves objects.
      if (Array.isArray(saved)) {
        for (const e of saved as unknown[]) {
          // Plain paths are v1 spaces saved before onboarding existed: enrolled.
          if (typeof e === 'string') {
            this.roots.push(e)
            this.settings.set(e, { ...this.get(e), enrolledAt: Date.now() })
          }
          else if (e && typeof (e as { root?: unknown }).root === 'string') {
            // `vaultDir` is the setting's name before 2026-11-22.
            const o = e as Partial<Settings> & { root: string; vaultDir?: unknown }
            const dir = typeof o.recordsDir === 'string' ? o.recordsDir : o.vaultDir
            this.roots.push(o.root)
            this.settings.set(o.root, {
              enrolledAt: cleanEnrolledAt(o.enrolledAt),
              gateCommand: typeof o.gateCommand === 'string' && o.gateCommand ? o.gateCommand : null,
              maxLive: typeof o.maxLive === 'number' && o.maxLive > 0 ? o.maxLive : DefaultMaxLive,
              recordsDir: typeof dir === 'string' && dir ? dir : null,
              runCommand: typeof o.runCommand === 'string' && o.runCommand ? o.runCommand : null,
              models: cleanModels(o.models),
              usageThreshold: clampThreshold(o.usageThreshold),
              idleStopMinutes: clampIdleStop(o.idleStopMinutes),
              maxParallel: clampParallel(o.maxParallel),
              notifications: o.notifications !== false,
              autoIntegrate: o.autoIntegrate !== false
            })
          }
        }
      } else {
        console.error(`spaces: ${file} is not a JSON array (unexpected shape); starting with defaults`)
      }
    } catch (err) {
      // A missing file is the normal first run: stay silent. Anything else (unreadable, corrupt JSON) is logged.
      // On failure we fall back to defaults (no spaces, default settings); the next save() will overwrite the corrupt file.
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.error(`spaces: failed to load ${file}; falling back to defaults (the next save will overwrite it):`, err)
      }
    }
  }

  private get(root: string): Settings {
    return this.settings.get(root) ?? { gateCommand: null, maxLive: DefaultMaxLive, recordsDir: null, runCommand: null, models: {}, usageThreshold: DefaultUsageThreshold, idleStopMinutes: DefaultIdleStopMinutes, maxParallel: DefaultMaxParallel, notifications: true, autoIntegrate: true, enrolledAt: null }
  }

  /** suggestGate per root, read once. */
  private readonly suggestions = new Map<string, string | null>()

  private suggestion(root: string): string | null {
    if (!this.suggestions.has(root)) this.suggestions.set(root, suggestGate(root))
    return this.suggestions.get(root) ?? null
  }

  list(): SpaceView[] {
    return this.roots.map((root) => {
      const s = this.get(root)
      return { root, name: basename(root), ...s, recordsPath: this.recordsPath(root), suggestedGate: s.gateCommand ? null : this.suggestion(root) }
    })
  }

  gateCommand(root: string): string | null {
    return this.get(root).gateCommand
  }

  maxLive(root: string): number {
    return this.get(root).maxLive
  }

  /** Where this space's mission records go: its own folder if set, else the default. */
  recordsPath(root: string): string {
    return this.get(root).recordsDir ?? defaultRecordsDir(this.recordsBase, root)
  }

  runCommand(root: string): string | null {
    return this.get(root).runCommand
  }

  models(root: string): Partial<RoleModels> {
    return this.get(root).models
  }

  usageThreshold(root: string): number {
    return this.get(root).usageThreshold
  }

  idleStopMinutes(root: string): number {
    return this.get(root).idleStopMinutes
  }

  maxParallel(root: string): number {
    return this.get(root).maxParallel
  }

  notifications(root: string): boolean {
    return this.get(root).notifications
  }

  autoIntegrate(root: string): boolean {
    return this.get(root).autoIntegrate
  }

  update(root: string, patch: Partial<Settings>): void {
    const next = { ...this.get(root), ...patch }
    next.gateCommand = next.gateCommand?.trim() || null
    next.recordsDir = next.recordsDir?.trim() || null
    next.runCommand = next.runCommand?.trim() || null
    next.maxLive = Math.max(1, Math.min(50, Math.round(next.maxLive) || DefaultMaxLive))
    next.models = cleanModels(next.models)
    next.usageThreshold = clampThreshold(next.usageThreshold)
    next.idleStopMinutes = clampIdleStop(next.idleStopMinutes)
    next.maxParallel = clampParallel(next.maxParallel)
    next.notifications = next.notifications !== false
    next.autoIntegrate = next.autoIntegrate !== false
    this.settings.set(root, next)
    this.save()
  }

  enroll(root: string): void {
    this.update(root, { enrolledAt: Date.now() })
  }

  unenroll(root: string): void {
    this.update(root, { enrolledAt: null })
  }

  setGateCommand(root: string, command: string | null): void {
    this.update(root, { gateCommand: command })
  }

  /** Adds the repository containing `path` (must be a git repo). Returns its root. */
  async add(path: string): Promise<string> {
    let root: string
    try {
      root = await repoRoot(path)
    } catch {
      throw new Error(`${path} is not inside a git repository`)
    }
    if (!this.roots.includes(root)) {
      // A new space starts with the suggested gate; existing ones only show it as a hint.
      if (!this.settings.has(root)) {
        const gate = this.suggestion(root)
        if (gate) this.settings.set(root, { ...this.get(root), gateCommand: gate })
      }
      // In-memory spaces (tests, smoke) skip onboarding; saved ones start unenrolled.
      if (this.file === null) this.update(root, { enrolledAt: Date.now() })
      this.roots.push(root)
      this.save()
    }
    return root
  }

  remove(root: string): void {
    this.roots = this.roots.filter((r) => r !== root)
    this.save()
  }

  private save(): void {
    if (!this.file) return
    try {
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.list().map(({ name: _n, recordsPath: _p, suggestedGate: _g, ...rest }) => rest), null, 2))
      renameOver(tmp, this.file)
    } catch (err) {
      console.error(`spaces: could not save ${this.file}`, err)
    }
  }
}
