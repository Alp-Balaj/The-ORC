import { getResolvedTheme, onThemeChange } from './theme'

export type Background = 'graphite' | 'midnight' | 'charcoal' | 'black' | 'white' | 'paper' | 'cool'
type Mode = 'light' | 'dark'

/** `bg`/`card` paint the picker swatch (page background + raised surface); the real tokens live in app.css. */
export const BACKGROUNDS: { id: Background; mode: Mode; label: string; bg: string; card: string }[] = [
  { id: 'graphite', mode: 'dark', label: 'Graphite (default)', bg: '#0b0b0d', card: '#16171a' },
  { id: 'midnight', mode: 'dark', label: 'Midnight', bg: '#080c14', card: '#121927' },
  { id: 'charcoal', mode: 'dark', label: 'Warm charcoal', bg: '#0f0e0d', card: '#1c1a18' },
  { id: 'black', mode: 'dark', label: 'True black', bg: '#000000', card: '#0d0d0d' },
  { id: 'white', mode: 'light', label: 'White (default)', bg: '#f7f7f8', card: '#ffffff' },
  { id: 'paper', mode: 'light', label: 'Paper', bg: '#f5f1ea', card: '#fdfbf7' },
  { id: 'cool', mode: 'light', label: 'Cool gray', bg: '#eceef2', card: '#fafbfc' }
]

const DEFAULTS: Record<Mode, Background> = { dark: 'graphite', light: 'white' }
const key = (m: Mode): string => `orc-bg-${m}`
const listeners = new Set<() => void>()

/** The chosen palette for a mode (each mode remembers its own). */
export function getBackground(mode: Mode = getResolvedTheme()): Background {
  try {
    const v = localStorage.getItem(key(mode))
    const found = BACKGROUNDS.find((b) => b.id === v && b.mode === mode)
    if (found) return found.id
  } catch {
    // storage unavailable
  }
  return DEFAULTS[mode]
}

/** Sets data-bg for the current mode (absent = the mode's default palette). */
export function applyBackground(): void {
  const root = document.documentElement
  const b = getBackground()
  if (b === DEFAULTS[getResolvedTheme()]) delete root.dataset.bg
  else root.dataset.bg = b
  for (const cb of listeners) cb()
}

export function setBackground(b: Background): void {
  const mode = BACKGROUNDS.find((x) => x.id === b)!.mode
  try {
    localStorage.setItem(key(mode), b)
  } catch {
    // storage unavailable
  }
  if (mode === getResolvedTheme()) applyBackground()
}

/** Fires when the palette changes (including via a light/dark switch). */
export function onBackgroundChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function initBackground(): void {
  onThemeChange(() => applyBackground())
  applyBackground()
}

/** Terminal background: matches the surface it sits on (dark: page background; light: panel). */
export function terminalBackground(): string {
  const s = getComputedStyle(document.documentElement)
  return s.getPropertyValue(getResolvedTheme() === 'light' ? '--color-panel' : '--color-background').trim()
}
