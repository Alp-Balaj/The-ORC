// Free: Run app keeps one app at a time and frees the old one's port before starting the next.
// Fake terminals; the real kill (taskkill / process group) runs in the replay.
// node --no-warnings tests/app-runner.test.ts
import { AppRunner, appTerminalId, isPowerShellCommand, shellArgs } from '../src/main/app-runner.ts'
import type { AppRunView } from '../src/shared/types.ts'
import type { TerminalHost } from '../src/main/terminals.ts'

let failed = 0
const ok = (what: string, cond: boolean, d = ''): void => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${d ? ` — ${d}` : ''}`) }

const running = new Set<string>()
const events: string[] = []
let runner: AppRunner
const host = {
  start: (s: { id: string; args: string[]; cwd: string }) => {
    if (running.has(s.id)) throw new Error(`terminal ${s.id} already running`)
    running.add(s.id); events.push(`start ${s.id} ${s.cwd} ${s.args.join(' ')}`)
  },
  // Exits late, as a real process does after its signal.
  kill: (id: string) => { events.push(`kill ${id}`); setTimeout(() => { if (running.delete(id)) runner.terminalExited(id, 1) }, 150) },
  isRunning: (id: string) => running.has(id),
  pid: (id: string) => (running.has(id) ? 4242 : null)
} as unknown as TerminalHost
const seen: (AppRunView | null)[] = []
runner = new AppRunner(host, (r) => seen.push(r))
runner.killTree = (pid) => events.push(`killTree ${pid}`)
runner.shell = () => 'bash'

await runner.run('m1', 'ui-fixes', '/r/.orc/worktrees/ui-fixes/_integration', 'pnpm dev')
ok('runs the command in the mission\'s integration worktree', events.join() === `start ${appTerminalId('m1')} /r/.orc/worktrees/ui-fixes/_integration -lc pnpm dev`, events.join())
ok('reports it running', runner.view()?.missionId === 'm1' && runner.view()?.status === 'running')

events.length = 0
await runner.run('m2', 'buttons', '/r/.orc/worktrees/buttons/_integration', 'pnpm dev')
ok('switching ends the first app (its whole tree) before starting the second', events.join() === `killTree 4242,kill ${appTerminalId('m1')},start ${appTerminalId('m2')} /r/.orc/worktrees/buttons/_integration -lc pnpm dev`, events.join())
ok('…and the first had exited by then', !running.has(appTerminalId('m1')))
ok('only the second is current', runner.view()?.missionId === 'm2' && runner.view()?.status === 'running')
ok('a late exit of the old app does not mark the new one exited', seen.at(-1)?.missionId === 'm2' && seen.at(-1)?.status === 'running')

events.length = 0
await runner.run('m2', 'buttons', '/r/.orc/worktrees/buttons/_integration', 'pnpm dev')
ok('running the same mission again restarts it', events.join() === `killTree 4242,kill ${appTerminalId('m2')},start ${appTerminalId('m2')} /r/.orc/worktrees/buttons/_integration -lc pnpm dev`, events.join())

await runner.stopFor('m1')
ok('stopFor another mission leaves the app alone', running.has(appTerminalId('m2')))
await runner.stopFor('m2')
await new Promise((r) => setTimeout(r, 20))
ok('stopFor its own mission ends it, and it shows exited', !running.has(appTerminalId('m2')) && runner.view()?.status === 'exited')

// A process that never exits: the switch is refused with a reason instead of clashing on the port.
await runner.run('m1', 'ui-fixes', '/x', 'pnpm dev')
host.kill = () => {}
runner.exitWaitMs = 300
let threw = ''
try { await runner.run('m2', 'buttons', '/y', 'pnpm dev') } catch (e) { threw = String(e) }
ok('an app that will not exit blocks the switch, with a reason', /ui-fixes's app has not exited/.test(threw) && runner.view()?.missionId === 'm1', threw)

// A PowerShell script runs through PowerShell; bash would read it as a bash script.
for (const c of ['./run-dev.ps1', '.\run-dev.ps1 -NoBuild', 'run-dev.ps1', "& './run dev.ps1'", 'scripts/dev.PS1']) ok(`"${c}" is a PowerShell command`, isPowerShellCommand(c))
for (const c of ['pnpm dev', './run-dev.sh', 'pnpm install && pnpm dev', 'echo x.ps1x']) ok(`"${c}" is not`, !isPowerShellCommand(c))
const ps = shellArgs('./run-dev.ps1 -NoBuild', 'bash', () => 'pwsh')
ok('a .ps1 command runs with PowerShell -Command, policy bypassed for that process', ps.command === 'pwsh' && ps.args.join(' ') === '-NoLogo -NoProfile -ExecutionPolicy Bypass -Command ./run-dev.ps1 -NoBuild', JSON.stringify(ps))
ok('anything else runs with bash -lc', JSON.stringify(shellArgs('pnpm dev', 'bash', () => 'pwsh')) === JSON.stringify({ command: 'bash', args: ['-lc', 'pnpm dev'] }))

console.log(failed ? `FAIL ${failed}` : 'PASS')
process.exit(failed ? 1 : 0)
