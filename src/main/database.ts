import fs from 'node:fs'
import path from 'node:path'
import sqlitePkg from 'node-sqlite3-wasm'

// 默认导入 + 解构：node-sqlite3-wasm 是 CJS 包，ESM 下无法做具名导入，
// 这样写让同一份源码既能在 Electron（CJS 打包）里跑，也能被 Node 测试脚本直接引用
const { Database } = sqlitePkg
type DatabaseT = InstanceType<typeof Database>
type Statement = ReturnType<DatabaseT['prepare']>
import type {
  ImageRecord,
  LibraryStats,
  PageQuery,
  PageResult,
  SortKey,
  TagCount
} from '../shared/types'
import { joinTags, parseTags } from '../shared/types'
import { planPathRewrite } from './path-rewrite'

export interface VectorDump {
  ids: number[]
  flat: Float32Array
  dim: number
}

/** 当前 schema 版本，写在 PRAGMA user_version 里 */
const SCHEMA_VERSION = 3

const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_path TEXT NOT NULL,
  vector_data BLOB,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at DESC);
`

/** 增量列。老库按需 ALTER TABLE 补齐，数据不丢 */
const EXTRA_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'tags', ddl: "tags TEXT NOT NULL DEFAULT ''" }, // v2
  { name: 'text_vector', ddl: 'text_vector BLOB' }, // v2
  { name: 'content_hash', ddl: 'content_hash TEXT' }, // v2
  { name: 'file_size', ddl: 'file_size INTEGER' }, // v2
  { name: 'deleted_at', ddl: 'deleted_at TIMESTAMP' }, // v2
  { name: 'signature', ddl: 'signature BLOB' } // v3 感知签名
]

const V2_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_images_hash ON images(content_hash);
CREATE INDEX IF NOT EXISTS idx_images_deleted ON images(deleted_at);
`

interface PageRow {
  id: number
  image_path: string
  description: string | null
  created_at: string
  tags: string | null
  file_size: number | null
  has_vec: number
  deleted_at: string | null
}

function toBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)
}

function fromBlob(blob: Uint8Array, dim: number): Float32Array {
  // 重新分配保证 4 字节对齐，避免 new Float32Array(buffer, offset, len) 抛错
  const out = new Float32Array(dim)
  new Uint8Array(out.buffer).set(blob.subarray(0, dim * 4))
  return out
}

/** 把用户输入里的 LIKE 通配符转义，配合 ESCAPE '!' 使用 */
function escapeLike(input: string): string {
  return input.replace(/[!%_]/g, (m) => `!${m}`)
}

const ORDER_BY: Record<SortKey, string> = {
  newest: 'created_at DESC, id DESC',
  oldest: 'created_at ASC, id ASC',
  description: "(description IS NULL OR description = '') ASC, description ASC, id DESC",
  size: 'COALESCE(file_size, 0) DESC, id DESC'
}

class ImageStore {
  private conn: DatabaseT
  private cache = new Map<string, Statement>()
  readonly filePath: string

  constructor(folder: string, name = 'image.db') {
    fs.mkdirSync(folder, { recursive: true })
    this.filePath = path.join(folder, name)
    this.conn = new Database(this.filePath)
    this.conn.exec(BASE_SCHEMA)
    this.migrate()
    this.conn.exec(V2_INDEXES)
  }

  /** 老库补齐新增列。按列名比对而不是只看版本号，跨版本升级也不会漏 */
  private migrate() {
    const current = Number(
      (this.conn.get('PRAGMA user_version') as { user_version: number }).user_version ?? 0
    )
    const cols = new Set(
      (this.conn.all('PRAGMA table_info(images)') as Array<{ name: string }>).map((c) => c.name)
    )
    const missing = EXTRA_COLUMNS.filter((c) => !cols.has(c.name))
    if (missing.length === 0 && current >= SCHEMA_VERSION) return

    this.conn.exec('BEGIN')
    try {
      for (const col of missing) this.conn.exec(`ALTER TABLE images ADD COLUMN ${col.ddl}`)
      this.conn.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
      this.conn.exec('COMMIT')
    } catch (err) {
      this.conn.exec('ROLLBACK')
      throw err
    }
  }

  private stmt(sql: string): Statement {
    const hit = this.cache.get(sql)
    if (hit) return hit
    const prepared = this.conn.prepare(sql)
    this.cache.set(sql, prepared)
    return prepared
  }

