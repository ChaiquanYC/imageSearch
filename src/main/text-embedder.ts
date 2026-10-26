import path from 'node:path'
import { env, pipeline } from '@huggingface/transformers'
import type { ModelProgress, Settings, TextModelState } from '../shared/types'
import { textModelMeta } from '../shared/types'

type ProgressFn = (p: ModelProgress) => void
type Extractor = Awaited<ReturnType<typeof pipeline<'feature-extraction'>>>

let extractor: Extractor | null = null
let currentKey = ''
/** 当前模型要求的池化方式（BGE 用 cls，MiniLM 系用 mean） */
let currentPooling: 'mean' | 'cls' = 'mean'

let state: TextModelState = {
  id: '',
  ready: false,
  loading: false,
  dimension: 0
}

export function getTextModelState(): TextModelState {
  return state
}

export function getTextDimension(): number {
  return state.dimension
}

export function getTextPooling(): 'mean' | 'cls' {
  return currentPooling
}

export function isTextModelReady(): boolean {
  return Boolean(extractor)
}

function configure(s: Settings) {
  env.allowRemoteModels = true
  env.allowLocalModels = true
  env.useBrowserCache = false
  env.cacheDir = s.modelDir
  if (s.hfMirror) env.remoteHost = s.hfMirror.replace(/\/+$/, '') + '/'
}

export async function loadTextEmbedder(settings: Settings, onProgress?: ProgressFn) {
  // 文本模型统一用 int8：这几款小模型量化后精度几乎无损，
  // 但体积只有 fp32 的四分之一，首次下载和 CPU 推理都轻松得多。
  const key = `${settings.textModelId}::dml-${settings.device}`
  if (extractor && currentKey === key) return state

  const meta = textModelMeta(settings.textModelId)
  state = { id: settings.textModelId, ready: false, loading: true, dimension: state.dimension }
  configure(settings)
  onProgress?.({
    stage: 'load',
    message: `正在加载文本模型 ${textModelMeta(settings.textModelId).label}…`
  })

  const dtype = 'q8' as const
  const attempt = async (device: 'cpu' | 'dml') => {
    const pipe = await pipeline('feature-extraction', settings.textModelId, {
      dtype,
      device,
      progress_callback: (p: Record<string, unknown>) =>
        onProgress?.({
          stage: 'download',
          file: typeof p.file === 'string' ? path.basename(p.file) : undefined,
          progress: typeof p.progress === 'number' ? p.progress : undefined
        })
    })
    return pipe
  }

  try {
    let usedDevice: 'cpu' | 'dml' = settings.device
    try {
      extractor = await attempt(usedDevice)
    } catch (err) {
      if (usedDevice === 'dml') {
        console.warn('[text-embedder] DirectML 不可用，回退 CPU', err)
        usedDevice = 'cpu'
        extractor = await attempt('cpu')
      } else {
        throw err
      }
    }
    state = { id: settings.textModelId, ready: true, loading: false, dimension: meta.dimension }
    currentPooling = meta.pooling
    currentKey = key
    onProgress?.({ stage: 'ready', message: `文本模型就绪 · ${state.dimension} 维` })
    return state
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    state = { ...state, ready: false, loading: false, error: message }
    onProgress?.({ stage: 'error', message })
    throw err
  }
}

/** 释放文本模型，切模型/切引擎时调用 */
export function disposeTextEmbedder() {
  extractor = null
  currentKey = ''
  state = { ...state, ready: false }
}

/** 把一段文字编码成已归一化的向量 */
export async function embedText(text: string): Promise<Float32Array> {
  if (!extractor) throw new Error('文本模型尚未加载')
  const input = text.trim()
  if (!input) throw new Error('文本为空')
  const output = (await extractor(input, {
    pooling: currentPooling,
    normalize: true
  })) as unknown as {
    dims: number[]
    data: Float32Array | number[]
  }
  const data = output.data instanceof Float32Array ? output.data : Float32Array.from(output.data)
  const dim = output.dims[output.dims.length - 1] ?? data.length
  return data.length === dim ? data.slice() : data.slice(0, dim)
}
