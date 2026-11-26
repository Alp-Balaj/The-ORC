export type Accent = 'indigo' | 'blue' | 'violet' | 'green' | 'amber' | 'rose' | 'teal'

/** `swatch` is shown in the picker (dark-theme primary); the real tokens live in app.css. */
export const ACCENTS: { id: Accent; label: string; swatch: string }[] = [
  { id: 'indigo', label: 'Indigo (default)', swatch: '#6a6df0' },
  { id: 'blue', label: 'Blue', swatch: '#3d7bf0' },
  { id: 'violet', label: 'Violet', swatch: '#8b5cf6' },
  { id: 'green', label: 'Green', swatch: '#2fb67c' },
  { id: 'amber', label: 'Amber', swatch: '#e8c13a' },
  { id: 'rose', label: 'Rose', swatch: '#e8456f' },
  { id: 'teal', label: 'Teal', swatch: '#14b8a6' }
]

const KEY = 'orc-accent'
const listeners = new Set<(a: Accent) => void>()

export function getAccent(): Accent {
  try {
    const v = localStorage.getItem(KEY)
    if (ACCENTS.some((a) => a.id === v)) return v as Accent
  } catch {
    // storage unavailable
  }
  return 'indigo'
}

function apply(a: Accent): void {
  const root = document.documentElement
  if (a === 'indigo') delete root.dataset.accent
  else root.dataset.accent = a
  for (const cb of listeners) cb(a)
  // Tint the window/taskbar icon with the live primary color (theme-aware).
  const hex = getComputedStyle(root).getPropertyValue('--color-primary').trim()
  if (/^#[0-9a-f]{6}$/i.test(hex)) window.orc?.setIconAccent(hex)
}

export function setAccent(a: Accent): void {
  try {
    localStorage.setItem(KEY, a)
  } catch {
    // storage unavailable
  }
  apply(a)
}

export function onAccentChange(cb: (a: Accent) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function initAccent(): void {
  apply(getAccent())
}