  addImage(input: {
    path: string
    vector: Float32Array | null
    description?: string
    tags?: string[]
    contentHash?: string | null
    fileSize?: number | null
    signature?: Uint8Array | null
  }): number {
    const info = this.stmt(
      'INSERT INTO images (image_path, vector_data, description, tags, content_hash, file_size, signature) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run([
      input.path,
      input.vector ? toBlob(input.vector) : null,
      input.description ?? '',
      joinTags(input.tags ?? []),
      input.contentHash ?? null,
      input.fileSize ?? null,
      input.signature ?? null
    ])
    return Number(info.lastInsertRowid)
  }

  getInfoById(id: number): { path: string; description: string; tags: string[] } | null {
    const row = this.stmt(
      'SELECT image_path, description, tags FROM images WHERE id = ? AND deleted_at IS NULL'
    ).get([id]) as
      | { image_path: string; description: string | null; tags: string | null }
      | null
    if (!row) return null
    return {
      path: row.image_path,
      description: row.description ?? '',
      tags: parseTags(row.tags)
    }
  }

  /** 内容哈希已存在则返回其 id，用于导入时跳过重复图 */
  findIdByHash(hash: string): number | null {
    if (!hash) return null
    const row = this.stmt(
      'SELECT id FROM images WHERE content_hash = ? AND deleted_at IS NULL LIMIT 1'
    ).get([hash]) as { id: number } | null
    return row ? Number(row.id) : null
  }

  updateDescription(id: number, description: string) {
    this.stmt('UPDATE images SET description = ? WHERE id = ?').run([description, id])
  }

  updateDescriptions(ids: number[], description: string) {
    this.transaction(() => {
      for (const id of ids) {
        this.stmt('UPDATE images SET description = ? WHERE id = ?').run([description, id])
      }
    })
  }

  updateTags(id: number, tags: string[]) {
    this.stmt('UPDATE images SET tags = ? WHERE id = ?').run([joinTags(tags), id])
  }

  updateTagsBatch(ids: number[], tags: string[]) {
    const value = joinTags(tags)
    this.transaction(() => {
      for (const id of ids) this.stmt('UPDATE images SET tags = ? WHERE id = ?').run([value, id])
    })
  }

  /** 追加标签（不覆盖已有） */
  appendTagsBatch(ids: number[], tags: string[]) {
    this.transaction(() => {
      for (const id of ids) {
        const row = this.stmt('SELECT tags FROM images WHERE id = ?').get([id]) as
          | { tags: string | null }
          | null
        if (!row) continue
        const merged = joinTags([...parseTags(row.tags), ...tags])
        this.stmt('UPDATE images SET tags = ? WHERE id = ?').run([merged, id])
      }
    })
  }

  /** 取单条图像向量（恢复回收站记录时用） */
  getVectorById(id: number): Float32Array | null {
    const row = this.stmt('SELECT vector_data FROM images WHERE id = ?').get([id]) as
      | { vector_data: Uint8Array | null }
      | null
    if (!row?.vector_data || row.vector_data.byteLength === 0) return null
    return fromBlob(row.vector_data, row.vector_data.byteLength / 4)
  }

  getTextVector(id: number): Float32Array | null {
    const row = this.stmt('SELECT text_vector FROM images WHERE id = ?').get([id]) as
      | { text_vector: Uint8Array | null }
      | null
    if (!row?.text_vector || row.text_vector.byteLength === 0) return null
    return fromBlob(row.text_vector, row.text_vector.byteLength / 4)
  }

  updateTextVector(id: number, vector: Float32Array | null) {
    this.stmt('UPDATE images SET text_vector = ? WHERE id = ?').run([
      vector ? toBlob(vector) : null,
      id
    ])
  }

  updateTextVectorsBatch(entries: Array<{ id: number; vector: Float32Array }>) {
    this.transaction(() => {
      for (const e of entries) {
        this.stmt('UPDATE images SET text_vector = ? WHERE id = ?').run([toBlob(e.vector), e.id])
      }
    })
  }

  clearTextVectors() {
    this.conn.run('UPDATE images SET text_vector = NULL')
  }

  /** 描述有内容但缺文本向量的记录（用于懒回填） */
  rowsMissingTextVector(): Array<{ id: number; description: string }> {
    const rows = this.stmt(
      `SELECT id, description FROM images
       WHERE deleted_at IS NULL
         AND description IS NOT NULL AND description != ''
         AND text_vector IS NULL
       ORDER BY id ASC`
    ).all() as Array<{ id: number; description: string }>
    return rows.map((r) => ({ id: Number(r.id), description: r.description }))
  }

  loadTextVectors(): VectorDump {
    const rows = this.stmt(
      'SELECT id, text_vector FROM images WHERE text_vector IS NOT NULL AND deleted_at IS NULL ORDER BY id ASC'
    ).all() as Array<{ id: number; text_vector: Uint8Array }>
    if (rows.length === 0) return { ids: [], flat: new Float32Array(0), dim: 0 }
    const dim = rows[0].text_vector.byteLength / 4
    const ids: number[] = []
    const flat = new Float32Array(rows.length * dim)
    let write = 0
    for (const row of rows) {
      if (!row.text_vector || row.text_vector.byteLength !== dim * 4) continue
      flat.set(fromBlob(row.text_vector, dim), write * dim)
      ids.push(Number(row.id))
      write += 1
    }
    return { ids, flat: flat.subarray(0, write * dim), dim }
  }

  /** 缺失内容哈希的记录，用于后台补算 */
  rowsMissingHash(): Array<{ id: number; path: string }> {
    const rows = this.stmt(
      'SELECT id, image_path FROM images WHERE content_hash IS NULL OR content_hash = ?'
    ).all(['']) as Array<{ id: number; image_path: string }>
    return rows.map((r) => ({ id: Number(r.id), path: r.image_path }))
  }

  updateHash(id: number, hash: string, size: number) {
    this.stmt('UPDATE images SET content_hash = ?, file_size = ? WHERE id = ?').run([
      hash,
      size,
      id
    ])
  }

  setSignature(id: number, signature: Uint8Array | null) {
    this.stmt('UPDATE images SET signature = ? WHERE id = ?').run([signature, id])
  }

  /** 缺感知签名的记录（老库补算用） */
  rowsMissingSignature(): Array<{ id: number; path: string }> {
    const rows = this.stmt(
      'SELECT id, image_path FROM images WHERE deleted_at IS NULL AND signature IS NULL'
    ).all() as Array<{ id: number; image_path: string }>
    return rows.map((r) => ({ id: Number(r.id), path: r.image_path }))
  }

  loadSignatures(): Array<{ id: number; signature: Uint8Array }> {
    const rows = this.stmt(
      'SELECT id, signature FROM images WHERE deleted_at IS NULL AND signature IS NOT NULL ORDER BY id ASC'
    ).all() as Array<{ id: number; signature: Uint8Array }>
    return rows
      .filter((r) => r.signature && r.signature.byteLength > 0)
      .map((r) => ({ id: Number(r.id), signature: r.signature }))
  }

  /** 字面匹配（描述 / 标签 / 文件名），作为语义检索的兜底与加权 */
  searchLiteral(keyword: string, limit = 200): number[] {
    const like = `%${escapeLike(keyword)}%`
    const rows = this.stmt(
      `SELECT id FROM images
       WHERE deleted_at IS NULL
         AND (COALESCE(description, '') LIKE ? ESCAPE '!'
              OR tags LIKE ? ESCAPE '!'
              OR image_path LIKE ? ESCAPE '!')
       ORDER BY id DESC
       LIMIT ?`
    ).all([like, like, like, limit]) as Array<{ id: number }>
    return rows.map((r) => Number(r.id))
  }

  /** 内容哈希相同的记录分组（精确重复） */
  duplicateHashGroups(): Array<{ hash: string; ids: number[] }> {
    const rows = this.stmt(
      `SELECT content_hash AS hash, id FROM images
       WHERE deleted_at IS NULL AND content_hash IS NOT NULL AND content_hash != ''
       ORDER BY content_hash ASC, id ASC`
    ).all() as Array<{ hash: string; id: number }>
    const map = new Map<string, number[]>()
    for (const row of rows) {
      const list = map.get(row.hash)
      if (list) list.push(Number(row.id))
      else map.set(row.hash, [Number(row.id)])
    }
    return [...map.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([hash, ids]) => ({ hash, ids }))
  }

  getPage(query: PageQuery): PageResult {
    const { where, params } = this.buildWhere(query)
    const total = Number(
      (this.stmt(`SELECT COUNT(*) AS n FROM images WHERE ${where}`).get(params) as { n: number }).n
    )
    const pageSize = Math.max(1, query.pageSize)
    const page = Math.max(1, query.page)
    const offset = (page - 1) * pageSize
    const order = ORDER_BY[query.sort ?? 'newest'] ?? ORDER_BY.newest
    const rows = this.stmt(
      `SELECT id, image_path, description, created_at, tags, file_size,
              vector_data IS NOT NULL AS has_vec, deleted_at
       FROM images WHERE ${where}
       ORDER BY ${order}
       LIMIT ? OFFSET ?`
    ).all([...params, pageSize, offset]) as unknown as PageRow[]
    return { total, page, pageSize, rows: rows.map(mapRow) }
  }

  private buildWhere(query: PageQuery): { where: string; params: Array<string | number> } {
    const clauses: string[] = [query.trash ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL']
    const params: Array<string | number> = []

    const keyword = query.keyword?.trim()
    if (keyword) {
      const like = `%${escapeLike(keyword)}%`
      clauses.push(
        "(COALESCE(description, '') LIKE ? ESCAPE '!' OR tags LIKE ? ESCAPE '!' OR image_path LIKE ? ESCAPE '!')"
      )
      params.push(like, like, like)
    }

    const tag = query.tag?.trim()
    if (tag) {
      // 用 instr 做精确标签匹配，避免 LIKE 把 _ / % 当通配符
      clauses.push("instr(',' || tags || ',', ',' || ? || ',') > 0")
      params.push(tag)
    }

    if (query.onlyWithDescription) {
      clauses.push("description IS NOT NULL AND description != ''")
    }

    return { where: clauses.join(' AND '), params }
  }

  getStatistics(dimension: number, textDimension: number): LibraryStats {
    const one = (sql: string) => Number((this.stmt(sql).get() as { n: number }).n)
    const total = one('SELECT COUNT(*) AS n FROM images WHERE deleted_at IS NULL')
    const withDescription = one(
      "SELECT COUNT(*) AS n FROM images WHERE deleted_at IS NULL AND description IS NOT NULL AND description != ''"
    )
    const withVector = one(
      'SELECT COUNT(*) AS n FROM images WHERE deleted_at IS NULL AND vector_data IS NOT NULL'
    )
    const withTags = one("SELECT COUNT(*) AS n FROM images WHERE deleted_at IS NULL AND tags != ''")
    const withTextVector = one(
      'SELECT COUNT(*) AS n FROM images WHERE deleted_at IS NULL AND text_vector IS NOT NULL'
    )
    const trashed = one('SELECT COUNT(*) AS n FROM images WHERE deleted_at IS NOT NULL')
    const range = this.stmt(
      'SELECT MIN(created_at) AS a, MAX(created_at) AS b FROM images WHERE deleted_at IS NULL'
    ).get() as { a: string | null; b: string | null } | null

    return {
      total,
      withDescription,
      withVector,
      withTags,
      withTextVector,
      trashed,
      descriptionRate: total ? withDescription / total : 0,
      vectorRate: total ? withVector / total : 0,
      earliest: range?.a ?? null,
      latest: range?.b ?? null,
      dimension,
      textDimension
    }
  }

  listTags(): TagCount[] {
    const rows = this.stmt(
      "SELECT tags FROM images WHERE deleted_at IS NULL AND tags != ''"
    ).all() as Array<{ tags: string }>
    const counter = new Map<string, number>()
    for (const row of rows) {
      for (const tag of parseTags(row.tags)) {
        counter.set(tag, (counter.get(tag) ?? 0) + 1)
      }
    }
    return [...counter.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  }

  getAllIdsAndPaths(): Array<{ id: number; path: string }> {
    const rows = this.stmt(
      'SELECT id, image_path FROM images WHERE deleted_at IS NULL ORDER BY id ASC'
    ).all() as Array<{ id: number; image_path: string }>
    return rows.map((r) => ({ id: Number(r.id), path: r.image_path }))
  }

  getRecordsByIds(ids: number[]): ImageRecord[] {
    if (ids.length === 0) return []
    const marks = ids.map(() => '?').join(',')
    const rows = this.stmt(
      `SELECT id, image_path, description, created_at, tags, file_size,
              vector_data IS NOT NULL AS has_vec, deleted_at
       FROM images WHERE id IN (${marks})`
    ).all(ids) as unknown as PageRow[]
    return rows.map(mapRow)
  }

  loadVectors(): VectorDump {
    const rows = this.stmt(
      'SELECT id, vector_data FROM images WHERE vector_data IS NOT NULL AND deleted_at IS NULL ORDER BY id ASC'
    ).all() as Array<{ id: number; vector_data: Uint8Array }>
    if (rows.length === 0) return { ids: [], flat: new Float32Array(0), dim: 0 }
    const dim = rows[0].vector_data.byteLength / 4
    const ids: number[] = []
    const flat = new Float32Array(rows.length * dim)
    let write = 0
    for (const row of rows) {
      if (!row.vector_data || row.vector_data.byteLength !== dim * 4) continue
      flat.set(fromBlob(row.vector_data, dim), write * dim)
      ids.push(Number(row.id))
      write += 1
    }
    return { ids, flat: flat.subarray(0, write * dim), dim }
  }

  updateVectorsBatch(entries: Array<{ id: number; vector: Float32Array }>) {
    this.transaction(() => {
      for (const e of entries) {
        this.stmt('UPDATE images SET vector_data = ? WHERE id = ?').run([toBlob(e.vector), e.id])
      }
    })
  }

  updateVector(id: number, vector: Float32Array) {
    this.stmt('UPDATE images SET vector_data = ? WHERE id = ?').run([toBlob(vector), id])
  }

  clearVectors() {
    this.conn.run('UPDATE images SET vector_data = NULL')
  }

  /** 软删除：进回收站，文件保留 */
  trash(ids: number[]): number {
    let affected = 0
    this.transaction(() => {
      for (const id of ids) {
        const info = this.stmt('UPDATE images SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL').run([id])
        affected += info.changes
      }
    })
    return affected
  }

  restore(ids: number[]): number {
    let affected = 0
    this.transaction(() => {
      for (const id of ids) {
        const info = this.stmt('UPDATE images SET deleted_at = NULL WHERE id = ?').run([id])
        affected += info.changes
      }
    })
    return affected
  }

  /** 彻底删除数据库记录，返回被删记录的图片路径（由调用方决定是否删文件） */
  purge(ids: number[]): string[] {
    const paths: string[] = []
    this.transaction(() => {
      for (const id of ids) {
        const row = this.stmt('SELECT image_path FROM images WHERE id = ?').get([id]) as
          | { image_path: string }
          | null
        if (row) paths.push(row.image_path)
        this.stmt('DELETE FROM images WHERE id = ?').run([id])
      }
    })
    return paths
  }

  purgeAllTrash(): string[] {
    const rows = this.stmt('SELECT id FROM images WHERE deleted_at IS NOT NULL').all() as Array<{
      id: number
    }>
    return this.purge(rows.map((r) => Number(r.id)))
  }

  /** 存储目录变更后批量改写路径前缀，返回受影响行数 */
  rewritePathPrefix(oldRoot: string, newRoot: string): number {
    const plan = planPathRewrite(oldRoot, newRoot)
    if (!plan) return 0
    const info = this.stmt(
      "UPDATE images SET image_path = ? || SUBSTR(image_path, ?) WHERE image_path LIKE ? ESCAPE '!'"
    ).run([plan.prefix, plan.startIndex, plan.likePattern])
    return info.changes
  }

  private transaction(fn: () => void) {
    this.conn.exec('BEGIN')
    try {
      fn()
      this.conn.exec('COMMIT')
    } catch (err) {
      this.conn.exec('ROLLBACK')
      throw err
    }
  }

  close() {
    try {
      for (const stmt of this.cache.values()) {
        if (!stmt.isFinalized) stmt.finalize()
      }
    } catch {
      /* ignore */
    }
    this.cache.clear()
    if (this.conn.isOpen) this.conn.close()
  }
}

function mapRow(r: PageRow): ImageRecord {
  return {
    id: Number(r.id),
    path: r.image_path,
    description: r.description ?? '',
    createdAt: r.created_at,
    hasVector: r.has_vec === 1,
    tags: parseTags(r.tags),
    fileSize: Number(r.file_size ?? 0),
    deletedAt: r.deleted_at ?? null
  }
}

let store: ImageStore | null = null

export function openStore(folder: string): ImageStore {
  if (store && path.dirname(store.filePath) === path.resolve(folder)) return store
  if (store) {
    try {
      store.close()
    } catch {
      /* ignore */
    }
    store = null
  }
  try {
    store = new ImageStore(folder)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 上次进程异常退出会留下 *_lock 目录，导致 "database is locked"
    if (/locked/i.test(message)) {
      const lockDir = path.join(path.resolve(folder), 'image.db.lock')
      if (fs.existsSync(lockDir)) {
        fs.rmSync(lockDir, { recursive: true, force: true })
        store = new ImageStore(folder)
        return store
      }
    }
    throw err
  }
  return store
}

export function getStore(): ImageStore {
  if (!store) throw new Error('数据库尚未初始化')
  return store
}

/** 关闭连接（迁移数据库目录前必须先调用，确保数据落盘） */
export function closeStore() {
  if (!store) return
  try {
    store.close()
  } catch {
    /* ignore */
  }
  store = null
}
