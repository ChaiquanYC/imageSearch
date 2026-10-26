import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ImageSearchApi } from '../shared/api'
import type {
  Device,
  MigrateMode,
  PageQuery,
  SearchRequest,
  Settings
} from '../shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: ImageSearchApi = {
  isElectron: true,

  info: () => ipcRenderer.invoke('app:info'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:update', patch),

  pickImages: () => ipcRenderer.invoke('dialog:pickImages'),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
  pickDirectory: (defaultPath?: string) => ipcRenderer.invoke('dialog:pickDirectory', defaultPath),

  getStats: () => ipcRenderer.invoke('library:stats'),
  getPage: (query: PageQuery) => ipcRenderer.invoke('library:page', query),
  listTags: () => ipcRenderer.invoke('library:tags'),

  importImages: (paths: string[]) => ipcRenderer.invoke('library:import', paths),

  trashImages: (ids: number[]) => ipcRenderer.invoke('library:trash', ids),
  restoreImages: (ids: number[]) => ipcRenderer.invoke('library:restore', ids),
  purgeImages: (ids: number[]) => ipcRenderer.invoke('library:purge', ids),
  purgeAllTrash: () => ipcRenderer.invoke('library:purgeAll'),

  updateDescription: (id: number, description: string) =>
    ipcRenderer.invoke('library:updateDescription', id, description),
  batchDescription: (ids: number[], description: string) =>
    ipcRenderer.invoke('library:batchDescription', ids, description),
  updateTags: (id: number, tags: string[]) => ipcRenderer.invoke('library:updateTags', id, tags),
  batchTags: (ids: number[], tags: string[], append: boolean) =>
    ipcRenderer.invoke('library:batchTags', ids, tags, append),

  exportImages: (ids: number[], targetDir: string) =>
    ipcRenderer.invoke('library:export', ids, targetDir),

  search: (req: SearchRequest) => ipcRenderer.invoke('search:run', req),
  searchByFile: (filePath: string, k: number) => ipcRenderer.invoke('search:byFile', filePath, k),
  searchByImageData: (dataUrl: string, k: number) =>
    ipcRenderer.invoke('search:byImageData', dataUrl, k),

  getModelState: () => ipcRenderer.invoke('model:state'),
  switchModel: (modelId: string, dtype: string) =>
    ipcRenderer.invoke('model:switch', modelId, dtype),
  setDevice: (device: Device) => ipcRenderer.invoke('model:setDevice', device),
  reindexAll: () => ipcRenderer.invoke('model:reindex'),

  getTextState: () => ipcRenderer.invoke('text:state'),
  switchTextModel: (textModelId: string) => ipcRenderer.invoke('text:switch', textModelId),
  reindexText: () => ipcRenderer.invoke('text:reindex'),

  scanDuplicates: (threshold: number) => ipcRenderer.invoke('duplicates:scan', threshold),
  purgeDuplicates: (ids: number[]) => ipcRenderer.invoke('duplicates:purge', ids),

  migrate: (kind: 'storage' | 'db' | 'model', target: string, mode: MigrateMode) =>
    ipcRenderer.invoke(`migrate:${kind}`, target, mode),

  showInFolder: (target: string) => ipcRenderer.invoke('shell:showInFolder', target),
  openPath: (target: string) => ipcRenderer.invoke('shell:openPath', target),

  thumb: (target: string, size?: number) =>
    `thumb://local/?p=${encodeURIComponent(target)}${size ? `&s=${size}` : ''}`,
  pathForFile: (file: File) => webUtils.getPathForFile(file),

  onImportProgress: (cb) => subscribe('import:progress', cb),
  onModelProgress: (cb) => subscribe('model:progress', cb),
  onReindexProgress: (cb) => subscribe('reindex:progress', cb),
  onDedupeProgress: (cb) => subscribe('dedupe:progress', cb),
  onAppReady: (cb) => subscribe('app:ready', cb),
  onAppError: (cb) => subscribe('app:error', cb),
  onOpenQuery: (cb) => subscribe('search:open', cb)
}

contextBridge.exposeInMainWorld('api', api)
