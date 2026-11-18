// Free: drives Missions' status logic with recorded hook payloads. No claude is started.
// node --no-warnings tests/missions-status.test.ts
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Missions } from '../src/main/missions.ts'
import type { TerminalHost } from '../src/main/terminals.ts'

const started: string[] = []
const fakeHost = { start: (s: { id: string }) => started.push(s.id), killAll: () => {} } as unknown as TerminalHost
const m = new Missions(fakeHost, () => {})
const id = await m.startMission({ repoPath: join(homedir(), 'Documents/Projects/orc-sandbox'), name: 'status test', permissionMode: 'acceptEdits' })
const t = `${id}:coordinator`
const a = () => m.views()[0].agents[0]
const sid = a().sessionId
let failed = 0
const expect = (what: string, status: string): void => {
  const ok = a().status === status
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${a().status} | ${a().activity}${ok ? '' : ` (wanted ${status})`}`)
}
const hook = (e: Record<string, unknown>) => m.hookEvent(t, e as never)

expect('launched', 'starting')
hook({ hook_event_name: 'SessionStart' }); expect('SessionStart', 'idle')
hook({ hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' }); expect('idle notification keeps idle', 'idle')
hook({ hook_event_name: 'UserPromptSubmit', prompt: 'do it' }); expect('prompt', 'working')
hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }); expect('tool', 'working')
m.reconcile(new Map([[sid, 'waiting']])); expect('poller sees waiting', 'needs-you')
hook({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission' }); expect('permission notification', 'needs-you')
m.reconcile(new Map([[sid, 'waiting']])); expect('still waiting', 'needs-you')
hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash' }); expect('approved: tool ran', 'working')
hook({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission' }); expect('second prompt', 'needs-you')
m.reconcile(new Map([[sid, 'idle']])); expect('one idle poll is not enough', 'needs-you')
m.reconcile(new Map([[sid, 'idle']])); expect('Esc: two idle polls', 'idle')
hook({ hook_event_name: 'UserPromptSubmit', prompt: '<cross-session-message from="uds:x" from-name="m/worker-a" from-mode="prompting">\nhi' })
expect('cross-session message starts a turn', 'working')
if (!a().activity.includes('worker-a')) { failed++; console.log('FAIL activity names the sender:', a().activity) }
m.askHuman(t, 'which colour?'); expect('ask_human', 'needs-you')
hook({ hook_event_name: 'Stop' }); expect('question survives Stop', 'needs-you')
m.reconcile(new Map([[sid, 'idle']])); m.reconcile(new Map([[sid, 'idle']])); expect('question survives idle polls', 'needs-you')
hook({ hook_event_name: 'UserPromptSubmit', prompt: 'blue' }); expect('answer', 'working')
m.reportDone(t, 'did it'); expect('report_done', 'done')
hook({ hook_event_name: 'PreToolUse', tool_name: 'SendMessage' }); expect('done stays done during SendMessage', 'done')
hook({ hook_event_name: 'Stop' }); expect('done stays done after Stop', 'done')
hook({ hook_event_name: 'SessionEnd' }); expect('SessionEnd', 'exited')
console.log(failed ? `FAIL ${failed}` : 'PASS')
process.exit(failed ? 1 : 0)
