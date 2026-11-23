// Keyboard shortcuts: the single source of truth. Handlers, the cheat sheet, the palette and
// button tooltips all read SHORTCUTS. "Mod" is Cmd on macOS, Ctrl elsewhere.

export const isMac: boolean =
  typeof navigator !== 'undefined' &&
  (navigator.platform || navigator.userAgent).toLowerCase().includes('mac')

export type ShortcutId =
  | 'nextMission'
  | 'prevMission'
  | 'missionN'
  | 'nextAgent'
  | 'prevAgent'
  | 'coordinator'
  | 'jumpNeedsYou'
  | 'focusTerminal'
  | 'palette'
  | 'newMission'
  | 'spaceSettings'
  | 'mergeScreen'
  | 'toggleSidebar'
  | 'toggleTheme'
  | 'shortcuts'
  | 'close'
export type ShortcutGroup = 'Missions' | 'Agents' | 'View' | 'General'
export interface Binding {
  keys: string
  scope: 'global' | 'app'
}
export interface Shortcut {
  id: ShortcutId
  label: string
  group: ShortcutGroup
  bindings: Binding[]
  displayOnly?: boolean
}

const g = (keys: string): Binding => ({ keys, scope: 'global' })
const a = (keys: string): Binding => ({ keys, scope: 'app' })

export const SHORTCUTS: Shortcut[] = [
  // Ctrl on macOS too: Cmd+Tab is the OS app switcher.
  { id: 'nextMission', label: 'Next mission', group: 'Missions', bindings: [g('Ctrl+Tab')] },
  { id: 'prevMission', label: 'Previous mission', group: 'Missions', bindings: [g('Ctrl+Shift+Tab')] },
  { id: 'missionN', label: 'Jump to mission 1–9 (9 is the last)', group: 'Missions', bindings: [g('Mod+Digit')] },
  { id: 'newMission', label: 'New mission', group: 'Missions', bindings: [g('Mod+Shift+N'), a('Mod+N')] },
  { id: 'mergeScreen', label: 'Open Merge to main', group: 'Missions', bindings: [g('Mod+Shift+M')] },
  { id: 'spaceSettings', label: 'Space settings', group: 'Missions', bindings: [g('Mod+,')] },
  { id: 'nextAgent', label: 'Next agent', group: 'Agents', bindings: [g('Alt+ArrowDown')] },
  { id: 'prevAgent', label: 'Previous agent', group: 'Agents', bindings: [g('Alt+ArrowUp')] },
  { id: 'jumpNeedsYou', label: 'Jump to the agent that needs you', group: 'Agents', bindings: [g('Mod+Shift+J')] },
  { id: 'coordinator', label: 'Go to the coordinator', group: 'Agents', bindings: [g('Mod+0')] },
  { id: 'focusTerminal', label: 'Focus the terminal', group: 'Agents', bindings: [g('Mod+`')] },
  { id: 'palette', label: 'Quick switcher', group: 'General', bindings: [a('Mod+K'), a('Mod+P'), g('Mod+Shift+P')] },
  { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'General', bindings: [a('Mod+/'), a('Shift+?'), g('F1')] },
  { id: 'close', label: 'Close dialog / back to terminal', group: 'General', bindings: [g('Escape')], displayOnly: true },
  { id: 'toggleSidebar', label: 'Toggle sidebar', group: 'View', bindings: [a('Mod+B'), g('Mod+Shift+B')] },
  { id: 'toggleTheme', label: 'Cycle theme (light, dark, system)', group: 'View', bindings: [g('Mod+Shift+L')] }
]

export function getShortcut(id: ShortcutId): Shortcut {
  return SHORTCUTS.find((s) => s.id === id)!
}

interface Parsed {
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
  mod: boolean
  key: string
}

