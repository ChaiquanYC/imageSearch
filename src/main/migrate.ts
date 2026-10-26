import fs from 'node:fs'
import path from 'node:path'
import type { MigrateMode } from '../shared/types'

/**
 * 把 src 目录下的所有内容搬到 dst。
 * 目标存在同名项时先删再搬（与 Python 版行为一致）。
 *
 * - copy：只复制，源目录保留
 * - move：优先 rename（同盘瞬时完成），跨盘时降级为「复制 → 校验 → 删源」
 */
export function migrateDirectoryContents(
  src: string,
  dst: string,
  mode: MigrateMode = 'copy'
): number {
  const from = path.resolve(src)
  const to = path.resolve(dst)
  if (from === to) return 0
  if (!fs.existsSync(from)) throw new Error(`源目录不存在：${src}`)

  // 目标目录落在源目录里面会导致边搬边读，直接拒绝
  if (to.startsWith(from.endsWith(path.sep) ? from : from + path.sep)) {
    throw new Error('目标目录不能是源目录的子目录')
  }
  // 反过来也不行：源在目标里，删源会连带删掉目标
  if (from.startsWith(to.endsWith(path.sep) ? to : to + path.sep)) {
    throw new Error('源目录不能是目标目录的子目录')
  }

  fs.mkdirSync(to, { recursive: true })
  const items = fs.readdirSync(from)
  for (const item of items) {
    const s = path.join(from, item)
    const d = path.join(to, item)
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true })
    if (mode === 'move') moveEntry(s, d)
    else fs.cpSync(s, d, { recursive: true, preserveTimestamps: true })
  }

  if (mode === 'move') removeEmptyDir(from)
  return items.length
}

/** 兼容旧调用点 */
export function copyDirectoryContents(src: string, dst: string): number {
  return migrateDirectoryContents(src, dst, 'copy')
}

function moveEntry(s: string, d: string) {
  try {
    fs.renameSync(s, d)
    return
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // EXDEV：跨盘符，rename 不可用；其余情况也走降级路径
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'EACCES') throw err
  }
  fs.cpSync(s, d, { recursive: true, preserveTimestamps: true })
  // 只有确认目标存在才删源，避免复制失败丢文件
  if (!fs.existsSync(d)) throw new Error(`移动到 ${d} 失败，源文件已保留`)
  fs.rmSync(s, { recursive: true, force: true })
}

/** 只删空目录，里面还有东西就留着（保守，绝不递归删未知内容） */
function removeEmptyDir(dir: string) {
  try {
    if (!fs.existsSync(dir)) return
    const left = fs.readdirSync(dir)
    if (left.length === 0) fs.rmdirSync(dir)
    else console.warn('[migrate] 源目录仍有残留，未删除：', dir, left.slice(0, 5))
  } catch (err) {
    console.warn('[migrate] 删除源目录失败', dir, err)
  }
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
