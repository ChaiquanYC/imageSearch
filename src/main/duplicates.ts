import fs from 'node:fs'
import type {
  DuplicateGroup,
  DuplicateItem,
  DuplicateScanProgress,
  DuplicateScanResult
} from '../shared/types'
import { getStore } from './database'
import { UnionFind } from './hash'
import { signatureSimilarity } from './signature'
import { vectorIndex } from './vector-index'

/**
 * 重复图扫描，两层判定：
 * 1. 内容哈希完全相同 → 精确重复，similarity 记为 1
 * 2. 感知签名（8×8 平均色）相似度 >= threshold → 视觉近重复
 *
 * 用签名而不是特征向量：DINOv2 的语义相似度会把「正红」和「暖橙」
 * 这种同构图不同内容的图判成 0.98，签名则只看像素，正好互补。
 * 并查集负责把 A≈B、B≈C 的传递关系合并成一组。
 */
export async function scanDuplicates(
  threshold = 0.95,
  onProgress?: (p: DuplicateScanProgress) => void
): Promise<DuplicateScanResult> {
  const started = Date.now()
  const store = getStore()
  const uf = new UnionFind()
  const similarity = new Map<string, number>()
  const exact = new Set<string>()
  const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`)

  const hashGroups = store.duplicateHashGroups()
  for (const group of hashGroups) {
    for (let i = 1; i < group.ids.length; i++) {
      const key = pairKey(group.ids[0], group.ids[i])
      uf.union(group.ids[0], group.ids[i])
      exact.add(key)
      similarity.set(key, 1)
    }
  }

  const items = store.loadSignatures()
  const total = items.length
  onProgress?.({ done: 0, total })
  for (let i = 0; i < total; i++) {
    for (let j = i + 1; j < total; j++) {
      const score = signatureSimilarity(items[i].signature, items[j].signature)
      if (score >= threshold) {
        uf.union(items[i].id, items[j].id)
        const key = pairKey(items[i].id, items[j].id)
        if (!similarity.has(key)) similarity.set(key, score)
      }
    }
    if (i % 16 === 0) {
      onProgress?.({ done: i + 1, total })
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
  onProgress?.({ done: total, total })

  // 归组
  const buckets = new Map<number, number[]>()
  const touched = new Set<number>()
  for (const key of similarity.keys()) {
    const [a, b] = key.split(':').map(Number)
    touched.add(a)
    touched.add(b)
  }
  for (const id of touched) {
    const root = uf.find(id)
    const list = buckets.get(root)
    if (list) list.push(id)
    else buckets.set(root, [id])
  }

  const groups: DuplicateGroup[] = []
  for (const ids of buckets.values()) {
    if (ids.length < 2) continue
    ids.sort((a, b) => a - b)
    // 保留最早入库的那条（id 最小），其余列出
    const keepId = ids[0]
    const records = store.getRecordsByIds(ids)
    const byId = new Map(records.map((r) => [r.id, r]))
    const keep = byId.get(keepId)
    if (!keep) continue

    const rest: DuplicateItem[] = []
    for (const id of ids.slice(1)) {
      const row = byId.get(id)
      if (!row) continue
      const key = pairKey(keepId, id)
      const isExact = exact.has(key)
      rest.push({
        id: row.id,
        path: row.path,
        description: row.description,
        tags: row.tags,
        createdAt: row.createdAt,
        similarity: isExact ? 1 : (similarity.get(key) ?? 0),
        exact: isExact
      })
    }
    if (rest.length === 0) continue
    rest.sort((a, b) => b.similarity - a.similarity)

    groups.push({
      keepId,
      similarity: rest[0].similarity,
      items: [
        {
          id: keep.id,
          path: keep.path,
          description: keep.description,
          tags: keep.tags,
          createdAt: keep.createdAt,
          similarity: 1,
          exact: false
        },
        ...rest
      ]
    })
  }

  groups.sort((a, b) => b.similarity - a.similarity || b.items.length - a.items.length)
  return { groups, scanned: total, elapsedMs: Date.now() - started, threshold }
}

/** 删除指定 id（连同文件），返回实际处理条数 */
export function purgeIds(ids: number[]): number {
  const store = getStore()
  const paths = store.purge(ids)
  for (const id of ids) vectorIndex.remove(id)
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) fs.rmSync(p, { force: true })
    } catch {
      /* 文件被占用时忽略 */
    }
  }
  return paths.length
}
