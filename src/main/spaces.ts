import { readFileSync, writeFileSync } from 'node:fs'
import { renameOver } from './rename-over.ts'
import { basename } from 'node:path'
import type { SpaceView } from '../shared/types.ts'
import { repoRoot } from './git-worktrees.ts'
import { defaultRecordsDir } from './records.ts'

export const DefaultMaxLive = 6

interface Settings {
  gateCommand: string | null
  maxLive: number
  /** Where mission records go instead of the default folder. Null: the default. */
  recordsDir: string | null
  runCommand: string | null
}

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
          if (typeof e === 'string') this.roots.push(e)
          else if (e && typeof (e as { root?: unknown }).root === 'string') {
            // `vaultDir` is the setting's name before 2026-11-22.
            const o = e as Partial<Settings> & { root: string; vaultDir?: unknown }
            const dir = typeof o.recordsDir === 'string' ? o.recordsDir : o.vaultDir
            this.roots.push(o.root)
            this.settings.set(o.root, {
              gateCommand: typeof o.gateCommand === 'string' && o.gateCommand ? o.gateCommand : null,
              maxLive: typeof o.maxLive === 'number' && o.maxLive > 0 ? o.maxLive : DefaultMaxLive,
              recordsDir: typeof dir === 'string' && dir ? dir : null,
              runCommand: typeof o.runCommand === 'string' && o.runCommand ? o.runCommand : null
            })
          }
        }
      }
    } catch {}
  }

  private get(root: string): Settings {
    return this.settings.get(root) ?? { gateCommand: null, maxLive: DefaultMaxLive, recordsDir: null, runCommand: null }
  }

  list(): SpaceView[] {
    return this.roots.map((root) => ({ root, name: basename(root), ...this.get(root), recordsPath: this.recordsPath(root) }))
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

  update(root: string, patch: Partial<Settings>): void {
    const next = { ...this.get(root), ...patch }
    next.gateCommand = next.gateCommand?.trim() || null
    next.recordsDir = next.recordsDir?.trim() || null
    next.runCommand = next.runCommand?.trim() || null
    next.maxLive = Math.max(1, Math.min(50, Math.round(next.maxLive) || DefaultMaxLive))
    this.settings.set(root, next)
    this.save()
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
      writeFileSync(tmp, JSON.stringify(this.list().map(({ name: _n, recordsPath: _p, ...rest }) => rest), null, 2))
      renameOver(tmp, this.file)
    } catch {}
  }
}
