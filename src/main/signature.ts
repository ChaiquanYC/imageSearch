/**
 * 感知签名：把图片降采样成 8×8 的 RGB（192 字节），入库时算一次存库。
 *
 * 为什么不用 DINOv2 向量判断重复：
 * DINOv2 的 CLS 特征表达的是「语义」，两张纯色图（正红 / 暖橙）在它看来
 * 余弦相似度也能到 0.98，会把不同图判成重复；而真正被重新压缩、缩放过
 * 的同一张图，8×8 平均色几乎不变。所以查重看像素签名，看相似才用向量。
 *
 * 本文件不依赖 Electron，方便被测试脚本直接引用。
 */
export const SIG_SIZE = 8
export const SIG_BYTES = SIG_SIZE * SIG_SIZE * 3

/** 1 表示像素完全一致，0 表示差异最大 */
export function signatureSimilarity(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return 0
  let diff = 0
  for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i])
  return 1 - diff / (a.length * 255)
}

/** 已知像素数据时的降采样（种子脚本、单元测试用） */
export function signatureFromRgb(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const out = new Uint8Array(SIG_BYTES)
  for (let cy = 0; cy < SIG_SIZE; cy++) {
    for (let cx = 0; cx < SIG_SIZE; cx++) {
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      const x0 = Math.floor((cx * width) / SIG_SIZE)
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / SIG_SIZE))
      const y0 = Math.floor((cy * height) / SIG_SIZE)
      const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / SIG_SIZE))
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 3
          r += rgb[i]
          g += rgb[i + 1]
          b += rgb[i + 2]
          n += 1
        }
      }
      const o = (cy * SIG_SIZE + cx) * 3
      out[o] = Math.round(r / n)
      out[o + 1] = Math.round(g / n)
      out[o + 2] = Math.round(b / n)
    }
  }
  return out
}
