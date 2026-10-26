import crypto from 'node:crypto'
import fs from 'node:fs'

/** 流式计算文件 SHA-256，避免把大图整块读进内存 */
export async function sha256File(filePath: string): Promise<{ hash: string; size: number }> {
  const hash = crypto.createHash('sha256')
  let size = 0
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })
    stream.on('data', (chunk) => {
      size += chunk.length
      hash.update(chunk)
    })
    stream.on('end', () => resolve())
    stream.on('error', reject)
  })
  return { hash: hash.digest('hex'), size }
}

/** 并查集：把相似对合并成组 */
export class UnionFind {
  private parent = new Map<number, number>()

  find(x: number): number {
    let p = this.parent.get(x)
    if (p === undefined) {
      this.parent.set(x, x)
      return x
    }
    if (p === x) return x
    // 路径压缩
    p = this.find(p)
    this.parent.set(x, p)
    return p
  }

  union(a: number, b: number) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(rb, ra)
  }
}
