import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ImportProgress, ImportSummary } from '../shared/types'
import { getStore } from './database'
import { extractFeature } from './embedder'
import { getSettings } from './settings'
import { vectorIndex } from './vector-index'

export interface ImportOptions {
  onProgress?: (p: ImportProgress) => void
}

/**
 * 批量入库：复制到托管目录 → 抽特征 → 写库 → 实时进索引。
 * 每次循环都重新读配置，避免改了图片目录还往老目录写的旧坑。
 */
export async function importImages(
  paths: string[],
  opts: ImportOptions = {}
): Promise<ImportSummary> {
  const started = Date.now()
  const total = paths.length
  const store = getStore()
  let succeeded = 0
  let failed = 0

  for (let i = 0; i < paths.length; i++) {
    const src = paths[i]
    try {
      const ext = path.extname(src).toLowerCase()
      if (!fs.existsSync(src)) throw new Error('文件不存在')
      const { storageDir } = getSettings()
      fs.mkdirSync(storageDir, { recursive: true })
      const dest = path.join(storageDir, `${crypto.randomUUID()}${ext}`)
      await fs.promises.copyFile(src, dest)

      const vector = await extractFeature(dest)
      const id = store.addImage(dest, vector, '')
      vectorIndex.add(id, vector)
      succeeded += 1
    } catch (err) {
      failed += 1
      console.error('[import] 处理失败', src, err)
    }
    opts.onProgress?.({ done: i + 1, total, current: path.basename(src), failed })
  }

  return { total, succeeded, failed, elapsedMs: Date.now() - started }
}
