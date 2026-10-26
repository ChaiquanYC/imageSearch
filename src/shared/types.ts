export type DType = 'fp32' | 'q8'

export interface Settings {
  modelId: string
  modelDir: string
  storageDir: string
  dbFolder: string
  hfMirror: string
  dtype: DType
}

export interface ImageRecord {
  id: number
  path: string
  description: string
  createdAt: string
  hasVector: boolean
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
  descriptionRate: number
  vectorRate: number
  earliest: string | null
  latest: string | null
  dimension: number
}

export interface SearchHit {
  id: number
  path: string
  description: string
  distance: number
  score: number
}

export interface SearchResult {
  hits: SearchHit[]
  requested: number
  elapsedMs: number
}

export interface ImportProgress {
  done: number
  total: number
  current: string
  failed: number
}

export interface ImportSummary {
  total: number
  succeeded: number
  failed: number
  elapsedMs: number
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
  ready: boolean
  loading: boolean
  dimension: number
  error?: string
}

export interface MigrateResult {
  moved: number
  records: number
}

export interface ReindexProgress {
  done: number
  total: number
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  userData: string
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

export function modelMeta(id: string) {
  return MODEL_CATALOG.find((m) => m.id === id) ?? MODEL_CATALOG[0]
}
