import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { SpaceView } from '../shared/types.ts'
import { repoRoot } from './git-worktrees.ts'

/** The repositories the user has opened, in order. Saved to a JSON file so they come back
 *  after a restart (missions themselves don't, until M4). `file: null` keeps them in memory. */
export class Spaces {
  private roots: string[] = []
  private readonly gates = new Map<string, string>()
  private readonly file: string | null

  constructor(file: string | null) {
    this.file = file
    if (file) {
      try {
        const saved = JSON.parse(readFileSync(file, 'utf8')) as unknown
        // v1 saved plain paths; v2 saves { root, gateCommand }.
        if (Array.isArray(saved)) {
          for (const e of saved as unknown[]) {
            if (typeof e === 'string') this.roots.push(e)
            else if (e && typeof (e as { root?: unknown }).root === 'string') {
              const { root, gateCommand } = e as { root: string; gateCommand?: unknown }
              this.roots.push(root)
              if (typeof gateCommand === 'string' && gateCommand) this.gates.set(root, gateCommand)
            }
          }
        }
      } catch {}
    }
  }

  list(): SpaceView[] {
    return this.roots.map((root) => ({ root, name: basename(root), gateCommand: this.gates.get(root) ?? null }))
  }

  gateCommand(root: string): string | null {
    return this.gates.get(root) ?? null
  }

  setGateCommand(root: string, command: string | null): void {
    if (command?.trim()) this.gates.set(root, command.trim())
    else this.gates.delete(root)
    this.save()
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
      writeFileSync(this.file, JSON.stringify(this.list().map(({ root, gateCommand }) => ({ root, gateCommand })), null, 2))
    } catch {}
  }
}
