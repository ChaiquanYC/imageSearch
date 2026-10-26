import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ImageSearchApi } from '../shared/api'
import type { ImageRecord, Settings } from '../shared/types'

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
  getPage: (page: number, pageSize: number) => ipcRenderer.invoke('library:page', page, pageSize),

  importImages: (paths: string[]) => ipcRenderer.invoke('library:import', paths),
  deleteImages: (ids: number[]) => ipcRenderer.invoke('library:delete', ids),
  updateDescription: (id: number, description: string) =>
    ipcRenderer.invoke('library:updateDescription', id, description),
  batchDescription: (ids: number[], description: string) =>
    ipcRenderer.invoke('library:batchDescription', ids, description),

  searchByFile: (filePath: string, k: number) => ipcRenderer.invoke('search:byFile', filePath, k),
  searchByImageData: (dataUrl: string, k: number) =>
    ipcRenderer.invoke('search:byImageData', dataUrl, k),

  getModelState: () => ipcRenderer.invoke('model:state'),
  switchModel: (modelId: string, dtype: string) =>
    ipcRenderer.invoke('model:switch', modelId, dtype),
  reindexAll: () => ipcRenderer.invoke('model:reindex'),

  migrate: (kind: 'storage' | 'db' | 'model', target: string) =>
    ipcRenderer.invoke(`migrate:${kind}`, target),

  showInFolder: (target: string) => ipcRenderer.invoke('shell:showInFolder', target),
  openPath: (target: string) => ipcRenderer.invoke('shell:openPath', target),

  thumb: (target: string, size?: number) =>
    `thumb://local/?p=${encodeURIComponent(target)}${size ? `&s=${size}` : ''}`,
  pathForFile: (file: File) => webUtils.getPathForFile(file),

  onImportProgress: (cb) => subscribe('import:progress', cb),
  onModelProgress: (cb) => subscribe('model:progress', cb),
  onReindexProgress: (cb) => subscribe('reindex:progress', cb),
  onAppReady: (cb) => subscribe('app:ready', cb),
  onAppError: (cb) => subscribe('app:error', cb),
  onOpenQuery: (cb) => subscribe('search:open', cb)
}

contextBridge.exposeInMainWorld('api', api)

export type { ImageRecord }
