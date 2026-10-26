import fs from 'node:fs'
import path from 'node:path'
import type { ExportResult } from '../shared/types'
import { getStore } from './database'

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120).trim() || 'image'
}

function csvCell(value: string): string {
  const text = value ?? ''
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * 导出选中记录到目标目录。
 * 文件名沿用原文件名，重名自动加 _1 / _2 后缀；
 * 同时写一份 metadata.csv（带 BOM，Excel 打开不乱码）。
 */
export async function exportImages(
  ids: number[],
  targetDir: string,
  options: { metadata?: boolean } = {}
): Promise<ExportResult> {
  const store = getStore()
  const rows = store.getRecordsByIds(ids)
  fs.mkdirSync(targetDir, { recursive: true })

  let exported = 0
  let skipped = 0
  const used = new Set<string>()
  const lines: string[] = ['文件名,描述,标签,入库时间,原始路径']

  for (const row of rows) {
    if (!fs.existsSync(row.path)) {
      skipped += 1
      continue
    }
    const ext = path.extname(row.path)
    const stem = sanitize(path.basename(row.path, ext))
    let name = `${stem}${ext}`
    let n = 1
    while (used.has(name.toLowerCase())) {
      name = `${stem}_${n}${ext}`
      n += 1
    }
    const dest = path.join(targetDir, name)
    try {
      await fs.promises.copyFile(row.path, dest)
      used.add(name.toLowerCase())
      exported += 1
      lines.push(
        [name, row.description, row.tags.join(','), row.createdAt, row.path]
          .map((cell) => csvCell(cell))
          .join(',')
      )
    } catch (err) {
      console.warn('[export] 复制失败', row.path, err)
      skipped += 1
    }
  }

  let metadataPath: string | null = null
  if (options.metadata !== false && exported > 0) {
    metadataPath = path.join(targetDir, 'metadata.csv')
    fs.writeFileSync(metadataPath, '\uFEFF' + lines.join('\r\n'), 'utf-8')
  }

  return { exported, skipped, metadataPath, targetDir }
}
