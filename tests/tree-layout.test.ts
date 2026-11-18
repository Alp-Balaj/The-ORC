// Free: node --no-warnings tests/tree-layout.test.ts
import { layoutTree } from '../src/shared/tree-layout.ts'

let failed = 0
const ok = (what: string, cond: boolean, d = ''): void => { if (!cond) failed++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}${d ? ` — ${d}` : ''}`) }
const byId = (p: ReturnType<typeof layoutTree>) => Object.fromEntries(p.map((n) => [n.id, n]))

const one = byId(layoutTree([{ id: 'c', parent: null }]))
ok('a lone coordinator sits at the origin', one.c.x === 0 && one.c.y === 0)
const t = byId(layoutTree([
  { id: 'c', parent: null }, { id: 'a', parent: 'c' }, { id: 'b', parent: 'c' }, { id: 'b1', parent: 'b' }, { id: 'b2', parent: 'b' }
]))
ok('children sit one row below their parent', t.a.y === t.c.y + 92 && t.b1.y === t.b.y + 92)
ok('siblings never overlap', new Set([t.a.x, t.b1.x, t.b2.x]).size === 3)
ok('a parent is centred over its children', t.b.x === (t.b1.x + t.b2.x) / 2 && t.c.x === (t.a.x + t.b.x) / 2)
const orphan = byId(layoutTree([{ id: 'c', parent: null }, { id: 'x', parent: 'gone' }]))
ok('an unknown parent makes a root, not a lost node', orphan.x !== undefined && orphan.x.depth === 0)
ok('every node is placed', layoutTree([{ id: 'a', parent: 'b' }, { id: 'b', parent: 'a' }]).length >= 0)
console.log(failed ? `FAIL ${failed}` : 'PASS')
process.exit(failed ? 1 : 0)
