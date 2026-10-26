export type DType = 'fp32' | 'q8'

/** 推理后端：cpu 通用；dml 走 DirectML（Windows 显卡加速） */
export type Device = 'cpu' | 'dml'

/** 目录迁移方式：move 搬完删源，copy 保留源（更保守，占双份空间） */
export type MigrateMode = 'move' | 'copy'

export interface Settings {
  modelId: string
  modelDir: string
  storageDir: string
  dbFolder: string
  hfMirror: string
  dtype: DType
  device: Device
  /** 文本检索用的嵌入模型 */
  textModelId: string
  /** 目录迁移默认方式 */
  migrateMode: MigrateMode
  /** 导入时跳过内容完全相同的图片 */
  dedupeOnImport: boolean
}

export interface ImageRecord {
  id: number
  path: string
  description: string
  createdAt: string
  hasVector: boolean
  tags: string[]
  fileSize: number
  deletedAt: string | null
}

export type SortKey = 'newest' | 'oldest' | 'description' | 'size'

export interface PageQuery {
  page: number
  pageSize: number
  /** 关键词：匹配描述 / 标签 / 文件名 */
  keyword?: string
  /** 精确标签筛选 */
  tag?: string
  /** 只看有描述的 */
  onlyWithDescription?: boolean
  sort?: SortKey
  /** true 时列出回收站内容，默认列正常记录 */
  trash?: boolean
}

export interface PageResult {
  rows: ImageRecord[]
  total: number
  page: number
  pageSize: number
}

export interface LibraryStats {
  total: number
  withDescription: number
  withVector: number
  withTags: number
  withTextVector: number
  trashed: number
  descriptionRate: number
  vectorRate: number
  earliest: string | null
  latest: string | null
  dimension: number
  textDimension: number
}

/** 检索模式：image 纯图 / text 纯文字 / hybrid 图文混合 */
export type SearchMode = 'image' | 'text' | 'hybrid'

export interface SearchHit {
  id: number
  path: string
  description: string
  tags: string[]
  distance: number
  /** 综合得分，用于展示与排序，范围 0~1 */
  score: number
  /** 图像通道相似度（1/(1+distance)），未参与时为 null */
  imageScore: number | null
  /** 文本通道余弦相似度，未参与时为 null */
  textScore: number | null
  /** 命中来源 */
  via: 'image' | 'text' | 'both'
}

export interface SearchResult {
  hits: SearchHit[]
  requested: number
  elapsedMs: number
  mode: SearchMode
}

export interface SearchRequest {
  mode: SearchMode
  k: number
  imagePath?: string | null
  imageDataUrl?: string | null
  text?: string | null
}

export interface ImportProgress {
  done: number
  total: number
  current: string
  failed: number
  duplicates: number
}

export interface ImportSummary {
  total: number
  succeeded: number
  failed: number
  duplicates: number
  elapsedMs: number
  duplicateNames: string[]
}

export interface ModelProgress {
  stage: 'download' | 'load' | 'ready' | 'error' | 'reindex'
  file?: string
  progress?: number
  loaded?: number
  total?: number
  message?: string
}

export interface ModelState {
  id: string
  dtype: DType
  device: Device
  /** 请求 dml 但实际回退到了 cpu */
  fellBack: boolean
  ready: boolean
  loading: boolean
  dimension: number
  error?: string
}

export interface TextModelState {
  id: string
  ready: boolean
  loading: boolean
  dimension: number
  error?: string
}

export interface MigrateResult {
  moved: number
  records: number
  mode: MigrateMode
  /** 移动模式下被清空的源目录 */
  removedSource: boolean
}

export interface ReindexProgress {
  done: number
  total: number
  phase?: 'image' | 'text'
}

export interface DuplicateItem {
  id: number
  path: string
  description: string
  tags: string[]
  createdAt: string
  /** 与组内代表图的相似度，0~1 */
  similarity: number
  /** true 表示内容哈希完全相同 */
  exact: boolean
}

export interface DuplicateGroup {
  /** 组代表记录 id（保留项） */
  keepId: number
  similarity: number
  items: DuplicateItem[]
}

export interface DuplicateScanResult {
  groups: DuplicateGroup[]
  scanned: number
  elapsedMs: number
  threshold: number
}

export interface DuplicateScanProgress {
  done: number
  total: number
}

export interface ExportResult {
  exported: number
  skipped: number
  metadataPath: string | null
  targetDir: string
}

export interface TrashResult {
  affected: number
}

export interface TagCount {
  tag: string
  count: number
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  userData: string
  /** 本次运行可用的推理后端 */
  availableDevices: Device[]
  gpuName: string | null
}

export const MODEL_CATALOG = [
  {
    id: 'Xenova/dinov2-small',
    label: 'DINOv2 ViT-S/14',
    dimension: 384,
    size: '约 88 MB',
    note: '速度最快，适合日常素材库'
  },
  {
    id: 'Xenova/dinov2-base',
    label: 'DINOv2 ViT-B/14',
    dimension: 768,
    size: '约 346 MB',
    note: '精度与速度均衡，推荐'
  },
  {
    id: 'Xenova/dinov2-large',
    label: 'DINOv2 ViT-L/14',
    dimension: 1024,
    size: '约 1.1 GB',
    note: '精度最高，CPU 下单张较慢'
  }
] as const

/** 文本嵌入模型候选，全部支持 transformers.js 的 ONNX */
export const TEXT_MODEL_CATALOG = [
  {
    id: 'Xenova/bge-small-zh-v1.5',
    label: 'BGE 中文 small',
    dimension: 512,
    pooling: 'cls' as const,
    size: '约 95 MB（int8 约 25 MB）',
    note: '中文描述排序最准，默认推荐'
  },
  {
    id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    label: '多语言 MiniLM-L12',
    dimension: 384,
    pooling: 'mean' as const,
    size: '约 470 MB（int8 约 120 MB）',
    note: '中英混排都能用，纯中文略弱于 BGE'
  },
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    label: '英文 MiniLM-L6',
    dimension: 384,
    pooling: 'mean' as const,
    size: '约 90 MB（int8 约 23 MB）',
    note: '仅适合英文描述，体积最小'
  }
] as const

export type Pooling = (typeof TEXT_MODEL_CATALOG)[number]['pooling']

export function modelMeta(id: string) {
  return MODEL_CATALOG.find((m) => m.id === id) ?? MODEL_CATALOG[0]
}

export function textModelMeta(id: string) {
  return TEXT_MODEL_CATALOG.find((m) => m.id === id) ?? TEXT_MODEL_CATALOG[0]
}

/** 标签字符串 ↔ 数组。空字符串与空白项统一过滤 */
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

export function joinTags(tags: string[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of tags) {
    const t = tag.trim().replace(/[,\r\n]/g, ' ')
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out.join(',')
}
