import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import {
  env,
  AutoImageProcessor,
  AutoModel,
  RawImage
} from '@huggingface/transformers'
import sqlitePkg from 'node-sqlite3-wasm'

const { Database } = sqlitePkg
const require = createRequire(import.meta.url)
const pkg = require('../package.json')

const MODEL_ID = 'Xenova/dinov2-small'
// 与 Electron 的 app.getPath('userData') 保持一致：优先 productName
const APP_NAME = pkg.productName || pkg.name
const USER_DATA =
  process.env.APP_USERDATA || path.join(os.homedir(), 'AppData', 'Roaming', APP_NAME)
const DATA = path.join(USER_DATA, 'data')
const IMAGES = path.join(DATA, 'images')
const DB_DIR = path.join(DATA, 'database')
const MODEL_DIR = path.join(DATA, 'models')

/* ---------------- 极简 PNG 编码 ---------------- */
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

const SPECS = [
  { name: '纯色·正红', pattern: solid([214, 48, 49]), desc: '品牌主色参考·正红' },
  { name: '纯色·暖橙', pattern: solid([230, 126, 34]), desc: '活动 Banner 底色·暖橙' },
  { name: '纯色·柠檬黄', pattern: solid([241, 196, 15]), desc: '提示色·柠檬黄' },
  { name: '纯色·草绿', pattern: solid([39, 174, 96]), desc: '成功状态色·草绿' },
  { name: '纯色·青蓝', pattern: solid([26, 188, 156]), desc: '辅助色·青蓝' },
  { name: '纯色·深海蓝', pattern: solid([41, 128, 185]), desc: '科技感底色·深海蓝' },
  { name: '纯色·紫罗兰', pattern: solid([142, 68, 173]), desc: '主品牌紫·VI 手册' },
  { name: '纯色·深灰', pattern: solid([52, 58, 64]), desc: '深色模式底色' },
  {
    name: '渐变·日落橙红',
    pattern: vGradient([255, 138, 101], [191, 54, 12]),
    desc: '秋季活动主视觉渐变'
  },
  {
    name: '渐变·紫到粉',
    pattern: vGradient([98, 0, 238], [240, 98, 146]),
    desc: '产品发布会 KV 渐变'
  },
  {
    name: '渐变·青到蓝',
    pattern: hGradient([26, 188, 156], [41, 128, 185]),
    desc: '数据看板背景渐变'
  },
  {
    name: '渐变·金到棕',
    pattern: hGradient([241, 196, 15], [120, 66, 18]),
    desc: '会员权益页渐变底'
  },
  { name: '条纹·黑白', pattern: stripes([20, 20, 20], [245, 245, 245], 16), desc: '极简黑白条纹纹理' },
  { name: '条纹·紫白', pattern: stripes([98, 0, 238], [255, 255, 255], 12), desc: '品牌紫条纹装饰' },
  { name: '条纹·橙青', pattern: stripes([230, 126, 34], [26, 188, 156], 20), desc: '撞色条纹插画底' },
  { name: '条纹·蓝灰', pattern: stripes([41, 128, 185], [189, 195, 199], 8), desc: '细条纹商务背景' },
  {
    name: '棋盘·黑白',
    pattern: checker([20, 20, 20], [250, 250, 250], 32),
    desc: '棋盘格纹理·复古风'
  },
  {
    name: '棋盘·红白',
    pattern: checker([214, 48, 49], [255, 255, 255], 32),
    desc: '红白棋盘·波普风参考'
  },
  {
    name: '棋盘·紫绿',
    pattern: checker([142, 68, 173], [39, 174, 96], 24),
    desc: '紫绿棋盘·实验性配色'
  },
  {
    name: '棋盘·灰阶',
    pattern: checker([120, 120, 120], [220, 220, 220], 40),
    desc: '灰阶棋盘·占位图模板'
  },
  { name: '同心环·红', pattern: rings([214, 48, 49], [255, 240, 240]), desc: '同心环构成·红色' },
  { name: '同心环·蓝', pattern: rings([41, 128, 185], [235, 245, 255]), desc: '同心环构成·蓝色' },
  { name: '同心环·绿', pattern: rings([39, 174, 96], [235, 255, 240]), desc: '同心环构成·绿色' },
  {
    name: '同心环·紫',
    pattern: rings([142, 68, 173], [248, 240, 255]),
    desc: '同心环构成·紫色'
  }
]

/* ---------------- 主流程 ---------------- */
async function main() {
  fs.mkdirSync(IMAGES, { recursive: true })
  fs.mkdirSync(DB_DIR, { recursive: true })
  fs.mkdirSync(MODEL_DIR, { recursive: true })

  for (const dir of [DB_DIR]) {
    const lock = path.join(dir, 'image.db.lock')
    if (fs.existsSync(lock)) fs.rmSync(lock, { recursive: true, force: true })
  }

  const dbFile = path.join(DB_DIR, 'image.db')
  if (fs.existsSync(dbFile)) fs.rmSync(dbFile, { force: true })

  console.log('[seed] 加载模型…')
  env.allowRemoteModels = true
  env.allowLocalModels = true
  env.useBrowserCache = false
  env.cacheDir = MODEL_DIR
  env.remoteHost = 'https://hf-mirror.com/'

  const processor = await AutoImageProcessor.from_pretrained(MODEL_ID)
  const model = await AutoModel.from_pretrained(MODEL_ID, { dtype: 'fp32' })

  const db = new Database(dbFile)
  db.exec(`
    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_path TEXT NOT NULL,
      vector_data BLOB,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at DESC);
  `)
  const insert = db.prepare(
    'INSERT INTO images (image_path, vector_data, description, created_at) VALUES (?, ?, ?, ?)'
  )

  const queryPath = path.join(IMAGES, 'query-red.png')

  for (let i = 0; i < SPECS.length; i++) {
    const spec = SPECS[i]
    const rgb = draw(spec.pattern)
    const png = encodePNG(SIZE, SIZE, rgb)
    const fileName = `${crypto.randomUUID()}.png`
    const filePath = path.join(IMAGES, fileName)
    fs.writeFileSync(filePath, png)

    const image = await RawImage.fromBlob(new Blob([new Uint8Array(png)]))
    const inputs = await processor(image)
    const out = await model(inputs)
    const tensor = out.pooler_output ?? out.last_hidden_state
    const dims = tensor.dims
    const dim = dims[dims.length - 1]
    const data =
      tensor.data instanceof Float32Array ? tensor.data : Float32Array.from(tensor.data)
    const vec = new Float32Array(data.slice(0, dim))
    let norm = 0
    for (let j = 0; j < dim; j++) norm += vec[j] * vec[j]
    norm = Math.sqrt(norm)
    for (let j = 0; j < dim; j++) vec[j] /= norm

    const created = `2026-10-${String(10 + Math.floor(i / 3)).padStart(2, '0')} ${String(
      9 + (i % 9)
    ).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}:00`
    insert.run([
      filePath,
      new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength),
      spec.desc,
      created
    ])
    process.stdout.write(`\r[seed] ${i + 1}/${SPECS.length} ${spec.name}          `)

    if (i === 0) fs.writeFileSync(queryPath, png)
  }

  insert.finalize()
  db.close()
  console.log('\n[seed] 完成，图片目录:', IMAGES)
  console.log('[seed] 查询图:', queryPath)
}

main().catch((err) => {
  console.error('[seed] 失败', err)
  process.exit(1)
})
