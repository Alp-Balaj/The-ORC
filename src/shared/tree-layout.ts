/** Lays a mission's agents out as a top-down tree: parents above children, leaves spread
 *  left to right, each parent centred over its children. Pure, so it is unit-tested. */
export interface TreeInput {
  id: string
  parent: string | null
}

export interface Placed {
  id: string
  x: number
  y: number
  depth: number
}

export function layoutTree(nodes: TreeInput[], gapX = 148, gapY = 92): Placed[] {
  const ids = new Set(nodes.map((n) => n.id))
  const children = new Map<string | null, string[]>()
  for (const n of nodes) {
    // A node whose parent is unknown is treated as a root, so nothing disappears.
    const p = n.parent && ids.has(n.parent) ? n.parent : null
    children.set(p, [...(children.get(p) ?? []), n.id])
  }
  const out = new Map<string, Placed>()
  let nextLeaf = 0
  const place = (id: string, depth: number, seen: Set<string>): number => {
    if (seen.has(id)) return nextLeaf * gapX // cycle guard
    seen.add(id)
    const kids = children.get(id) ?? []
    let x: number
    if (kids.length === 0) x = nextLeaf++ * gapX
    else {
      const xs = kids.map((k) => place(k, depth + 1, seen))
      x = (Math.min(...xs) + Math.max(...xs)) / 2
    }
    out.set(id, { id, x, y: depth * gapY, depth })
    return x
  }
  for (const root of children.get(null) ?? []) place(root, 0, new Set())
  return nodes.map((n) => out.get(n.id)!).filter(Boolean)
}
