import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import type {
  ImportSummary,
  MigrateResult,
  ReindexProgress,
  SearchHit,
  SearchResult,
  Settings
} from '../shared/types'
import { modelMeta } from '../shared/types'
import { closeStore, getStore, openStore } from './database'
import {
  extractFeature,
  extractFeatureFromBuffer,
  getDimension,
  getModelState,
  loadEmbedder
} from './embedder'
import { importImages } from './importer'
import { copyDirectoryContents } from './migrate'
import { ensureDirs, getSettings, saveSettings } from './settings'
import { vectorIndex } from './vector-index'

let getWindow: () => BrowserWindow | null = () => null

export function setWindowGetter(fn: () => BrowserWindow | null) {
  getWindow = fn
}

function send(channel: string, payload: unknown) {
  const win = getWindow()
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function showOpen(options: Electron.OpenDialogOptions) {
  const win = getWindow()
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)
}

/** 从数据库全量重建内存索引 */
export function reloadIndexFromDb() {
  const store = getStore()
  const dump = store.loadVectors()
  const dim = dump.dim || getDimension() || modelMeta(getSettings().modelId).dimension
  if (vectorIndex.dimension !== dim) vectorIndex.reinit(dim)
  vectorIndex.addMany(dump.ids, dump.flat)
  return { count: dump.ids.length, dim }
}

function assertModelReady() {
  const state = getModelState()
  if (!state.ready) {
    throw new Error(
      state.loading ? '模型仍在加载中，请稍候…' : `模型不可用：${state.error ?? '未初始化'}`
    )
  }
}

function searchByVector(vector: Float32Array, k: number): SearchResult {
  const started = Date.now()
  if (vectorIndex.dimension === 0) {
    return { hits: [], requested: k, elapsedMs: Date.now() - started }
  }
  if (vector.length !== vectorIndex.dimension) {
    throw new Error(
      `索引维度 ${vectorIndex.dimension} 与模型维度 ${vector.length} 不一致，请在设置页重建索引`
    )
  }
  const store = getStore()
  const { ids, distances } = vectorIndex.search(vector, k)
  const hits: SearchHit[] = []
  for (let i = 0; i < ids.length; i++) {
    const info = store.getInfoById(ids[i])
    if (!info) continue
    if (!fs.existsSync(info.path)) continue
    const distance = distances[i]
    hits.push({
      id: ids[i],
      path: info.path,
      description: info.description,
      distance,
      score: 1 / (1 + distance)
    })
  }
  return { hits, requested: k, elapsedMs: Date.now() - started }
}

