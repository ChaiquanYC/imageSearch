import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import type {
  Device,
  DuplicateScanProgress,
  DuplicateScanResult,
  ExportResult,
  ImportSummary,
  MigrateMode,
  MigrateResult,
  PageQuery,
  ReindexProgress,
  SearchRequest,
  Settings
} from '../shared/types'
import { modelMeta } from '../shared/types'
import { closeStore, getStore, openStore } from './database'
import { purgeIds, scanDuplicates } from './duplicates'
import { extractFeature, getDimension, getModelState, loadEmbedder } from './embedder'
import { exportImages } from './exporter'
import { backfillFingerprints, importImages } from './importer'
import { migrateDirectoryContents } from './migrate'
import {
  ensureTextIndex,
  getTextState,
  invalidateTextIndex,
  reindexTextAll,
  runSearch,
  searchByVector,
  syncTextVector,
  syncTextVectors
} from './search'
import { ensureDirs, getSettings, saveSettings } from './settings'
import { disposeTextEmbedder, getTextDimension, loadTextEmbedder } from './text-embedder'
import { textIndex, vectorIndex } from './vector-index'

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

export function availableDevices(): Device[] {
  if (process.platform !== 'win32') return ['cpu']
  // DirectML 随 onnxruntime-node 一起分发；加载失败会自动回退 CPU
  return ['cpu', 'dml']
}

/** 从数据库全量重建内存索引（图像 + 已加载的文本索引） */
export function reloadIndexFromDb() {
  const store = getStore()
  const dump = store.loadVectors()
  const dim = dump.dim || getDimension() || modelMeta(getSettings().modelId).dimension
  if (vectorIndex.dimension !== dim) vectorIndex.reinit(dim)
  vectorIndex.addMany(dump.ids, dump.flat)

  if (textIndex.dimension > 0 || getTextState().ready) {
    const textDump = store.loadTextVectors()
    const textDim = textDump.dim || getTextDimension()
    if (textDim > 0) {
      textIndex.reinit(textDim)
      if (textDump.ids.length > 0) textIndex.addMany(textDump.ids, textDump.flat)
    }
  }
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

function removeFiles(paths: string[]) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) fs.rmSync(p, { force: true })
    } catch {
      /* 文件被占用时忽略 */
    }
  }
}

