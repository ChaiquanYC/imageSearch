import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DuplicateScanResult,
  ImportProgress,
  LibraryStats,
  PageResult,
  SortKey,
  TagCount
} from '../../../shared/types'
import { DuplicatesModal } from '../components/DuplicatesModal'
import { useConfirm, useToast } from '../components/Feedback'
import {
  IconChevronLeft,
  IconChevronRight,
  IconDuplicate,
  IconDownload,
  IconLibrary,
  IconPlus,
  IconRefresh,
  IconRestore,
  IconSearch,
  IconSort,
  IconTag,
  IconTrash
} from '../components/Icons'
import { ProgressModal } from '../components/ProgressModal'
import { api, basename } from '../lib/api'

const PAGE_SIZES = [10, 20, 50, 100]

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'newest', label: '入库时间（新→旧）' },
  { key: 'oldest', label: '入库时间（旧→新）' },
  { key: 'description', label: '按描述排序' },
  { key: 'size', label: '按文件大小' }
]

interface Props {
  onChanged: () => void
  modelReady: boolean
}

type View = 'library' | 'trash'

export function LibraryPage({ onChanged, modelReady }: Props) {
  const toast = useToast()
  const confirm = useConfirm()

  const [view, setView] = useState<View>('library')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [data, setData] = useState<PageResult | null>(null)
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [tagList, setTagList] = useState<TagCount[]>([])

  const [keyword, setKeyword] = useState('')
  const [appliedKeyword, setAppliedKeyword] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('newest')
  const [onlyDesc, setOnlyDesc] = useState(false)

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null)
  const [tagEditing, setTagEditing] = useState<{ id: number; value: string } | null>(null)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [gotoValue, setGotoValue] = useState('')
  const [loading, setLoading] = useState(false)

  const [descTarget, setDescTarget] = useState<number[] | null>(null)
  const [descValue, setDescValue] = useState('')
  const [tagTarget, setTagTarget] = useState<number[] | null>(null)
  const [tagValue, setTagValue] = useState('')
  const [tagAppend, setTagAppend] = useState(true)

  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null)
  const [dupResult, setDupResult] = useState<DuplicateScanResult | null>(null)

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1

  // 关键词防抖
  const debounceRef = useRef(0)
  useEffect(() => {
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      setAppliedKeyword(keyword.trim())
    }, 280)
    return () => window.clearTimeout(debounceRef.current)
  }, [keyword])

  useEffect(() => {
    setPage(1)
    setSelected(new Set())
  }, [appliedKeyword, tagFilter, sort, onlyDesc, view])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pageData, st, tags] = await Promise.all([
        api.getPage({
          page,
          pageSize,
          keyword: appliedKeyword || undefined,
          tag: tagFilter || undefined,
          sort,
          onlyWithDescription: onlyDesc,
          trash: view === 'trash'
        }),
        api.getStats(),
        api.listTags()
      ])
      setData(pageData)
      setStats(st)
      setTagList(tags)
      if (pageData.rows.length === 0 && pageData.total > 0 && page > 1) {
        const last = Math.max(1, Math.ceil(pageData.total / pageSize))
        if (last !== page) setPage(last)
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, appliedKeyword, tagFilter, sort, onlyDesc, view])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!api) return
    return api.onImportProgress((p) => setImportProgress(p))
  }, [])

  useEffect(() => {
    if (!api) return
    return api.onDedupeProgress((p) => setScanProgress(p))
  }, [])

  const rows = data?.rows ?? []
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const trashView = view === 'trash'

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allChecked) rows.forEach((r) => next.delete(r.id))
      else rows.forEach((r) => next.add(r.id))
      return next
    })
  }

  const refresh = async () => {
    await load()
    onChanged()
  }

  const doImport = async () => {
    if (!modelReady) {
      toast('模型还没准备好，稍后再试', 'error')
      return
    }
    const paths = await api.pickImages()
    if (paths.length === 0) return
    setImportProgress({ done: 0, total: paths.length, current: '', failed: 0, duplicates: 0 })
    try {
      const summary = await api.importImages(paths)
      const parts = [`成功 ${summary.succeeded} 张`]
      if (summary.duplicates > 0) parts.push(`跳过重复 ${summary.duplicates} 张`)
      if (summary.failed > 0) parts.push(`失败 ${summary.failed} 张`)
      toast(`入库完成：${parts.join('，')}`, summary.failed > 0 ? 'error' : 'success')
      setPage(1)
      await refresh()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setImportProgress(null)
    }
  }

  const doTrash = async () => {
    if (selected.size === 0) {
      toast('请先勾选要删除的记录', 'error')
      return
    }
    const ok = await confirm({
      title: '移入回收站',
      body: `选中的 ${selected.size} 条记录会被移入回收站，图片文件仍保留在存储目录。\n之后可以随时恢复。`,
      okText: '移入回收站'
    })
    if (!ok) return
    try {
      const n = await api.trashImages([...selected])
      setSelected(new Set())
      await refresh()
      toast(`已移入回收站 ${n} 条`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const doRestore = async () => {
    if (selected.size === 0) return
    try {
      const n = await api.restoreImages([...selected])
      setSelected(new Set())
      await refresh()
      toast(`已恢复 ${n} 条`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const doPurge = async () => {
    if (selected.size === 0) return
    const ok = await confirm({
      title: '彻底删除',
      body: `将从数据库移除 ${selected.size} 条记录，并删除磁盘上的图片文件。\n此操作不可撤销。`,
      okText: '彻底删除',
      danger: true
    })
    if (!ok) return
    try {
      const n = await api.purgeImages([...selected])
      setSelected(new Set())
      await refresh()
      toast(`已彻底删除 ${n} 条`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const doPurgeAll = async () => {
    const ok = await confirm({
      title: '清空回收站',
      body: '回收站中的全部记录将被永久删除，图片文件也会从磁盘移除。',
      okText: '清空',
      danger: true
    })
    if (!ok) return
    try {
      const n = await api.purgeAllTrash()
      await refresh()
      toast(`回收站已清空，删除 ${n} 张`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const doExport = async () => {
    if (selected.size === 0) {
      toast('请先勾选要导出的记录', 'error')
      return
    }
    const dir = await api.pickDirectory()
    if (!dir) return
    try {
      const res = await api.exportImages([...selected], dir)
      toast(
        `已导出 ${res.exported} 张${res.skipped > 0 ? `，跳过 ${res.skipped} 张` : ''}${
          res.metadataPath ? '（含 metadata.csv）' : ''
        }`,
        'success'
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const doScan = async () => {
    setScanning(true)
    setScanProgress(null)
    try {
      const res = await api.scanDuplicates(0.95)
      setDupResult(res)
      if (res.groups.length === 0) toast('没有发现重复图', 'info')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setScanning(false)
      setScanProgress(null)
    }
  }

  const openDescDialog = () => {
    if (selected.size === 0) {
      toast('请先勾选要添加描述的记录', 'error')
      return
    }
    setDescValue('')
    setDescTarget([...selected])
  }

  const submitDesc = async () => {
    if (!descTarget) return
    const text = descValue.trim()
    if (!text) {
      toast('描述不能为空', 'error')
      return
    }
    try {
      await api.batchDescription(descTarget, text)
      setDescTarget(null)
      await refresh()
      toast(`已为 ${descTarget.length} 条记录写入描述`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const openTagDialog = () => {
    if (selected.size === 0) {
      toast('请先勾选要打标签的记录', 'error')
      return
    }
    setTagValue('')
    setTagAppend(true)
    setTagTarget([...selected])
  }

  const submitTags = async () => {
    if (!tagTarget) return
    const tags = tagValue
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    if (tags.length === 0) {
      toast('标签不能为空', 'error')
      return
    }
    try {
      await api.batchTags(tagTarget, tags, tagAppend)
      setTagTarget(null)
      await refresh()
      toast(`已为 ${tagTarget.length} 条记录${tagAppend ? '追加' : '设置'}标签`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const saveDescription = async (id: number, value: string) => {
    setEditing(null)
    const original = rows.find((r) => r.id === id)?.description ?? ''
    if (value.trim() === original.trim()) return
    try {
      await api.updateDescription(id, value.trim())
      await refresh()
      toast('描述已保存', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const saveTags = async (id: number, value: string) => {
    setTagEditing(null)
    const tags = value
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    try {
      await api.updateTags(id, tags)
      await refresh()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const jump = () => {
    const n = Number(gotoValue)
    if (!Number.isFinite(n) || n < 1) return
    setPage(Math.min(Math.max(1, Math.floor(n)), totalPages))
    setGotoValue('')
  }

  const hasFilter = Boolean(appliedKeyword || tagFilter || onlyDesc)

  const statLine = useMemo(() => {
    if (!stats) return null
    return (
      <div className="stats">
        <span>
          总记录 <b>{stats.total}</b>
        </span>
        <span className="sep">|</span>
        <span>
          有描述 <b>{stats.withDescription}</b>（{(stats.descriptionRate * 100).toFixed(1)}%）
        </span>
        <span className="sep">|</span>
        <span>
          有标签 <b>{stats.withTags}</b>
        </span>
        <span className="sep">|</span>
        <span>
          有向量 <b>{stats.withVector}</b>（{(stats.vectorRate * 100).toFixed(1)}%）
        </span>
        <span className="sep">|</span>
        <span>
          维度 <b>{stats.dimension}</b>
        </span>
        <span className="sep">|</span>
        <span>
          回收站 <b>{stats.trashed}</b>
        </span>
        {stats.earliest && (
          <>
            <span className="sep">|</span>
            <span>
              {stats.earliest} 至 {stats.latest}
            </span>
          </>
        )}
      </div>
    )
  }, [stats])

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">数据管理</h1>
        <p className="page-sub">导入、描述、标签、查重与清理，所有数据都留在本机</p>
      </div>

      <div className="view-tabs">
        <button
          className={`view-tab ${trashView ? '' : 'active'}`}
          onClick={() => setView('library')}
        >
          <IconLibrary size={15} />
          图库
          <span className="tab-count">{stats?.total ?? 0}</span>
        </button>
        <button
          className={`view-tab ${trashView ? 'active' : ''}`}
          onClick={() => setView('trash')}
        >
          <IconTrash size={15} />
          回收站
          <span className="tab-count">{stats?.trashed ?? 0}</span>
        </button>
      </div>

      <div className="toolbar">
        {!trashView ? (
          <>
            <button className="btn primary" onClick={doImport} disabled={Boolean(importProgress)}>
              <IconPlus />
              新增图片入库
            </button>
            <button className="btn" onClick={() => void doExport()} disabled={selected.size === 0}>
              <IconDownload />
              导出
            </button>
            <button className="btn" onClick={openDescDialog} disabled={selected.size === 0}>
              <IconTag />
              批量描述
            </button>
            <button className="btn" onClick={openTagDialog} disabled={selected.size === 0}>
              <IconTag />
              批量标签
            </button>
            <button className="btn" onClick={() => void doTrash()} disabled={selected.size === 0}>
              <IconTrash />
              移入回收站
            </button>
            <button className="btn" onClick={() => void doScan()} disabled={scanning}>
              <IconDuplicate />
              {scanning ? '查重中…' : '查找重复图'}
            </button>
          </>
        ) : (
          <>
            <button className="btn primary" onClick={() => void doRestore()} disabled={selected.size === 0}>
              <IconRestore />
              恢复选中
            </button>
            <button className="btn danger" onClick={() => void doPurge()} disabled={selected.size === 0}>
              <IconTrash />
              彻底删除
            </button>
            <button className="btn danger-ghost" onClick={() => void doPurgeAll()} disabled={!stats?.trashed}>
              清空回收站
            </button>
          </>
        )}
        <button className="btn" onClick={() => void refresh()}>
          <IconRefresh />
          刷新
        </button>
        <span className="spacer" />
        {selected.size > 0 && <span className="result-meta">已选 {selected.size} 项</span>}
      </div>

      <div className="filter-bar">
        <div className="search-box">
          <IconSearch size={15} />
          <input
            value={keyword}
            placeholder="搜索描述 / 标签 / 文件名"
            onChange={(e) => setKeyword(e.target.value)}
          />
          {keyword && (
            <button className="search-clear" onClick={() => setKeyword('')} title="清空">
              ×
            </button>
          )}
        </div>
        <select
          className="select-sm"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          title="按标签筛选"
        >
          <option value="">全部标签</option>
          {tagList.map((t) => (
            <option key={t.tag} value={t.tag}>
              {t.tag}（{t.count}）
            </option>
          ))}
        </select>
        <select
          className="select-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          title="排序方式"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <label className="check-label">
          <input type="checkbox" checked={onlyDesc} onChange={(e) => setOnlyDesc(e.target.checked)} />
          只看有描述
        </label>
        {hasFilter && (
          <button
            className="btn sm"
            onClick={() => {
              setKeyword('')
              setTagFilter('')
              setOnlyDesc(false)
            }}
          >
            清除筛选
          </button>
        )}
        <span className="spacer" />
        <IconSort size={14} />
        <span className="result-meta">
          {data ? `筛出 ${data.total} 条 / 共 ${stats?.total ?? 0} 条` : ''}
        </span>
      </div>

      {statLine}

      <div className="table-wrap">
        <table className="grid">
          <colgroup>
            <col style={{ width: 52 }} />
            <col style={{ width: 86 }} />
            <col style={{ width: 250 }} />
            <col style={{ width: 200 }} />
            <col />
            <col style={{ width: 160 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="cell-check">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              </th>
              <th>预览</th>
              <th>描述（双击修改）</th>
              <th>标签（双击修改）</th>
              <th>图片文件</th>
              <th>{trashView ? '删除时间' : '入库时间'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={selected.has(row.id) ? 'selected' : ''}>
                <td className="cell-check">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggleOne(row.id)}
                  />
                </td>
                <td className="cell-thumb">
                  <img src={api.thumb(row.path, 140)} alt="" loading="lazy" />
                </td>
                <td>
                  {editing?.id === row.id ? (
                    <input
                      className="desc-input"
                      autoFocus
                      value={editing.value}
                      onChange={(e) => setEditing({ id: row.id, value: e.target.value })}
                      onBlur={() => void saveDescription(row.id, editing.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveDescription(row.id, editing.value)
                        if (e.key === 'Escape') setEditing(null)
                      }}
                    />
                  ) : (
                    <div
                      className={`desc-text ${row.description.trim() ? '' : 'placeholder'}`}
                      title="双击编辑"
                      onDoubleClick={() => setEditing({ id: row.id, value: row.description })}
                    >
                      {row.description.trim() ? row.description : '双击添加描述'}
                    </div>
                  )}
                </td>
                <td>
                  {tagEditing?.id === row.id ? (
                    <input
                      className="desc-input"
                      autoFocus
                      value={tagEditing.value}
                      placeholder="用逗号分隔，例如：海报,暖色"
                      onChange={(e) => setTagEditing({ id: row.id, value: e.target.value })}
                      onBlur={() => void saveTags(row.id, tagEditing.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveTags(row.id, tagEditing.value)
                        if (e.key === 'Escape') setTagEditing(null)
                      }}
                    />
                  ) : (
                    <div
                      className="tag-cell"
                      title="双击编辑标签"
                      onDoubleClick={() => setTagEditing({ id: row.id, value: row.tags.join(',') })}
                      onClick={(e) => {
                        const tag = (e.target as HTMLElement).dataset.tag
                        if (tag) setTagFilter(tag)
                      }}
                    >
                      {row.tags.length > 0 ? (
                        row.tags.map((t) => (
                          <span className="tag-chip" key={t} data-tag={t} title="点击按此标签筛选">
                            {t}
                          </span>
                        ))
                      ) : (
                        <span className="desc-text placeholder">双击添加标签</span>
                      )}
                    </div>
                  )}
                </td>
                <td>
                  <div
                    className="path-cell"
                    title={`${row.path}\n点击在文件夹中显示`}
                    onClick={() => void api.showInFolder(row.path)}
                  >
                    {basename(row.path)}
                  </div>
                </td>
                <td className="time-cell">{row.deletedAt ?? row.createdAt}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="empty">
                    <IconLibrary size={30} />
                    <strong>
                      {loading
                        ? '正在读取…'
                        : trashView
                          ? '回收站是空的'
                          : hasFilter
                            ? '没有符合条件的记录'
                            : '图库还是空的'}
                    </strong>
                    <span>
                      {trashView
                        ? '删除的图片会先放到这里，随时可以恢复'
                        : hasFilter
                          ? '换个关键词或清除筛选试试'
                          : '点左上角「新增图片入库」开始建立你的素材库'}
                    </span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          <IconChevronLeft size={14} />
          上一页
        </button>
        <button
          className="btn sm"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        >
          下一页
          <IconChevronRight size={14} />
        </button>
        <span>
          第 {page} 页 / 共 {totalPages} 页
        </span>
        <span className="spacer" />
        <span>跳转到</span>
        <input
          className="input-sm"
          value={gotoValue}
          placeholder="页码"
          onChange={(e) => setGotoValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') jump()
          }}
        />
        <span>每页显示</span>
        <select
          className="select-sm"
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value))
            setPage(1)
            setSelected(new Set())
          }}
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span>总记录 {data?.total ?? 0}</span>
      </div>

      {importProgress && (
        <ProgressModal
          title="正在导入图片"
          label={
            importProgress.current
              ? `正在处理：${importProgress.current}`
              : '正在准备，首次导入需要先加载模型…'
          }
          value={importProgress.done}
          total={importProgress.total}
          hint={
            [
              importProgress.failed > 0 ? `已有 ${importProgress.failed} 张处理失败` : '',
              importProgress.duplicates > 0 ? `跳过重复 ${importProgress.duplicates} 张` : ''
            ]
              .filter(Boolean)
              .join(' · ') || '请勿关闭窗口'
          }
        />
      )}

      {scanning && (
        <ProgressModal
          title="正在查找重复图"
          label={
            scanProgress
              ? `已比对 ${scanProgress.done} / ${scanProgress.total} 张`
              : '正在加载向量索引…'
          }
          value={scanProgress?.done ?? 0}
          total={scanProgress?.total ?? 0}
          hint="两两比对特征相似度，图库越大耗时越久"
        />
      )}

      {dupResult && (
        <DuplicatesModal
          result={dupResult}
          onClose={() => setDupResult(null)}
          onPurged={async (n) => {
            await refresh()
            toast(`已删除 ${n} 张重复图`, 'success')
          }}
        />
      )}

      {descTarget && (
        <div className="overlay" onClick={() => setDescTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">批量添加描述</h3>
            <div className="modal-body">
              将为选中的 {descTarget.length} 条记录写入同一段描述文本。
            </div>
            <input
              className="desc-input"
              style={{ marginTop: 12, width: '100%', height: 36 }}
              autoFocus
              value={descValue}
              placeholder="例如：2026 春季海报参考"
              onChange={(e) => setDescValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitDesc()
                if (e.key === 'Escape') setDescTarget(null)
              }}
            />
            <div className="modal-actions">
              <button className="btn" onClick={() => setDescTarget(null)}>
                取消
              </button>
              <button className="btn primary" onClick={() => void submitDesc()}>
                写入描述
              </button>
            </div>
          </div>
        </div>
      )}

      {tagTarget && (
        <div className="overlay" onClick={() => setTagTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">批量打标签</h3>
            <div className="modal-body">
              将为选中的 {tagTarget.length} 条记录处理标签，多个标签用逗号分隔。
            </div>
            <input
              className="desc-input"
              style={{ marginTop: 12, width: '100%', height: 36 }}
              autoFocus
              value={tagValue}
              placeholder="例如：海报, 暖色, 2026"
              onChange={(e) => setTagValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitTags()
                if (e.key === 'Escape') setTagTarget(null)
              }}
            />
            <div className="modal-radios">
              <label>
                <input
                  type="radio"
                  checked={tagAppend}
                  onChange={() => setTagAppend(true)}
                />
                追加到已有标签
              </label>
              <label>
                <input
                  type="radio"
                  checked={!tagAppend}
                  onChange={() => setTagAppend(false)}
                />
                覆盖已有标签
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setTagTarget(null)}>
                取消
              </button>
              <button className="btn primary" onClick={() => void submitTags()}>
                应用标签
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
