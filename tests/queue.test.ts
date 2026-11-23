// Free: the backlog queue's decisions, against fake missions. node --no-warnings tests/queue.test.ts
import type { MissionView, QueueView, StartMissionRequest } from '../src/shared/types.ts'
import { Queues } from '../src/main/queue.ts'

let failed = 0
const ok = (what: string, cond: boolean, d = ''): void => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${d ? ` — ${d}` : ''}`) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function world(maxParallel = 2) {
  const views: MissionView[] = []
  const started: StartMissionRequest[] = []
  let last: QueueView[] = []
  const q = new Queues({
    missions: {
      views: () => views,
      startMission: async (req) => {
        started.push(req)
        const id = `m${started.length}`
        views.push({
          id, name: req.name, repoPath: req.repoPath, baseBranch: 'orc-integration', mainBranch: 'main', queueItemId: req.queueItemId ?? null,
          permissionMode: req.permissionMode, models: {} as MissionView['models'], state: 'running', createdAt: Date.now(), agents: [], feed: [], tokens: 0,
          gating: 'none', split: null, merged: ['w'], integrationCommit: 'c1', gate: null, verifier: null, mergedToMain: null, integrated: null, integrateError: null, paused: false
        })
        return id
      }
    },
    usageThreshold: () => 100,
    maxParallel: () => maxParallel,
    usage: () => null,
    emit: (qs) => { last = qs },
    file: null
  })
  const push = (): void => q.onMissions(views.map((v) => ({ ...v })))
  const queue = () => last[0]
  return { q, views, started, push, queue }
}
const pass = (m: MissionView): void => { m.verifier = { status: 'done', report: 'VERDICT: PASS', templateHash: '', promptHash: '', at: Date.now(), integrationCommit: m.integrationCommit } }

// A mission cleared out before the queue saw it merged -------------------------------
{
  const { q, views, started, push, queue } = world()
  q.onMissions([])
  q.add('/r', 'one', ''); q.add('/r', 'two', ''); q.add('/r', 'three', '')
  q.start('/r', 'bypassPermissions')
  await sleep(20); push(); await sleep(20)
  ok('two items start in parallel', started.length === 2, String(started.length))
  ok('no item is stacked on another mission', started.every((s) => !s.baseBranch))
  views.splice(0, 1) // Merge to main cleared m1 out in the same tick it was marked merged
  push(); await sleep(20)
  ok('a removed mission does not pause the queue', queue().running && !queue().pausedReason, queue().pausedReason ?? '')
  ok('…its item is done', queue().items[0].status === 'done')
  ok('…and the next item starts', started.length === 3)
}

// Verifier passed: done only once integrated ----------------------------------------
{
  const { q, views, push, queue } = world(1)
  q.onMissions([])
  q.add('/r', 'one', ''); q.add('/r', 'two', '')
  q.start('/r', 'bypassPermissions')
  await sleep(20); push()
  pass(views[0]); push(); await sleep(20)
  ok('a passed but not yet integrated item keeps running', queue().items[0].status === 'running')
  views[0].integrated = { commit: 'o1', at: Date.now(), integrationCommit: 'c1' }
  push(); await sleep(20)
  ok('once integrated it is done and the next starts', queue().items[0].status === 'done' && queue().items[1].status === 'running')
  views[1].integrateError = { message: 'Conflicts in a.ts', files: ['a.ts'], at: Date.now() }
  pass(views[1]); push(); await sleep(20)
  ok('an integration conflict pauses the queue, saying so', !queue().running && /integrate into the ORC branch/.test(queue().pausedReason ?? ''), queue().pausedReason ?? '')
  q.start('/r', 'bypassPermissions'); await sleep(20)
  ok('Resume moves past it', queue().items[1].status === 'done' && queue().running)
}

console.log(failed ? `FAIL ${failed}` : 'PASS')
process.exit(failed ? 1 : 0)