export function registerIpc() {
  ipcMain.handle('app:info', async () => {
    let gpuName: string | null = null
    try {
      const info = (await app.getGPUInfo('basic')) as {
        gpuDevice?: Array<{ deviceString?: string }>
      }
      gpuName = info.gpuDevice?.[0]?.deviceString ?? null
    } catch {
      /* 某些环境拿不到 GPU 信息 */
    }
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: `${process.platform} ${process.arch}`,
      userData: app.getPath('userData'),
      availableDevices: availableDevices(),
      gpuName
    }
  })

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
    return store.getStatistics(vectorIndex.dimension || getDimension(), getTextDimension())
  })

  ipcMain.handle('library:page', (_e, query: PageQuery) => {
    return getStore().getPage({
      page: Math.max(1, Number(query?.page) || 1),
      pageSize: Math.max(1, Number(query?.pageSize) || 20),
      keyword: query?.keyword,
      tag: query?.tag,
      onlyWithDescription: query?.onlyWithDescription,
      sort: query?.sort,
      trash: Boolean(query?.trash)
    })
  })

  ipcMain.handle('library:tags', () => getStore().listTags())

  ipcMain.handle('library:import', async (_e, paths: string[]): Promise<ImportSummary> => {
    assertModelReady()
    const summary = await importImages(paths, {
      onProgress: (p) => send('import:progress', p)
    })
    return summary
  })

  // 删除 = 进回收站，文件保留，可恢复
  ipcMain.handle('library:trash', (_e, ids: number[]) => {
    const removed = getStore().trash(ids)
    for (const id of ids) vectorIndex.remove(id)
    // 文本索引里也摘掉，避免检索到已删记录
    for (const id of ids) textIndex.remove(id)
    return removed
  })

  ipcMain.handle('library:restore', (_e, ids: number[]) => {
    const store = getStore()
    const affected = store.restore(ids)
    // 恢复后把向量放回内存索引（维度对不上说明模型换过，等重建索引即可）
    for (const id of ids) {
      const vec = store.getVectorById(id)
      if (!vec) continue
      try {
        if (vectorIndex.dimension === 0) vectorIndex.reinit(vec.length)
        if (vec.length === vectorIndex.dimension) vectorIndex.add(id, vec)
      } catch (err) {
        console.warn('[restore] 图像向量回填失败', id, err)
      }
      const textVec = store.getTextVector(id)
      if (textVec) {
        try {
          if (textIndex.dimension === textVec.length) textIndex.add(id, textVec)
        } catch (err) {
          console.warn('[restore] 文本向量回填失败', id, err)
        }
      }
    }
    return affected
  })

  ipcMain.handle('library:purge', (_e, ids: number[]) => purgeIds(ids))

  ipcMain.handle('library:purgeAll', () => {
    const store = getStore()
    const paths = store.purgeAllTrash()
    const count = paths.length
    removeFiles(paths)
    return count
  })

  ipcMain.handle('library:updateDescription', async (_e, id: number, description: string) => {
    getStore().updateDescription(id, description)
    await syncTextVector(id, description)
  })

  ipcMain.handle('library:batchDescription', async (_e, ids: number[], description: string) => {
    getStore().updateDescriptions(ids, description)
    await syncTextVectors(ids, description)
  })

  ipcMain.handle('library:updateTags', (_e, id: number, tags: string[]) => {
    getStore().updateTags(id, tags)
  })

  ipcMain.handle('library:batchTags', (_e, ids: number[], tags: string[], append: boolean) => {
    const store = getStore()
    if (append) store.appendTagsBatch(ids, tags)
    else store.updateTagsBatch(ids, tags)
  })

  ipcMain.handle(
    'library:export',
    async (_e, ids: number[], targetDir: string): Promise<ExportResult> => {
      return exportImages(ids, targetDir, { metadata: true })
    }
  )

  ipcMain.handle('search:run', async (_e, req: SearchRequest) => {
    if (req.mode !== 'text') assertModelReady()
    return runSearch({ ...req, onProgress: (p) => send('model:progress', p) })
  })

  // 兼容旧入口（外部 --query 启动、脚本调用）
  ipcMain.handle('search:byFile', async (_e, filePath: string, k: number) => {
    assertModelReady()
    const vector = await extractFeature(filePath)
    return searchByVector(vector, k)
  })

  ipcMain.handle('search:byImageData', async (_e, dataUrl: string, k: number) => {
    assertModelReady()
    return runSearch({ mode: 'image', k, imageDataUrl: dataUrl })
  })

  ipcMain.handle('model:state', () => getModelState())
  ipcMain.handle('text:state', () => getTextState())

  ipcMain.handle('model:switch', async (_e, modelId: string, dtype: string) => {
    const prev = getSettings()
    const next = saveSettings({ modelId, dtype: dtype === 'q8' ? 'q8' : 'fp32' })
    try {
      const state = await loadEmbedder(next, (p) => send('model:progress', p))
      vectorIndex.reinit(state.dimension)
      await reindexAll((p) => send('reindex:progress', { ...p, phase: 'image' }))
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

  // 只切推理引擎（cpu / dml），向量不失效，无需重扫
  ipcMain.handle('model:setDevice', async (_e, device: Device) => {
    const prev = getSettings()
    const next = saveSettings({ device })
    try {
      const state = await loadEmbedder(next, (p) => send('model:progress', p))
      // 文本模型也换个后端；已建好的向量不受影响
      if (getTextState().ready) {
        disposeTextEmbedder()
        invalidateTextIndex()
        await loadTextEmbedder(next, (p) => send('model:progress', p))
      }
      return state
    } catch (err) {
      saveSettings({ device: prev.device })
      try {
        await loadEmbedder(getSettings())
      } catch {
        /* ignore */
      }
      throw err
    }
  })

  ipcMain.handle('text:switch', async (_e, textModelId: string) => {
    const prev = getSettings()
    const next = saveSettings({ textModelId })
    try {
      disposeTextEmbedder()
      invalidateTextIndex()
      await loadTextEmbedder(next, (p) => send('model:progress', p))
      await reindexTextAll((done, total) =>
        send('reindex:progress', { done, total, phase: 'text' })
      )
      return getTextState()
    } catch (err) {
      saveSettings({ textModelId: prev.textModelId })
      throw err
    }
  })

  ipcMain.handle('model:reindex', async () => {
    assertModelReady()
    return reindexAll((p) => send('reindex:progress', { ...p, phase: 'image' }))
  })

  ipcMain.handle('text:reindex', async () => {
    await ensureTextIndex((p) => send('model:progress', p))
    return reindexTextAll((done, total) => send('reindex:progress', { done, total, phase: 'text' }))
  })

  ipcMain.handle('duplicates:scan', async (_e, threshold: number): Promise<DuplicateScanResult> => {
    return scanDuplicates(threshold, (p: DuplicateScanProgress) => send('dedupe:progress', p))
  })

  ipcMain.handle('duplicates:purge', (_e, ids: number[]) => purgeIds(ids))

  ipcMain.handle('maintenance:fingerprints', async () => {
    const n = await backfillFingerprints((done, total) =>
      send('dedupe:progress', { done, total })
    )
    return n
  })

  ipcMain.handle(
    'migrate:storage',
    (_e, target: string, mode: MigrateMode = 'move'): MigrateResult => {
      const old = getSettings().storageDir
      const moved = migrateDirectoryContents(old, target, mode)
      const records = getStore().rewritePathPrefix(old, target)
      saveSettings({ storageDir: target })
      ensureDirs()
      return { moved, records, mode, removedSource: mode === 'move' && !fs.existsSync(old) }
    }
  )

  ipcMain.handle(
    'migrate:db',
    (_e, target: string, mode: MigrateMode = 'move'): MigrateResult => {
      const old = getSettings().dbFolder
      // 先把 WAL 落盘并断开，否则搬过去的是不完整的数据库
      closeStore()
      try {
        const moved = migrateDirectoryContents(old, target, mode)
        openStore(target)
        saveSettings({ dbFolder: target })
        ensureDirs()
        const { count } = reloadIndexFromDb()
        return { moved, records: count, mode, removedSource: mode === 'move' && !fs.existsSync(old) }
      } catch (err) {
        // 尽量回到可用状态：新目录能开就用新的，否则开旧的
        try {
          openStore(fs.existsSync(target) ? target : old)
        } catch {
          /* ignore */
        }
        throw err
      }
    }
  )

  ipcMain.handle(
    'migrate:model',
    async (_e, target: string, mode: MigrateMode = 'move'): Promise<MigrateResult> => {
      const old = getSettings().modelDir
      const moved = migrateDirectoryContents(old, target, mode)
      const next = saveSettings({ modelDir: target })
      ensureDirs(next)
      disposeTextEmbedder()
      invalidateTextIndex()
      const state = await loadEmbedder(next, (p) => send('model:progress', p))
      return {
        moved,
        records: state.dimension,
        mode,
        removedSource: mode === 'move' && !fs.existsSync(old)
      }
    }
  )

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
