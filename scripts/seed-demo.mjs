import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import {
  env,
  AutoImageProcessor,
  AutoModel,
  RawImage,
  pipeline
} from '@huggingface/transformers'
import sqlitePkg from 'node-sqlite3-wasm'
import {
  SIZE,
  checker,
  draw,
  encodePNG,
  hGradient,
  rings,
  solid,
  stripes,
  vGradient
} from './lib-png.mjs'
import { signatureFromRgb } from '../src/main/signature.ts'

const { Database } = sqlitePkg
const require = createRequire(import.meta.url)
const pkg = require('../package.json')

const MODEL_ID = 'Xenova/dinov2-small'
const TEXT_MODEL_ID = 'Xenova/bge-small-zh-v1.5'
const TEXT_POOLING = 'cls'
// 与 Electron 的 app.getPath('userData') 保持一致：优先 productName
const APP_NAME = pkg.productName || pkg.name
const USER_DATA =
  process.env.APP_USERDATA || path.join(os.homedir(), 'AppData', 'Roaming', APP_NAME)
const DATA = path.join(USER_DATA, 'data')
const IMAGES = path.join(DATA, 'images')
const DB_DIR = path.join(DATA, 'database')
const MODEL_DIR = path.join(DATA, 'models')

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

  // 演示图用固定文件名：重复播种会覆盖同名文件，不会在存储目录里堆孤儿
  const demoName = (i) => `demo-${String(i + 1).padStart(2, '0')}`

  console.log('[seed] 加载模型…')
  env.allowRemoteModels = true
  env.allowLocalModels = true
  env.useBrowserCache = false
  env.cacheDir = MODEL_DIR
  env.remoteHost = 'https://hf-mirror.com/'

  const processor = await AutoImageProcessor.from_pretrained(MODEL_ID)
  const model = await AutoModel.from_pretrained(MODEL_ID, { dtype: 'fp32' })

  const db = new Database(dbFile)
  // 与 src/main/database.ts 的 v2 schema 保持一致
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
  db.exec(`
    ALTER TABLE images ADD COLUMN tags TEXT NOT NULL DEFAULT '';
    ALTER TABLE images ADD COLUMN text_vector BLOB;
    ALTER TABLE images ADD COLUMN content_hash TEXT;
    ALTER TABLE images ADD COLUMN file_size INTEGER;
    ALTER TABLE images ADD COLUMN deleted_at TIMESTAMP;
    ALTER TABLE images ADD COLUMN signature BLOB;
    PRAGMA user_version = 3;
    CREATE INDEX IF NOT EXISTS idx_images_hash ON images(content_hash);
    CREATE INDEX IF NOT EXISTS idx_images_deleted ON images(deleted_at);
  `)
  const insert = db.prepare(
    'INSERT INTO images (image_path, vector_data, description, tags, content_hash, file_size, signature, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )

  const queryPath = path.join(IMAGES, 'query-red.png')

  for (let i = 0; i < SPECS.length; i++) {
    const spec = SPECS[i]
    const rgb = draw(spec.pattern)
    const png = encodePNG(SIZE, SIZE, rgb)
    const filePath = path.join(IMAGES, `${demoName(i)}.png`)
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
      spec.name.split('·').join(','),
      crypto.createHash('sha256').update(png).digest('hex'),
      png.length,
      signatureFromRgb(SIZE, SIZE, rgb),
      created
    ])
    process.stdout.write(`\r[seed] ${i + 1}/${SPECS.length} ${spec.name}          `)

    if (i === 0) fs.writeFileSync(queryPath, png)
  }

  // 造两对重复图，方便验证查重能力
  const dupPlans = [
    { index: 0, note: '内容完全相同的副本', brighten: 0 },
    { index: 8, note: '亮度略微不同的近重复图', brighten: 8 }
  ]
  for (const plan of dupPlans) {
    const spec = SPECS[plan.index]
    let rgb = draw(spec.pattern)
    if (plan.brighten) {
      rgb = Uint8Array.from(rgb, (v) => Math.max(0, Math.min(255, v + plan.brighten)))
    }
    const png = encodePNG(SIZE, SIZE, rgb)
    const filePath = path.join(IMAGES, `demo-dup-${plan.index}.png`)
    fs.writeFileSync(filePath, png)

    const image = await RawImage.fromBlob(new Blob([new Uint8Array(png)]))
    const out = await model(await processor(image))
    const tensor = out.pooler_output ?? out.last_hidden_state
    const dim = tensor.dims[tensor.dims.length - 1]
    const data =
      tensor.data instanceof Float32Array ? tensor.data : Float32Array.from(tensor.data)
    const vec = new Float32Array(data.slice(0, dim))
    let norm = 0
    for (let j = 0; j < dim; j++) norm += vec[j] * vec[j]
    norm = Math.sqrt(norm)
    for (let j = 0; j < dim; j++) vec[j] /= norm

    insert.run([
      filePath,
      new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength),
      `${spec.desc}（${plan.note}）`,
      `${spec.name.split('·').join(',')},重复样例`,
      crypto.createHash('sha256').update(png).digest('hex'),
      png.length,
      signatureFromRgb(SIZE, SIZE, rgb),
      '2026-10-26 15:30:00'
    ])
    console.log(`\n[seed] 重复样例: ${spec.name} · ${plan.note}`)
  }

  // 先释放插入语句，避免长时间占用后再开新语句时 WASM 句柄冲突
  insert.finalize()

  // 给所有描述预生成文本向量，避免首次文字检索时再等模型下载
  console.log('[seed] 生成文本向量…')
  const textPipe = await pipeline('feature-extraction', TEXT_MODEL_ID, { dtype: 'q8' })
  const rows = db.all('SELECT id, description FROM images ORDER BY id')
  const updateText = db.prepare('UPDATE images SET text_vector = ? WHERE id = ?')
  for (let i = 0; i < rows.length; i++) {
    const out = await textPipe(rows[i].description, { pooling: TEXT_POOLING, normalize: true })
    const data = out.data instanceof Float32Array ? out.data : Float32Array.from(out.data)
    const blob = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    // WASM SQLite 偶尔会在连续写 BLOB 时抛 SQLITE_IOERR，重试一次即可
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        updateText.run([blob, rows[i].id])
        break
      } catch (err) {
        if (attempt === 2) throw err
        await new Promise((r) => setTimeout(r, 60))
      }
    }
    if (i % 5 === 0) process.stdout.write(`\r[seed] 文本向量 ${i + 1}/${rows.length}   `)
  }
  updateText.finalize()

  db.close()
  console.log('\n[seed] 完成，图片目录:', IMAGES)
  console.log('[seed] 查询图:', queryPath)
}

main().catch((err) => {
  console.error('[seed] 失败', err)
  process.exit(1)
})
