// Regenerates build/icon.png (512px) and build/icon.ico (16-256px) from the geometry in icon.svg.
// Run: node build/make-icons.mjs   (no dependencies)
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { join } from 'node:path'

const BG = [22, 24, 29], FG = [255, 138, 61]
const GAP = [(-62 * Math.PI) / 180, (-18 * Math.PI) / 180] // opening in the ring, upper right

// Coverage (0..1) at a point of the 512 design space: [r, g, b, a]
function sample(x, y) {
  const dx = x - 256, dy = y - 256
  // rounded-square background, radius 112
  const qx = Math.abs(dx) - (256 - 112), qy = Math.abs(dy) - (256 - 112)
  const inBg = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) <= 112
  if (!inBg) return [0, 0, 0, 0]
  const d = Math.hypot(dx, dy), a = Math.atan2(dy, dx)
  const ring = d <= 150 && d >= 98 && !(a > GAP[0] && a < GAP[1])
  return d <= 38 || ring ? [...FG, 255] : [...BG, 255]
}

function render(size) {
  const ss = 4, px = Buffer.alloc(size * size * 4), s = 512 / size
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let r = 0, g = 0, b = 0, al = 0
    for (let v = 0; v < ss; v++) for (let u = 0; u < ss; u++) {
      const c = sample((i + (u + 0.5) / ss) * s, (j + (v + 0.5) / ss) * s)
      r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; al += c[3]
    }
    const o = (j * size + i) * 4
    if (al) { px[o] = r / al; px[o + 1] = g / al; px[o + 2] = b / al }
    px[o + 3] = al / (ss * ss)
  }
  return png(size, px)
}

const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function chunk(type, data) {
  const t = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(t.length + 8)
  out.writeUInt32BE(data.length, 0); t.copy(out, 4); out.writeUInt32BE(crc(t), t.length + 4)
  return out
}
function png(size, px) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const dir = import.meta.dirname
writeFileSync(join(dir, 'icon.png'), render(512))
const sizes = [16, 24, 32, 48, 64, 128, 256], imgs = sizes.map(render)
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4)
let off = 6 + 16 * sizes.length
const dirents = sizes.map((s, i) => {
  const e = Buffer.alloc(16); e[0] = s === 256 ? 0 : s; e[1] = e[0]; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
  e.writeUInt32LE(imgs[i].length, 8); e.writeUInt32LE(off, 12); off += imgs[i].length
  return e
})
writeFileSync(join(dir, 'icon.ico'), Buffer.concat([head, ...dirents, ...imgs]))
