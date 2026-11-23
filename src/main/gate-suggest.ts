import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** A gate command to suggest for a repository: its package.json `typecheck` script, run with
 *  the package manager its lockfile names (npm when there is none). Null when there is no
 *  such script. */
export function suggestGate(root: string): string | null {
  let scripts: unknown
  try {
    scripts = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: unknown }).scripts
  } catch (err) {
    // No package.json is normal (not a Node project); anything else is worth a log line.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') console.error(`gate-suggest: could not read package.json in ${root}; no gate suggested:`, err)
    return null
  }
  if (!scripts || typeof scripts !== 'object' || typeof (scripts as Record<string, unknown>).typecheck !== 'string') return null
  const has = (f: string): boolean => existsSync(join(root, f))
  if (has('pnpm-lock.yaml')) return 'pnpm typecheck'
  if (has('yarn.lock')) return 'yarn typecheck'
  if (has('bun.lockb') || has('bun.lock')) return 'bun run typecheck'
  return 'npm run typecheck'
}