function parse(keys: string): Parsed {
  const parts = keys.split('+')
  const key = parts.pop()!
  const has = (m: string): boolean => parts.includes(m)
  const mod = has('Mod')
  return {
    ctrl: has('Ctrl') || (mod && !isMac),
    meta: has('Meta') || (mod && isMac),
    shift: has('Shift'),
    alt: has('Alt'),
    mod,
    key
  }
}

// Punctuation and digits match on e.code, so Shift and keyboard layout don't break them.
const CODES: Record<string, string> = {
  ',': 'Comma',
  '/': 'Slash',
  '?': 'Slash',
  '`': 'Backquote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '.': 'Period',
  ';': 'Semicolon'
}

const KEY_LABELS: Record<string, string> = {
  Digit: '1–9',
  ArrowDown: '↓',
  ArrowUp: '↑',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Tab: 'Tab'
}

export function formatKeys(keys: string): string[] {
  const p = parse(keys)
  const out: string[] = []
  if (isMac) {
    if (p.ctrl) out.push('⌃')
    if (p.alt) out.push('⌥')
    if (p.shift) out.push('⇧')
    if (p.meta) out.push('⌘')
  } else {
    if (p.ctrl) out.push('Ctrl')
    if (p.meta) out.push('Meta')
    if (p.alt) out.push('Alt')
    if (p.shift) out.push('Shift')
  }
  out.push(KEY_LABELS[p.key] ?? (p.key.length === 1 ? p.key.toUpperCase() : p.key))
  return out
}

export function shortcutHint(id: ShortcutId): string {
  return formatKeys(getShortcut(id).bindings[0].keys).join(isMac ? '' : '+')
}

export function withHint(title: string, id: ShortcutId): string {
  return `${title} (${shortcutHint(id)})`
}

function keyMatches(e: KeyboardEvent, key: string): number | null {
  if (key === 'Digit') {
    const m = /^Digit([1-9])$/.exec(e.code)
    return m ? Number(m[1]) : null
  }
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}` ? 0 : null
  if (key in CODES) return e.code === CODES[key] || e.key === key ? 0 : null
  if (key.length === 1) return e.key.toLowerCase() === key.toLowerCase() ? 0 : null
  return e.key === key ? 0 : null
}

export function matchShortcut(
  e: KeyboardEvent,
  where: 'terminal' | 'input' | 'app'
): { id: ShortcutId; arg?: number } | null {
  for (const s of SHORTCUTS) {
    if (s.displayOnly) continue
    for (const b of s.bindings) {
      const p = parse(b.keys)
      if (b.scope === 'app' && where !== 'app' && !(where === 'terminal' && isMac && p.mod)) continue
      if (e.ctrlKey !== p.ctrl || e.metaKey !== p.meta || e.shiftKey !== p.shift || e.altKey !== p.alt) continue
      const r = keyMatches(e, p.key)
      if (r === null) continue
      return r > 0 ? { id: s.id, arg: r } : { id: s.id }
    }
  }
  return null
}

const listeners = new Set<(id: ShortcutId, arg?: number) => void>()

export function onShortcut(cb: (id: ShortcutId, arg?: number) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function emitShortcut(id: ShortcutId, arg?: number): void {
  for (const cb of [...listeners]) cb(id, arg)
}

const REPEATABLE = new Set<ShortcutId>(['nextMission', 'prevMission', 'nextAgent', 'prevAgent'])

function whereOf(target: EventTarget | null): 'terminal' | 'input' | 'app' {
  if (!(target instanceof Element)) return 'app'
  if (target.closest('.xterm')) return 'terminal'
  if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return 'input'
  return 'app'
}

/** Window keydown listener in the capture phase, so it runs before xterm and inputs. */
export function installGlobalShortcuts(): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.isComposing) return
    const m = matchShortcut(e, whereOf(e.target))
    if (!m) return
    e.preventDefault()
    e.stopPropagation()
    if (e.repeat && !REPEATABLE.has(m.id)) return
    emitShortcut(m.id, m.arg)
  }
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}
