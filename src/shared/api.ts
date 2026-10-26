import type {
  AppInfo,
  ImportProgress,
  ImportSummary,
  LibraryStats,
  MigrateResult,
  ModelProgress,
  ModelState,
  PageResult,
  ReindexProgress,
  SearchResult,
  Settings
} from './types'

export interface ImageSearchApi {
  isElectron: boolean
  info(): Promise<AppInfo>

  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>

  pickImages(): Promise<string[]>
  pickImage(): Promise<string | null>
  pickDirectory(defaultPath?: string): Promise<string | null>

  getStats(): Promise<LibraryStats>
  getPage(page: number, pageSize: number): Promise<PageResult>

  importImages(paths: string[]): Promise<ImportSummary>
  deleteImages(ids: number[]): Promise<number>
  updateDescription(id: number, description: string): Promise<void>
  batchDescription(ids: number[], description: string): Promise<void>

  searchByFile(filePath: string, k: number): Promise<SearchResult>
  searchByImageData(dataUrl: string, k: number): Promise<SearchResult>

  getModelState(): Promise<ModelState>
  switchModel(modelId: string, dtype: string): Promise<ModelState>
  reindexAll(): Promise<number>

  migrate(kind: 'storage' | 'db' | 'model', target: string): Promise<MigrateResult>

  showInFolder(target: string): Promise<void>
  openPath(target: string): Promise<string>
  thumb(path: string, size?: number): string
  pathForFile(file: File): string

  onImportProgress(cb: (p: ImportProgress) => void): () => void
  onModelProgress(cb: (p: ModelProgress) => void): () => void
  onReindexProgress(cb: (p: ReindexProgress) => void): () => void
  onAppReady(cb: (p: { count: number; dim: number }) => void): () => void
  onAppError(cb: (p: { message: string }) => void): () => void
  onOpenQuery(cb: (path: string) => void): () => void
}
