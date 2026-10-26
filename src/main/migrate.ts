import fs from 'node:fs'
import path from 'node:path'

/**
 * 把 src 目录下的所有内容复制到 dst。
 * 与 Python 版行为保持一致：目标存在同名项时先删再拷。
 */
export function copyDirectoryContents(src: string, dst: string): number {
  const from = path.resolve(src)
  const to = path.resolve(dst)
  if (from === to) return 0
  if (!fs.existsSync(from)) throw new Error(`源目录不存在：${src}`)

  fs.mkdirSync(to, { recursive: true })
  const items = fs.readdirSync(from)
  for (const item of items) {
    const s = path.join(from, item)
    const d = path.join(to, item)
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true })
    fs.cpSync(s, d, { recursive: true, preserveTimestamps: true })
  }
  return items.length
}

export function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0
  let n = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name))
    else n += 1
  }
  return n
}
