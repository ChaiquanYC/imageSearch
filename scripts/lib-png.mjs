import zlib from 'node:zlib'

/**
 * 极简 PNG 编码器 + 图案生成器。
 * 只依赖 zlib，用来在测试/播种时凭空造出确定性的图片，
 * 不引入任何图形库。
 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePNG(width, height, rgb) {
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1
    )
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ---------------- 图案生成 ---------------- */
const SIZE = 256

function draw(fn) {
  const buf = new Uint8Array(SIZE * SIZE * 3)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = fn(x, y)
      const i = (y * SIZE + x) * 3
      buf[i] = Math.max(0, Math.min(255, r | 0))
      buf[i + 1] = Math.max(0, Math.min(255, g | 0))
      buf[i + 2] = Math.max(0, Math.min(255, b | 0))
    }
  }
  return buf
}

const solid = (c) => () => c
const vGradient = (a, b) => (x, y) => {
  const t = y / SIZE
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}
const hGradient = (a, b) => (x, y) => {
  const t = x / SIZE
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}
const stripes = (a, b, width) => (x) => (Math.floor(x / width) % 2 === 0 ? a : b)
const checker = (a, b, size) => (x, y) =>
  (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0 ? a : b
const rings = (a, b) => (x, y) => {
  const d = Math.hypot(x - SIZE / 2, y - SIZE / 2)
  return Math.floor(d / 18) % 2 === 0 ? a : b
}


export { encodePNG, draw, solid, vGradient, hGradient, stripes, checker, rings, SIZE }
