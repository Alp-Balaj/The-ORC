// Regenerates build/icon.png (512px) and build/icon.ico (16-256px) by rasterizing icon.svg.
// Run: node build/make-icons.mjs   (no dependencies)
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { join } from 'node:path'

// Parses icon.svg: a rounded-square background plus the polygon glyph paths (M/L/Z only) in <g id="orc-icon">.
const svg = readFileSync(join(import.meta.dirname, 'icon.svg'), 'utf8')
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const BG = hex(svg.match(/<rect[^>]*fill="(#[0-9a-f]{6})"/i)[1]), FG = hex(svg.match(/<g id="orc-icon"[^>]*fill="(#[0-9a-f]{6})"/i)[1])
const RX = Number(svg.match(/<rect[^>]*rx="(\d+)"/)[1])
const [, TX, TY, SC] = svg.match(/translate\(([\d.-]+) ([\d.-]+)\) scale\(([\d.]+)\)/).map(Number)
const paths = [...svg.matchAll(/<path\b[^>]*?\bd="([^"]+)"[^>]*>/g)].map((m) => ({
  evenodd: /fill-rule="evenodd"/.test(m[0]),
  polys: m[1].split(/(?=M)/).map((p) => (p.match(/-?[\d.]+/g) || []).map(Number)).filter((n) => n.length >= 6)
    .map((n) => { const pts = []; for (let i = 0; i < n.length; i += 2) pts.push([n[i] * SC + TX, n[i + 1] * SC + TY]); return pts }),
}))
function inPoly(pts, x, y) { // crossing count + winding
  let wn = 0, cr = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n]
    if ((y1 > y) !== (y2 > y) && x < x1 + ((y - y1) / (y2 - y1)) * (x2 - x1)) { cr++; wn += y2 > y1 ? 1 : -1 }
  }
  return [cr & 1, wn]
}
function inGlyph(x, y) {
  return paths.some((p) => {
    let cr = 0, wn = 0
    for (const poly of p.polys) { const [c, w] = inPoly(poly, x, y); cr += c; wn += w }
    return p.evenodd ? cr & 1 : wn !== 0
  })
}

// One point of the 512 design space: [r, g, b, a]
function sample(x, y) {
  const dx = x - 256, dy = y - 256
  const qx = Math.abs(dx) - (256 - RX), qy = Math.abs(dy) - (256 - RX)
  const inBg = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) <= RX
  if (!inBg) return [0, 0, 0, 0]
  return [...(inGlyph(x, y) ? FG : BG), 255]
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
