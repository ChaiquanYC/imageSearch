import type {
  AppInfo,
  Device,
  DuplicateScanProgress,
  DuplicateScanResult,
  ExportResult,
  ImportProgress,
  ImportSummary,
  LibraryStats,
  MigrateMode,
  MigrateResult,
  ModelProgress,
  ModelState,
  PageQuery,
  PageResult,
  ReindexProgress,
  SearchRequest,
  SearchResult,
  Settings,
  TagCount,
  TextModelState
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
  getPage(query: PageQuery): Promise<PageResult>
  listTags(): Promise<TagCount[]>

  importImages(paths: string[]): Promise<ImportSummary>

  /** 移入回收站（软删除，可恢复） */
  trashImages(ids: number[]): Promise<number>
  restoreImages(ids: number[]): Promise<number>
  /** 彻底删除（含磁盘文件） */
  purgeImages(ids: number[]): Promise<number>
  purgeAllTrash(): Promise<number>

  updateDescription(id: number, description: string): Promise<void>
  batchDescription(ids: number[], description: string): Promise<void>
  updateTags(id: number, tags: string[]): Promise<void>
  batchTags(ids: number[], tags: string[], append: boolean): Promise<void>

  exportImages(ids: number[], targetDir: string): Promise<ExportResult>

  search(req: SearchRequest): Promise<SearchResult>
  searchByFile(filePath: string, k: number): Promise<SearchResult>
  searchByImageData(dataUrl: string, k: number): Promise<SearchResult>

  getModelState(): Promise<ModelState>
  switchModel(modelId: string, dtype: string): Promise<ModelState>
  setDevice(device: Device): Promise<ModelState>
  reindexAll(): Promise<number>

  getTextState(): Promise<TextModelState>
  switchTextModel(textModelId: string): Promise<TextModelState>
  reindexText(): Promise<number>

  scanDuplicates(threshold: number): Promise<DuplicateScanResult>
  purgeDuplicates(ids: number[]): Promise<number>

  migrate(kind: 'storage' | 'db' | 'model', target: string, mode: MigrateMode): Promise<MigrateResult>

  showInFolder(target: string): Promise<void>
  openPath(target: string): Promise<string>
  thumb(path: string, size?: number): string
  pathForFile(file: File): string

  onImportProgress(cb: (p: ImportProgress) => void): () => void
  onModelProgress(cb: (p: ModelProgress) => void): () => void
  onReindexProgress(cb: (p: ReindexProgress) => void): () => void
  onDedupeProgress(cb: (p: DuplicateScanProgress) => void): () => void
  onAppReady(cb: (p: { count: number; dim: number }) => void): () => void
  onAppError(cb: (p: { message: string }) => void): () => void
  onOpenQuery(cb: (path: string) => void): () => void
}
