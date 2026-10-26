import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ImportProgress, ImportSummary } from '../shared/types'
import { getStore } from './database'
import { extractFeature } from './embedder'
import { sha256File } from './hash'
import { computeSignature } from './phash'
import { getSettings } from './settings'
import { vectorIndex } from './vector-index'

export interface ImportOptions {
  onProgress?: (p: ImportProgress) => void
  /** 覆盖配置里的去重开关 */
  dedupe?: boolean
}

/**
 * 批量入库：算哈希查重 → 复制到托管目录 → 抽特征 → 写库 → 实时进索引。
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
  let duplicates = 0
  const duplicateNames: string[] = []

  for (let i = 0; i < paths.length; i++) {
    const src = paths[i]
    const name = path.basename(src)
    try {
      const ext = path.extname(src).toLowerCase()
      if (!fs.existsSync(src)) throw new Error('文件不存在')

      const dedupe = opts.dedupe ?? getSettings().dedupeOnImport
      const { hash, size } = await sha256File(src)
      if (dedupe) {
        const existing = store.findIdByHash(hash)
        if (existing !== null) {
          duplicates += 1
          if (duplicateNames.length < 20) duplicateNames.push(name)
          opts.onProgress?.({ done: i + 1, total, current: name, failed, duplicates })
          continue
        }
      }

      const { storageDir } = getSettings()
      fs.mkdirSync(storageDir, { recursive: true })
      const dest = path.join(storageDir, `${crypto.randomUUID()}${ext}`)
      await fs.promises.copyFile(src, dest)

      const vector = await extractFeature(dest)
      const signature = await computeSignature(dest)
      const id = store.addImage({
        path: dest,
        vector,
        description: '',
        tags: [],
        contentHash: hash,
        fileSize: size,
        signature
      })
      vectorIndex.add(id, vector)
      succeeded += 1
    } catch (err) {
      failed += 1
      console.error('[import] 处理失败', src, err)
    }
    opts.onProgress?.({ done: i + 1, total, current: name, failed, duplicates })
  }

  return {
    total,
    succeeded,
    failed,
    duplicates,
    elapsedMs: Date.now() - started,
    duplicateNames
  }
}

/**
 * 为历史记录补算内容哈希与感知签名。
 * 老版本入库的图没有这两项，补上之后才能享受导入去重与查重。
 */
export async function backfillFingerprints(
  onProgress?: (done: number, total: number) => void
) {
  const store = getStore()
  const missingHash = store.rowsMissingHash()
  const missingSig = store.rowsMissingSignature()
  const total = missingHash.length + missingSig.length
  if (total === 0) {
    onProgress?.(0, 0)
    return 0
  }

  let done = 0
  const tick = async () => {
    done += 1
    if (done % 20 === 0) {
      onProgress?.(done, total)
      await new Promise((resolve) => setImmediate(resolve))
    }
  }

  for (const row of missingHash) {
    try {
      if (fs.existsSync(row.path)) {
        const { hash, size } = await sha256File(row.path)
        store.updateHash(row.id, hash, size)
      }
    } catch (err) {
      console.warn('[fingerprint] 哈希补算失败', row.path, err)
    }
    await tick()
  }

  for (const row of missingSig) {
    try {
      if (fs.existsSync(row.path)) {
        store.setSignature(row.id, await computeSignature(row.path))
      }
    } catch (err) {
      console.warn('[fingerprint] 签名补算失败', row.path, err)
    }
    await tick()
  }

  onProgress?.(total, total)
  return total
}
