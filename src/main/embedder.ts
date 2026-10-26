import path from 'node:path'
import { env, AutoImageProcessor, AutoModel, RawImage } from '@huggingface/transformers'
import type { ModelProgress, ModelState, Settings } from '../shared/types'
import { modelMeta } from '../shared/types'

type ProgressFn = (p: ModelProgress) => void
type ProcessorT = Awaited<ReturnType<typeof AutoImageProcessor.from_pretrained>>
type ModelT = Awaited<ReturnType<typeof AutoModel.from_pretrained>>

let processor: ProcessorT | null = null
let model: ModelT | null = null
let currentKey = ''

let state: ModelState = {
  id: '',
  dtype: 'fp32',
  ready: false,
  loading: false,
  dimension: 0
}

export function getModelState(): ModelState {
  return state
}

export function getDimension(): number {
  return state.dimension
}

function l2normalize(vec: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i]
  norm = Math.sqrt(norm)
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm
  }
  return vec
}

export async function loadEmbedder(settings: Settings, onProgress?: ProgressFn) {
  const key = `${settings.modelId}::${settings.dtype}`
  if (model && processor && currentKey === key) return state

  state = {
    id: settings.modelId,
    dtype: settings.dtype,
    ready: false,
    loading: true,
    dimension: state.dimension
  }

  try {
    env.allowRemoteModels = true
    env.allowLocalModels = true
    env.useBrowserCache = false
    env.cacheDir = settings.modelDir
    if (settings.hfMirror) {
      env.remoteHost = settings.hfMirror.replace(/\/+$/, '') + '/'
    }

    const dtype = settings.dtype === 'q8' ? 'q8' : 'fp32'

    processor = (await AutoImageProcessor.from_pretrained(settings.modelId, {
      progress_callback: (p: Record<string, unknown>) => onProgress?.(toProgress('download', p))
    })) as ProcessorT

    model = await AutoModel.from_pretrained(settings.modelId, {
      dtype,
      progress_callback: (p: Record<string, unknown>) => onProgress?.(toProgress('download', p))
    })

    const cfg = (model.config ?? {}) as unknown as Record<string, number>
    const dim = cfg.hidden_size ?? cfg.d_model ?? modelMeta(settings.modelId).dimension

    currentKey = key
    state = {
      id: settings.modelId,
      dtype: settings.dtype,
      ready: true,
      loading: false,
      dimension: Number(dim) || modelMeta(settings.modelId).dimension
    }
    onProgress?.({ stage: 'ready', message: `模型就绪 · ${state.dimension} 维` })
    return state
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    state = { ...state, ready: false, loading: false, error: message }
    onProgress?.({ stage: 'error', message })
    throw err
  }
}

function toProgress(stage: ModelProgress['stage'], p: Record<string, unknown>): ModelProgress {
  const file = typeof p.file === 'string' ? path.basename(p.file) : undefined
  return {
    stage,
    file,
    progress: typeof p.progress === 'number' ? p.progress : undefined,
    loaded: typeof p.loaded === 'number' ? p.loaded : undefined,
    total: typeof p.total === 'number' ? p.total : undefined,
    message: typeof p.status === 'string' ? p.status : undefined
  }
}

/** 提取单图特征，返回已做 L2 归一化的 Float32Array */
export async function extractFeature(imagePath: string): Promise<Float32Array> {
  if (!model || !processor) throw new Error('模型尚未加载')
  const image = await RawImage.read(imagePath)
  const inputs = await processor(image)
  const output = (await model(inputs as never)) as unknown as Record<string, unknown>

  let tensor = output.pooler_output ?? output.last_hidden_state
  if (Array.isArray(tensor)) tensor = tensor[0]
  if (!tensor) throw new Error('模型未返回特征张量')

  const t = tensor as { dims: number[]; data: Float32Array | number[] }
  const data = t.data instanceof Float32Array ? t.data : Float32Array.from(t.data)
  const dims = t.dims
  let dim: number
  if (dims.length === 2) dim = dims[1]
  else if (dims.length === 3) dim = dims[2]
  else dim = data.length

  // [B, T, D] 时取 CLS token（位置 0）
  const vec = data.slice(0, dim)
  const expected = state.dimension || modelMeta(state.id).dimension
  if (vec.length !== expected) {
    throw new Error(`特征维度异常：得到 ${vec.length}，期望 ${expected}`)
  }
  return l2normalize(vec)
}

/** 供搜索页直接传 base64 图片时使用 */
export async function extractFeatureFromBuffer(buffer: Buffer): Promise<Float32Array> {
  if (!model || !processor) throw new Error('模型尚未加载')
  const image = await RawImage.fromBlob(new Blob([new Uint8Array(buffer)]))
  const inputs = await processor(image)
  const output = (await model(inputs as never)) as unknown as Record<string, unknown>
  let tensor = output.pooler_output ?? output.last_hidden_state
  if (Array.isArray(tensor)) tensor = tensor[0]
  const t = tensor as { dims: number[]; data: Float32Array | number[] }
  const data = t.data instanceof Float32Array ? t.data : Float32Array.from(t.data)
  const dim = t.dims[t.dims.length - 1]
  return l2normalize(data.slice(0, dim))
}
