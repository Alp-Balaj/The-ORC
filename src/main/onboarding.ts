import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { EnrollmentScan } from '../shared/types.ts'
import { DeniedGitWrites } from './claude-launch.ts'

const run = promisify(execFile)

async function git(cwd: string, ...args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', args, { cwd })
    return stdout.trim()
  } catch {
    return null
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** First package manager whose lockfile or manifest is present. */
async function detectPackageManager(root: string): Promise<string | null> {
  const probes: [string, string][] = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm'],
    ['package.json', 'npm'],
    ['Cargo.toml', 'cargo'],
    ['go.mod', 'go'],
    ['uv.lock', 'uv'],
    ['pyproject.toml', 'pip'],
    ['requirements.txt', 'pip']
  ]
  for (const [file, pm] of probes) if (await exists(join(root, file))) return pm
  return null
}

async function defaultBranchOf(root: string): Promise<string | null> {
  const remote = await git(root, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
  if (remote) return remote.replace(/^origin\//, '') || null
  for (const name of ['main', 'master']) {
    if ((await git(root, 'show-ref', '--verify', '--quiet', `refs/heads/${name}`)) !== null) return name
  }
  return null
}

/** Read-only look at a repo before The ORC enrolls it. Never throws. */
export async function scanRepo(root: string, suggestedGate: string | null): Promise<EnrollmentScan> {
  const empty: EnrollmentScan = {
    root,
    name: basename(root),
    isGitRepo: false,
    branch: null,
    defaultBranch: null,
    dirtyFiles: [],
    hasCommits: false,
    packageManager: null,
    hasClaudeMd: false,
    hasClaudeDir: false,
    claudeSettings: [],
    suggestedGate,
    denyRules: [...DeniedGitWrites],
    mainPermissionMode: 'bypassPermissions',
    missionPermissionMode: 'acceptEdits'
  }
  try {
    if ((await git(root, 'rev-parse', '--is-inside-work-tree')) !== 'true') return empty
    const branchRaw = await git(root, 'rev-parse', '--abbrev-ref', 'HEAD')
    const status = (await git(root, 'status', '--porcelain')) ?? ''
    const dirtyFiles = status
      .split('\n')
      .filter((line) => line.length >= 4)
      .map((line) => line.slice(3).trim().replace(/^"(.*)"$/, '$1'))
      .filter((path) => path && !path.startsWith('.orc/'))
      .slice(0, 50)
    const claudeSettings: string[] = []
    for (const f of ['settings.json', 'settings.local.json']) {
      if (await exists(join(root, '.claude', f))) claudeSettings.push(`.claude/${f}`)
    }
    return {
      ...empty,
      isGitRepo: true,
      branch: branchRaw && branchRaw !== 'HEAD' ? branchRaw : null,
      defaultBranch: await defaultBranchOf(root),
      dirtyFiles,
      hasCommits: (await git(root, 'rev-parse', '--verify', 'HEAD')) !== null,
      packageManager: await detectPackageManager(root),
      hasClaudeMd: await exists(join(root, 'CLAUDE.md')),
      hasClaudeDir: await exists(join(root, '.claude')),
      claudeSettings
    }
  } catch {
    return empty
  }
}

/** A test command that actually exists for a JS project, or null (package.json scripts, then known test configs). */
async function detectTestCommand(root: string, pm: string | null): Promise<string | null> {
  if (pm !== 'npm' && pm !== 'pnpm' && pm !== 'yarn' && pm !== 'bun') return null
  let pkg: { scripts?: Record<string, unknown> } | null = null
  try {
    pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  } catch {
    return null
  }
  const script = pkg?.scripts?.test
  if (typeof script === 'string' && script.trim() && !/no test specified/i.test(script)) return `${pm} test`
  const runner = pm === 'npm' ? 'npx' : pm === 'bun' ? 'bunx' : `${pm} exec`
  const configs: [string, string][] = [
    ['vitest', 'vitest run'],
    ['jest', 'jest'],
    ['playwright', 'playwright test']
  ]
  for (const [tool, cmd] of configs) {
    for (const ext of ['ts', 'js', 'mjs', 'mts', 'cjs']) {
      if (await exists(join(root, `${tool}.config.${ext}`))) return `${runner} ${cmd}`
    }
  }
  return null
}

/** Writes a starter CLAUDE.md. Never overwrites: returns false if one already exists. */
export async function createStarterClaudeMd(root: string): Promise<boolean> {
  const name = basename(root)
  const pm = await detectPackageManager(root)
  const install = pm === 'cargo' ? 'cargo build' : pm === 'go' ? 'go build ./...' : pm ? `${pm} install` : 'TODO: install command'
  const test = pm === 'cargo' ? 'cargo test' : pm === 'go' ? 'go test ./...' : (await detectTestCommand(root, pm)) ?? 'TODO: test command'
  const content = [
    `# ${name}`,
    '',
    'Project notes for Claude Code sessions. Keep it short; update it when the project changes.',
    '',
    '## Commands',
    '',
    `    ${install}   # install dependencies`,
    `    ${test}      # run tests`,
    '',
    '## Conventions',
    '',
    '- TODO: code style, folder layout, naming',
    '',
    '## Rules',
    '',
    '- Work on a branch, never on the default branch.',
    '- Agents never commit. The ORC owns git: commits, merges and pushes are the human\'s.',
    ''
  ].join('\n')
  try {
    await writeFile(join(root, 'CLAUDE.md'), content, { flag: 'wx' })
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw e
  }
}
