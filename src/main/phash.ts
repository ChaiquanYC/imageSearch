import { nativeImage } from 'electron'
import { SIG_BYTES, SIG_SIZE } from './signature'

/**
 * 用原生解码生成感知签名：缩到 8×8 再逐像素取 RGB。
 * 主进程专用（依赖 Electron 的 nativeImage），失败返回 null。
 */
export async function computeSignature(filePath: string): Promise<Uint8Array | null> {
  try {
    const thumb = await nativeImage.createThumbnailFromPath(filePath, {
      width: SIG_SIZE,
      height: SIG_SIZE
    })
    if (thumb.isEmpty()) return null
    const size = thumb.getSize()
    const sized =
      size.width === SIG_SIZE && size.height === SIG_SIZE
        ? thumb
        : thumb.resize({ width: SIG_SIZE, height: SIG_SIZE, quality: 'better' })
    const bmp = sized.toBitmap() // BGRA
    if (bmp.length < SIG_BYTES) return null
    const out = new Uint8Array(SIG_BYTES)
    for (let i = 0; i < SIG_SIZE * SIG_SIZE; i++) {
      out[i * 3] = bmp[i * 4 + 2]
      out[i * 3 + 1] = bmp[i * 4 + 1]
      out[i * 3 + 2] = bmp[i * 4]
    }
    return out
  } catch (err) {
    console.warn('[signature] 计算失败', filePath, err)
    return null
  }
}
