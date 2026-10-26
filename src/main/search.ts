import fs from 'node:fs'
import type {
  ModelProgress,
  SearchHit,
  SearchMode,
  SearchRequest as SearchQuery,
  SearchResult,
  TextModelState
} from '../shared/types'
import { getStore } from './database'
import { extractFeature, extractFeatureFromBuffer } from './embedder'
import { getSettings } from './settings'
import {
  embedText,
  getTextDimension,
  getTextModelState,
  isTextModelReady,
  loadTextEmbedder
} from './text-embedder'
import { textIndex, vectorIndex } from './vector-index'

/** 文本索引是否已与数据库对齐 */
let textIndexReady = false

export function getTextState(): TextModelState {
  return getTextModelState()
}

export function invalidateTextIndex() {
  textIndexReady = false
}

/** 描述变更后同步单条文本向量；模型没加载就先留空，等首次文本检索时批量回填 */
export async function syncTextVector(id: number, description: string) {
  const store = getStore()
  const text = description.trim()
  if (!text) {
    store.updateTextVector(id, null)
    if (textIndexReady) textIndex.remove(id)
    return
  }
  if (!isTextModelReady()) {
    store.updateTextVector(id, null)
    if (textIndexReady) textIndex.remove(id)
    return
  }
  try {
    const vector = await embedText(text)
    store.updateTextVector(id, vector)
    if (textIndexReady && textIndex.dimension === vector.length) textIndex.add(id, vector)
  } catch (err) {
    console.warn('[search] 文本向量生成失败', id, err)
    store.updateTextVector(id, null)
    if (textIndexReady) textIndex.remove(id)
  }
}

export async function syncTextVectors(ids: number[], description: string) {
  for (const id of ids) await syncTextVector(id, description)
}

/**
 * 懒加载文本索引：首次需要文本检索时加载模型、
 * 回填缺失向量、再把整表读进内存索引。
 */
export async function ensureTextIndex(
  onProgress?: (p: ModelProgress) => void
): Promise<void> {
  const settings = getSettings()
  const dim = isTextModelReady() ? getTextDimension() : 0
  if (textIndexReady && textIndex.dimension === dim) return

  if (!isTextModelReady()) {
    onProgress?.({ stage: 'load', message: '正在准备文本检索模型…' })
    await loadTextEmbedder(settings, onProgress)
  }

  const store = getStore()
  const missing = store.rowsMissingTextVector()
  if (missing.length > 0) {
    const expected = getTextDimension()
    const buffer: Array<{ id: number; vector: Float32Array }> = []
    for (let i = 0; i < missing.length; i++) {
      const row = missing[i]
      try {
        const vector = await embedText(row.description)
        if (vector.length !== expected) continue
        buffer.push({ id: row.id, vector })
      } catch (err) {
        console.warn('[search] 回填文本向量失败', row.id, err)
      }
      if (i % 20 === 0) {
        onProgress?.({
          stage: 'reindex',
          message: `正在建立文本索引 ${i + 1}/${missing.length}`
        })
        await new Promise((resolve) => setImmediate(resolve))
      }
    }
    if (buffer.length > 0) store.updateTextVectorsBatch(buffer)
  }

  const dump = store.loadTextVectors()
  const finalDim = dump.dim || getTextDimension()
  textIndex.reinit(finalDim)
  if (dump.ids.length > 0) textIndex.addMany(dump.ids, dump.flat)
  textIndexReady = true
  onProgress?.({ stage: 'ready', message: `文本索引就绪 · ${dump.ids.length} 条` })
}

