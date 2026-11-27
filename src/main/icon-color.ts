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
  // Bitmap is premultiplied BGRA: transparent pixels must stay (0,0,0,0); edges get color*alpha.
  for (let i = 0; i < buf.length; i += 4) {
    const a = buf[i + 3]
    buf[i] = Math.round((b * a) / 255)
    buf[i + 1] = Math.round((g * a) / 255)
    buf[i + 2] = Math.round((r * a) / 255)
  }
  const img = nativeImage.createFromBitmap(buf, { width, height })
  // Taskbar/title bar want ~32/16px; hand Windows a 256px image so it scales cleanly.
  return process.platform === 'win32' && width !== 256 ? img.resize({ width: 256, height: 256, quality: 'best' }) : img
}

let current: string | null = null

/** Sets the app/taskbar icon of every window to the accent color. */
export function applyAccentIcon(hex: string): void {
  const img = accentIcon(hex)
  if (!img) return
  current = hex
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.setIcon(img)
}

export const currentAccentHex = (): string | null => current

/** A single-image .ico (PNG-compressed 256px) in the accent color, or null if the hex is invalid. */
export function accentIcoBuffer(hex: string): Buffer | null {
  const img = accentIcon(hex)
  if (!img) return null
  const png256 = img.resize({ width: 256, height: 256, quality: 'best' }).toPNG()
  const head = Buffer.alloc(22)
  head.writeUInt16LE(1, 2) // type: icon
  head.writeUInt16LE(1, 4) // one image
  head.writeUInt8(0, 6) // 0 = 256 wide
  head.writeUInt8(0, 7) // 0 = 256 high
  head.writeUInt16LE(1, 10) // planes
  head.writeUInt16LE(32, 12) // bpp
  head.writeUInt32LE(png256.length, 14)
  head.writeUInt32LE(22, 18)
  return Buffer.concat([head, png256])
}

export const currentAccentIcon= (): NativeImage | null => (current ? accentIcon(current) : null)
