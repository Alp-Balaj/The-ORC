import { BrowserWindow, nativeImage, type NativeImage } from 'electron'
import { join } from 'node:path'

/** The glyph is one flat color, so recoloring = replacing RGB and keeping each pixel's alpha. */
const png = (): NativeImage => nativeImage.createFromPath(join(import.meta.dirname, '../../build/icon.png'))

export function accentIcon(hex: string): NativeImage | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  const base = png()
  if (!m || base.isEmpty()) return null
  const r = parseInt(m[1].slice(0, 2), 16)
  const g = parseInt(m[1].slice(2, 4), 16)
  const b = parseInt(m[1].slice(4, 6), 16)
  const { width, height } = base.getSize()
  const buf = base.toBitmap() // BGRA
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = b
    buf[i + 1] = g
    buf[i + 2] = r
  }
  return nativeImage.createFromBitmap(buf, { width, height })
}

let current: string | null = null

/** Sets the app/taskbar icon of every window to the accent color. */
export function applyAccentIcon(hex: string): void {
  const img = accentIcon(hex)
  if (!img) return
  current = hex
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.setIcon(img)
}

export const currentAccentIcon = (): NativeImage | null => (current ? accentIcon(current) : null)
