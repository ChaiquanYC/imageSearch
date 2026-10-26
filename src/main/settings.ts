import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { DType, Settings } from '../shared/types'
let cache: Settings | null = null

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function defaultRoot() {
  return path.join(app.getPath('userData'), 'data')
}

export function defaultSettings(): Settings {
  const root = defaultRoot()
  return {
    modelId: 'Xenova/dinov2-small',
    modelDir: path.join(root, 'models'),
    storageDir: path.join(root, 'images'),
    dbFolder: path.join(root, 'database'),
    hfMirror: 'https://hf-mirror.com',
    dtype: 'fp32' as DType,
    device: process.platform === 'win32' ? 'dml' : 'cpu',
    textModelId: 'Xenova/bge-small-zh-v1.5',
    migrateMode: 'move',
    dedupeOnImport: true
  }
}

/**
 * 读取配置。始终返回内存中的最新对象，避免像 Python 版那样
 * 在模块顶层 import 出路径快照，导致改目录后新文件仍写旧目录。
 */
export function getSettings(): Settings {
  if (cache) return cache
  const base = defaultSettings()
  const file = settingsFile()
  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<Settings>
      cache = { ...base, ...raw }
    } catch {
      cache = base
    }
  } else {
    cache = base
  }
  return cache
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const merged = { ...getSettings(), ...patch }
  const file = settingsFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(merged, null, 2), 'utf-8')
  cache = merged
  return merged
}

export function ensureDirs(s: Settings = getSettings()) {
  for (const dir of [s.modelDir, s.storageDir, s.dbFolder]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
