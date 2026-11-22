import { initAccent } from './accent'

export type ThemePref = 'light' | 'dark' | 'system'

const KEY = 'orc-theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<(resolved: 'light' | 'dark', pref: ThemePref) => void>()

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // storage unavailable
  }
  return 'system'
}

export function getResolvedTheme(): 'light' | 'dark' {
  const pref = getThemePref()
  if (pref !== 'system') return pref
  return media.matches ? 'dark' : 'light'
}

function apply(): void {
  const pref = getThemePref()
  const resolved = getResolvedTheme()
  const root = document.documentElement
  root.dataset.theme = resolved
  root.style.colorScheme = resolved
  root.style.background = '' // the pre-paint colour from index.html; body paints the token from here
  try {
    window.orc?.setNativeTheme(pref)
  } catch {
    // preload not available
  }
  for (const cb of listeners) cb(resolved, pref)
}

export function setThemePref(p: ThemePref): void {
  try {
    localStorage.setItem(KEY, p)
  } catch {
    // storage unavailable
  }
  apply()
}

export function onThemeChange(cb: (resolved: 'light' | 'dark', pref: ThemePref) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

let initialised = false
export function initTheme(): void {
  if (initialised) return
  initialised = true
  initAccent()
  media.addEventListener('change', () => {
    if (getThemePref() === 'system') apply()
  })
  apply()
}
