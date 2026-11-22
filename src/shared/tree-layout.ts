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

export function layoutTree(nodes: TreeInput[], gapX = 170, gapY = 92): Placed[] {
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

export interface Sized extends Placed {
  w: number
  h: number
}

/** Sizes for layoutStacked. Card: coordinator and leads (depth 0 and 1). Row: the slim
 *  one-line node for everything deeper. `trunk`: how far in from a parent's left edge the
 *  line down into its stacked children runs; `indent` keeps each child's left edge right of
 *  that line, so the elbow (down, then right) never doubles back. */
export const stackSizes = { cardW: 128, cardH: 46, rowW: 120, rowH: 28, gapX: 14, gapY: 36, rowGap: 6, indent: 14, trunk: 7, stackTop: 10 }

/** The "stacked graph": depth 0 and 1 (coordinator and leads) are laid out as a tree, side by
 *  side; everything below a lead goes in one vertical column under it, each depth indented a
 *  step further. Width grows with the number of leads, not workers. Positions are top-left
 *  corners. Pure. */
export function layoutStacked(nodes: TreeInput[], s = stackSizes): Sized[] {
  const depth = new Map(layoutTree(nodes).map((p) => [p.id, p.depth]))
  const top = nodes.filter((n) => (depth.get(n.id) ?? 0) <= 1)
  const out = new Map<string, Sized>()
  for (const p of layoutTree(top, s.cardW + s.gapX, s.cardH + s.gapY)) out.set(p.id, { ...p, w: s.cardW, h: s.cardH })
  const ids = new Set(nodes.map((n) => n.id))
  const children = new Map<string, string[]>()
  for (const n of nodes) if (n.parent && ids.has(n.parent)) children.set(n.parent, [...(children.get(n.parent) ?? []), n.id])
  for (const lead of [...out.values()]) {
    if (lead.depth !== 1) continue
    let y = lead.y + s.cardH + s.stackTop
    const seen = new Set([lead.id])
    const walk = (id: string, d: number): void => {
      for (const kid of children.get(id) ?? []) {
        if (seen.has(kid)) continue
        seen.add(kid)
        const inset = s.indent * (d - 1)
        out.set(kid, { id: kid, x: lead.x + inset, y, depth: d, w: Math.max(60, s.rowW + s.indent - inset), h: s.rowH })
        y += s.rowH + s.rowGap
        walk(kid, d + 1)
      }
    }
    walk(lead.id, 2)
  }
  return nodes.map((n) => out.get(n.id)!).filter(Boolean)
}