/** 描述全部重算（换文本模型后调用） */
export async function reindexTextAll(onProgress?: (done: number, total: number) => void) {
  const store = getStore()
  store.clearTextVectors()
  textIndex.reinit(getTextDimension())
  textIndexReady = false
  const missing = store.rowsMissingTextVector()
  onProgress?.(0, missing.length)
  const buffer: Array<{ id: number; vector: Float32Array }> = []
  for (let i = 0; i < missing.length; i++) {
    try {
      const vector = await embedText(missing[i].description)
      buffer.push({ id: missing[i].id, vector })
    } catch {
      /* 单条失败不影响整体 */
    }
    if (i % 20 === 0) {
      onProgress?.(i + 1, missing.length)
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
  if (buffer.length > 0) store.updateTextVectorsBatch(buffer)
  const dump = store.loadTextVectors()
  textIndex.reinit(dump.dim || getTextDimension())
  if (dump.ids.length > 0) textIndex.addMany(dump.ids, dump.flat)
  textIndexReady = true
  onProgress?.(missing.length, missing.length)
  return buffer.length
}

export interface SearchRequest extends SearchQuery {
  onProgress?: (p: ModelProgress) => void
}

interface Row {
  id: number
  imageScore: number | null
  textScore: number | null
  literal: boolean
}

/** 综合得分：双通道命中给一点加成，单通道就取该通道值 */
function compose(row: Row): number {
  const img = row.imageScore
  const txt = row.textScore
  let base: number
  if (img !== null && txt !== null) base = Math.max(img, txt) + 0.05 * Math.min(img, txt)
  else base = img ?? txt ?? 0
  if (row.literal) base += 0.08
  return Math.min(1, base)
}

export async function runSearch(req: SearchRequest): Promise<SearchResult> {
  const started = Date.now()
  const k = Math.max(1, req.k)
  const mode = req.mode
  const pool = Math.max(k * 3, 24)
  const rows = new Map<number, Row>()
  const touch = (id: number): Row => {
    const hit = rows.get(id)
    if (hit) return hit
    const created: Row = { id, imageScore: null, textScore: null, literal: false }
    rows.set(id, created)
    return created
  }

  const wantImage = mode === 'image' || mode === 'hybrid'
  const wantText = mode === 'text' || mode === 'hybrid'

  if (wantImage) {
    let vector: Float32Array | null = null
    if (req.imageDataUrl) {
      const base64 = req.imageDataUrl.includes(',')
        ? req.imageDataUrl.slice(req.imageDataUrl.indexOf(',') + 1)
        : req.imageDataUrl
      vector = await extractFeatureFromBuffer(Buffer.from(base64, 'base64'))
    } else if (req.imagePath) {
      vector = await extractFeature(req.imagePath)
    }

    if (mode === 'image' && !vector) {
      throw new Error('图像检索需要先选择一张查询图')
    }

    if (vector) {
      if (vectorIndex.dimension === 0) {
        // 空库：图像通道没有候选，混合模式下继续走文本
      } else if (vector.length !== vectorIndex.dimension) {
        throw new Error(
          `索引维度 ${vectorIndex.dimension} 与模型维度 ${vector.length} 不一致，请在设置页重建索引`
        )
      } else {
        const { ids, distances } = vectorIndex.search(vector, pool)
        for (let i = 0; i < ids.length; i++) {
          touch(ids[i]).imageScore = 1 / (1 + distances[i])
        }
      }
    }
  }

  const query = req.text?.trim() ?? ''
  if (wantText) {
    if (!query) {
      if (mode === 'text') throw new Error('请输入要检索的文字')
    } else {
      await ensureTextIndex(req.onProgress)
      // 语义通道
      if (textIndex.dimension > 0) {
        try {
          const vector = await embedText(query)
          if (vector.length === textIndex.dimension) {
            const { ids, distances } = textIndex.search(vector, pool)
            for (let i = 0; i < ids.length; i++) {
              // 归一化向量下 L2 距离与余弦单调：cos = 1 - d²/2
              const cos = 1 - (distances[i] * distances[i]) / 2
              touch(ids[i]).textScore = Math.max(0, Math.min(1, cos))
            }
          }
        } catch (err) {
          console.warn('[search] 语义检索失败，仅用字面匹配', err)
        }
      }
      // 字面通道：精确命中描述/标签/文件名，避免语义漂移漏掉全等匹配
      for (const id of getStore().searchLiteral(query, pool)) {
        touch(id).literal = true
      }
    }
  }

  const store = getStore()
  const hits: SearchHit[] = []
  for (const row of rows.values()) {
    const info = store.getInfoById(row.id)
    if (!info) continue
    if (!fs.existsSync(info.path)) continue
    const score = compose(row)
    const via: SearchHit['via'] =
      row.imageScore !== null && (row.textScore !== null || row.literal)
        ? 'both'
        : row.imageScore !== null
          ? 'image'
          : 'text'
    hits.push({
      id: row.id,
      path: info.path,
      description: info.description,
      tags: info.tags,
      distance: row.imageScore !== null ? 1 / row.imageScore - 1 : 0,
      score,
      imageScore: row.imageScore,
      textScore: row.textScore,
      via
    })
  }

  hits.sort((a, b) => b.score - a.score)
  const trimmed = hits.slice(0, k)
  return { hits: trimmed, requested: k, elapsedMs: Date.now() - started, mode }
}

/** 纯图像检索（保留旧签名给老测试脚本用） */
export async function searchByVector(vector: Float32Array, k: number): Promise<SearchResult> {
  const started = Date.now()
  if (vectorIndex.dimension === 0) {
    return { hits: [], requested: k, elapsedMs: Date.now() - started, mode: 'image' }
  }
  if (vector.length !== vectorIndex.dimension) {
    throw new Error(
      `索引维度 ${vectorIndex.dimension} 与模型维度 ${vector.length} 不一致，请在设置页重建索引`
    )
  }
  const store = getStore()
  const { ids, distances } = vectorIndex.search(vector, k)
  const hits: SearchHit[] = []
  for (let i = 0; i < ids.length; i++) {
    const info = store.getInfoById(ids[i])
    if (!info) continue
    if (!fs.existsSync(info.path)) continue
    const distance = distances[i]
    hits.push({
      id: ids[i],
      path: info.path,
      description: info.description,
      tags: info.tags,
      distance,
      score: 1 / (1 + distance),
      imageScore: 1 / (1 + distance),
      textScore: null,
      via: 'image'
    })
  }
  return { hits, requested: k, elapsedMs: Date.now() - started, mode: 'image' }
}
