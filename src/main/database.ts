import fs from 'node:fs'
import path from 'node:path'
import { Database, type Statement } from 'node-sqlite3-wasm'
import type { ImageRecord, LibraryStats, PageResult } from '../shared/types'
import { planPathRewrite } from './path-rewrite'

export interface VectorDump {
  ids: number[]
  flat: Float32Array
  dim: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_path TEXT NOT NULL,
  vector_data BLOB,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at DESC);
`

interface Stmts {
  insert: Statement
  del: Statement
  pathById: Statement
  infoById: Statement
  updateDesc: Statement
  page: Statement
  count: Statement
  countDesc: Statement
  countVec: Statement
  timeRange: Statement
  allIds: Statement
  selectVectors: Statement
  updateVector: Statement
  clearVectors: Statement
  rewritePath: Statement
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

class ImageStore {
  private conn: Database
  private s: Stmts
  readonly filePath: string

  constructor(folder: string, name = 'image.db') {
    fs.mkdirSync(folder, { recursive: true })
    this.filePath = path.join(folder, name)
    this.conn = new Database(this.filePath)
    this.conn.exec(SCHEMA)
    this.s = this.prepare()
  }

  private prepare(): Stmts {
    const c = this.conn
    return {
      insert: c.prepare(
        'INSERT INTO images (image_path, vector_data, description) VALUES (?, ?, ?)'
      ),
      del: c.prepare('DELETE FROM images WHERE id = ?'),
      pathById: c.prepare('SELECT image_path FROM images WHERE id = ?'),
      infoById: c.prepare('SELECT image_path, description FROM images WHERE id = ?'),
      updateDesc: c.prepare('UPDATE images SET description = ? WHERE id = ?'),
      page: c.prepare(
        `SELECT id, image_path, description, created_at, vector_data IS NOT NULL AS has_vec
         FROM images ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
      ),
      count: c.prepare('SELECT COUNT(*) AS n FROM images'),
      countDesc: c.prepare(
        "SELECT COUNT(*) AS n FROM images WHERE description IS NOT NULL AND description != ''"
      ),
      countVec: c.prepare('SELECT COUNT(*) AS n FROM images WHERE vector_data IS NOT NULL'),
      timeRange: c.prepare('SELECT MIN(created_at) AS a, MAX(created_at) AS b FROM images'),
      allIds: c.prepare('SELECT id, image_path FROM images ORDER BY id ASC'),
      selectVectors: c.prepare(
        'SELECT id, vector_data FROM images WHERE vector_data IS NOT NULL ORDER BY id ASC'
      ),
      updateVector: c.prepare('UPDATE images SET vector_data = ? WHERE id = ?'),
      clearVectors: c.prepare('UPDATE images SET vector_data = NULL'),
      rewritePath: c.prepare(
        "UPDATE images SET image_path = ? || SUBSTR(image_path, ?) WHERE image_path LIKE ? ESCAPE '!'"
      )
    }
  }

  addImage(imagePath: string, vector: Float32Array | null, description = ''): number {
    const info = this.s.insert.run([imagePath, vector ? toBlob(vector) : null, description])
    return Number(info.lastInsertRowid)
  }

  deleteImage(id: number): string | null {
    const row = this.s.pathById.get([id]) as { image_path: string } | null
    this.s.del.run([id])
    return row?.image_path ?? null
  }

  getInfoById(id: number): { path: string; description: string } | null {
    const row = this.s.infoById.get([id]) as
      | { image_path: string; description: string | null }
      | null
    if (!row) return null
    return { path: row.image_path, description: row.description ?? '' }
  }

  updateDescription(id: number, description: string) {
    this.s.updateDesc.run([description, id])
  }

  updateDescriptions(ids: number[], description: string) {
    this.conn.exec('BEGIN')
    try {
      for (const id of ids) this.s.updateDesc.run([description, id])
      this.conn.exec('COMMIT')
    } catch (err) {
      this.conn.exec('ROLLBACK')
      throw err
    }
  }

  getPage(page: number, pageSize: number): PageResult {
    const total = (this.s.count.get() as { n: number }).n
    const offset = Math.max(0, (page - 1) * pageSize)
    const rows = this.s.page.all([pageSize, offset]) as Array<{
      id: number
      image_path: string
      description: string | null
      created_at: string
      has_vec: number
    }>
    return {
      total,
      page,
      pageSize,
      rows: rows.map<ImageRecord>((r) => ({
        id: Number(r.id),
        path: r.image_path,
        description: r.description ?? '',
        createdAt: r.created_at,
        hasVector: r.has_vec === 1
      }))
    }
  }

  getStatistics(dimension: number): LibraryStats {
    const total = (this.s.count.get() as { n: number }).n
    const withDescription = (this.s.countDesc.get() as { n: number }).n
    const withVector = (this.s.countVec.get() as { n: number }).n
    const range = this.s.timeRange.get() as { a: string | null; b: string | null } | null
    return {
      total,
      withDescription,
      withVector,
      descriptionRate: total ? withDescription / total : 0,
      vectorRate: total ? withVector / total : 0,
      earliest: range?.a ?? null,
      latest: range?.b ?? null,
      dimension
    }
  }

  getAllIdsAndPaths(): Array<{ id: number; path: string }> {
    const rows = this.s.allIds.all() as Array<{ id: number; image_path: string }>
    return rows.map((r) => ({ id: Number(r.id), path: r.image_path }))
  }

  loadVectors(): VectorDump {
    const rows = this.s.selectVectors.all() as Array<{
      id: number
      vector_data: Uint8Array
    }>
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
    this.conn.exec('BEGIN')
    try {
      for (const e of entries) this.s.updateVector.run([toBlob(e.vector), e.id])
      this.conn.exec('COMMIT')
    } catch (err) {
      this.conn.exec('ROLLBACK')
      throw err
    }
  }

  clearVectors() {
    this.s.clearVectors.run()
  }

  /** 存储目录变更后批量改写路径前缀，返回受影响行数 */
  rewritePathPrefix(oldRoot: string, newRoot: string): number {
    const plan = planPathRewrite(oldRoot, newRoot)
    if (!plan) return 0
    const info = this.s.rewritePath.run([plan.prefix, plan.startIndex, plan.likePattern])
    return info.changes
  }

  close() {
    try {
      for (const stmt of Object.values(this.s)) {
        if (!stmt.isFinalized) stmt.finalize()
      }
    } catch {
      /* ignore */
    }
    if (this.conn.isOpen) this.conn.close()
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