export function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    userData: app.getPath('userData')
  }))

  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:update', (_e, patch: Partial<Settings>) => {
    const next = saveSettings(patch)
    ensureDirs(next)
    return next
  })

  ipcMain.handle('dialog:pickImages', async () => {
    const result = await showOpen({
      title: '选择图片入库',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('dialog:pickImage', async () => {
    const result = await showOpen({
      title: '选择查询图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:pickDirectory', async (_e, defaultPath?: string) => {
    const result = await showOpen({
      title: '选择目录',
      defaultPath: defaultPath && fs.existsSync(defaultPath) ? defaultPath : undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle('library:stats', () => {
    const store = getStore()
    return store.getStatistics(vectorIndex.dimension || getDimension())
  })

  ipcMain.handle('library:page', (_e, page: number, pageSize: number) => {
    return getStore().getPage(Math.max(1, page), Math.max(1, pageSize))
  })

  ipcMain.handle('library:import', async (_e, paths: string[]): Promise<ImportSummary> => {
    assertModelReady()
    const summary = await importImages(paths, {
      onProgress: (p) => send('import:progress', p)
    })
    return summary
  })

  ipcMain.handle('library:delete', (_e, ids: number[]) => {
    const store = getStore()
    let removed = 0
    for (const id of ids) {
      const p = store.deleteImage(id)
      vectorIndex.remove(id)
      if (p && fs.existsSync(p)) {
        try {
          fs.rmSync(p, { force: true })
        } catch {
          /* 文件被占用时忽略，记录仍在库里已删 */
        }
      }
      removed += 1
    }
    return removed
  })

  ipcMain.handle('library:updateDescription', (_e, id: number, description: string) => {
    getStore().updateDescription(id, description)
  })

  ipcMain.handle('library:batchDescription', (_e, ids: number[], description: string) => {
    getStore().updateDescriptions(ids, description)
  })

  ipcMain.handle('search:byFile', async (_e, filePath: string, k: number) => {
    assertModelReady()
    const vector = await extractFeature(filePath)
    return searchByVector(vector, k)
  })

  ipcMain.handle('search:byImageData', async (_e, dataUrl: string, k: number) => {
    assertModelReady()
    const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl
    const vector = await extractFeatureFromBuffer(Buffer.from(base64, 'base64'))
    return searchByVector(vector, k)
  })

  ipcMain.handle('model:state', () => getModelState())

  ipcMain.handle('model:switch', async (_e, modelId: string, dtype: string) => {
    const prev = getSettings()
    const next = saveSettings({ modelId, dtype: dtype === 'q8' ? 'q8' : 'fp32' })
    try {
      const state = await loadEmbedder(next, (p) => send('model:progress', p))
      vectorIndex.reinit(state.dimension)
      await reindexAll((p) => send('reindex:progress', p))
      return state
    } catch (err) {
      saveSettings({ modelId: prev.modelId, dtype: prev.dtype })
      try {
        await loadEmbedder(getSettings())
        reloadIndexFromDb()
      } catch {
        /* 回滚也失败时保留错误态 */
      }
      throw err
    }
  })

  ipcMain.handle('model:reindex', async () => {
    assertModelReady()
    return reindexAll((p) => send('reindex:progress', p))
  })

  ipcMain.handle('migrate:storage', (_e, target: string): MigrateResult => {
    const old = getSettings().storageDir
    const moved = copyDirectoryContents(old, target)
    const records = getStore().rewritePathPrefix(old, target)
    saveSettings({ storageDir: target })
    ensureDirs()
    return { moved, records }
  })

  ipcMain.handle('migrate:db', (_e, target: string): MigrateResult => {
    const old = getSettings().dbFolder
    // 先把 WAL 落盘并断开，否则复制到的是不完整的数据库
    closeStore()
    try {
      const moved = copyDirectoryContents(old, target)
      openStore(target)
      saveSettings({ dbFolder: target })
      ensureDirs()
      const { count } = reloadIndexFromDb()
      return { moved, records: count }
    } catch (err) {
      openStore(old)
      throw err
    }
  })

  ipcMain.handle('migrate:model', async (_e, target: string) => {
    const old = getSettings().modelDir
    const moved = copyDirectoryContents(old, target)
    const next = saveSettings({ modelDir: target })
    ensureDirs(next)
    const state = await loadEmbedder(next, (p) => send('model:progress', p))
    return { moved, records: state.dimension }
  })

  ipcMain.handle('shell:showInFolder', (_e, target: string) => {
    if (fs.existsSync(target)) shell.showItemInFolder(target)
  })

  ipcMain.handle('shell:openPath', (_e, target: string) => shell.openPath(target))
}

/** 清空旧向量 → 逐张重提 → 批量落盘 → 重载索引 */
async function reindexAll(onProgress: (p: ReindexProgress) => void): Promise<number> {
  const store = getStore()
  const rows = store.getAllIdsAndPaths()
  const total = rows.length
  store.clearVectors()
  vectorIndex.reinit(getDimension())

  const buffer: Array<{ id: number; vector: Float32Array }> = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      if (fs.existsSync(row.path)) {
        const vector = await extractFeature(row.path)
        buffer.push({ id: row.id, vector })
      }
    } catch (err) {
      console.error('[reindex] 失败', row.path, err)
    }
    onProgress({ done: i + 1, total })
  }

  if (buffer.length > 0) store.updateVectorsBatch(buffer)
  reloadIndexFromDb()
  return buffer.length
}
