import path from 'node:path'

export interface PathRewritePlan {
  /** 新前缀（带尾部分隔符） */
  prefix: string
  /** SUBSTR 的起始位置，1-based */
  startIndex: number
  /** LIKE 模式，已转义通配符 */
  likePattern: string
}

/** LIKE 里 % 和 _ 是通配符，路径里出现时必须转义（用 ! 作为 ESCAPE 字符） */
export function likeEscape(input: string): string {
  return input.replace(/[!%_]/g, (c) => `!${c}`)
}

/**
 * 计算把旧根目录改写成新根目录所需的 SQL 参数。
 * 返回 null 表示新旧一致、无需改写。
 *
 * 生成 SQL：
 *   UPDATE images SET image_path = ? || SUBSTR(image_path, ?)
 *   WHERE image_path LIKE ? ESCAPE '!'
 */
export function planPathRewrite(
  oldRoot: string,
  newRoot: string,
  sep = path.sep
): PathRewritePlan | null {
  if (path.normalize(oldRoot) === path.normalize(newRoot)) return null
  const trimmed = oldRoot.endsWith(sep) ? oldRoot : oldRoot + sep
  const prefix = newRoot.endsWith(sep) ? newRoot : newRoot + sep
  return {
    prefix,
    startIndex: trimmed.length + 1,
    likePattern: `${likeEscape(trimmed)}%`
  }
}
