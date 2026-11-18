import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { SpaceView } from '../shared/types.ts'
import { repoRoot } from './git-worktrees.ts'

/** The repositories the user has opened, in order. Saved to a JSON file so they come back
 *  after a restart (missions themselves don't, until M4). `file: null` keeps them in memory. */
export class Spaces {
  private roots: string[] = []
  private readonly file: string | null

  constructor(file: string | null) {
    this.file = file
    if (file) {
      try {
        const saved = JSON.parse(readFileSync(file, 'utf8')) as unknown
        if (Array.isArray(saved)) this.roots = saved.filter((r): r is string => typeof r === 'string')
      } catch {}
    }
  }

  list(): SpaceView[] {
    return this.roots.map((root) => ({ root, name: basename(root) }))
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
      writeFileSync(this.file, JSON.stringify(this.roots, null, 2))
    } catch {}
  }
}
