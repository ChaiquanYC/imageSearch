import path from 'node:path'
import {
  env,
  AutoImageProcessor,
  AutoModel,
  RawImage
} from '@huggingface/transformers'

const MODEL_ID = process.env.MODEL_ID || 'Xenova/dinov2-small'

env.allowRemoteModels = true
env.allowLocalModels = true
env.useBrowserCache = false
env.cacheDir = path.resolve('.model-cache')
env.remoteHost = 'https://hf-mirror.com/'

function solid(w, h, r, g, b) {
  const data = new Uint8Array(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    data[i * 3] = r
    data[i * 3 + 1] = g
    data[i * 3 + 2] = b
  }
  return new RawImage(data, w, h, 3)
}

function stripes(w, h, phase) {
  const data = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.sin((x + phase) / 8) * 0.5 + 0.5
      const i = (y * w + x) * 3
      data[i] = Math.round(v * 255)
      data[i + 1] = Math.round((1 - v) * 255)
      data[i + 2] = 90
    }
  }
  return new RawImage(data, w, h, 3)
}

const t0 = Date.now()
console.log('[smoke] 加载处理器…')
const processor = await AutoImageProcessor.from_pretrained(MODEL_ID, {
  progress_callback: (p) => {
    if (p.status === 'progress' && p.file) {
      process.stdout.write(`\r  ${path.basename(p.file)} ${(p.progress ?? 0).toFixed(1)}%   `)
    }
  }
})
console.log('\n[smoke] 加载模型…')
const model = await AutoModel.from_pretrained(MODEL_ID, {
  dtype: 'fp32',
  progress_callback: (p) => {
    if (p.status === 'progress' && p.file) {
      process.stdout.write(`\r  ${path.basename(p.file)} ${(p.progress ?? 0).toFixed(1)}%   `)
    }
  }
})
console.log(`\n[smoke] 加载完成 ${((Date.now() - t0) / 1000).toFixed(1)}s`)

const config = model.config ?? {}
console.log('[smoke] config.hidden_size =', config.hidden_size, '| model_type =', config.model_type)

async function embed(img) {
  const inputs = await processor(img)
  const out = await model(inputs)
  const keys = Object.keys(out)
  let tensor = out.pooler_output ?? out.last_hidden_state
  const dims = tensor.dims
  const data = tensor.data instanceof Float32Array ? tensor.data : Float32Array.from(tensor.data)
  return { keys, dims, data }
}

const a = await embed(solid(224, 224, 200, 30, 30))
console.log('[smoke] 输出字段:', a.keys.join(', '), '| dims =', JSON.stringify(a.dims))

const b = await embed(solid(224, 224, 30, 30, 200))
const c = await embed(stripes(224, 224, 0))
const d = await embed(stripes(224, 224, 3))

const dim = a.dims[a.dims.length - 1]
const vec = (t) => t.data.slice(0, dim)
const norm = (v) => {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i] * v[i]
  s = Math.sqrt(s)
  const o = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) o[i] = v[i] / s
  return o
}
const cosine = (x, y) => {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i] * y[i]
  return s
}

const va = norm(vec(a))
const vb = norm(vec(b))
const vc = norm(vec(c))
const vd = norm(vec(d))

const l2 = (x, y) => {
  let s = 0
  for (let i = 0; i < x.length; i++) s += (x[i] - y[i]) ** 2
  return Math.sqrt(s)
}

console.log('[smoke] 维度 =', dim)
console.log('[smoke] cos(红,蓝)     =', cosine(va, vb).toFixed(4), '| L2 =', l2(va, vb).toFixed(4))
console.log('[smoke] cos(条纹0,条纹3) =', cosine(vc, vd).toFixed(4), '| L2 =', l2(vc, vd).toFixed(4))
console.log('[smoke] cos(红,条纹0)   =', cosine(va, vc).toFixed(4))
console.log('[smoke] 单张耗时 =', ((Date.now() - t0) / 1).toFixed(0), 'ms(含加载)')
const tInfer = Date.now()
await embed(stripes(224, 224, 7))
console.log('[smoke] 纯推理一张 =', Date.now() - tInfer, 'ms')
console.log('[smoke] OK')
