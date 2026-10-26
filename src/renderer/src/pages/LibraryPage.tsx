import { useCallback, useEffect, useState } from 'react'
import type { ImportProgress, LibraryStats, PageResult } from '../../../shared/types'
import { useConfirm, useToast } from '../components/Feedback'
import {
  IconChevronLeft,
  IconChevronRight,
  IconLibrary,
  IconPlus,
  IconRefresh,
  IconTag,
  IconTrash
} from '../components/Icons'
import { ProgressModal } from '../components/ProgressModal'
import { api, basename } from '../lib/api'

const PAGE_SIZES = [10, 20, 50, 100]

interface Props {
  onChanged: () => void
  modelReady: boolean
}

export function LibraryPage({ onChanged, modelReady }: Props) {
  const toast = useToast()
  const confirm = useConfirm()

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [data, setData] = useState<PageResult | null>(null)
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [gotoValue, setGotoValue] = useState('')
  const [descTarget, setDescTarget] = useState<number[] | null>(null)
  const [descValue, setDescValue] = useState('')
  const [loading, setLoading] = useState(false)

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1

  const load = useCallback(
    async (targetPage = page, size = pageSize) => {
      setLoading(true)
      try {
        const [pageData, st] = await Promise.all([api.getPage(targetPage, size), api.getStats()])
        setData(pageData)
        setStats(st)
        if (pageData.rows.length === 0 && pageData.total > 0 && targetPage > 1) {
          const last = Math.max(1, Math.ceil(pageData.total / size))
          if (last !== targetPage) setPage(last)
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error')
      } finally {
        setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, pageSize]
  )

  useEffect(() => {
    void load(page, pageSize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize])

  useEffect(() => {
    if (!api) return
    const off = api.onImportProgress((p) => setImportProgress(p))
    return off
  }, [])

  const rows = data?.rows ?? []
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id))

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
      if (allChecked) {
        const next = new Set(prev)
        rows.forEach((r) => next.delete(r.id))
        return next
      }
      const next = new Set(prev)
      rows.forEach((r) => next.add(r.id))
      return next
    })
  }

  const doImport = async () => {
    if (!modelReady) {
      toast('模型还没准备好，稍后再试', 'error')
      return
    }
    const paths = await api.pickImages()
    if (paths.length === 0) return
    setImportProgress({ done: 0, total: paths.length, current: '', failed: 0 })
    try {
      const summary = await api.importImages(paths)
      toast(
        summary.failed > 0
          ? `入库完成：成功 ${summary.succeeded} 张，失败 ${summary.failed} 张`
          : `入库完成：${summary.succeeded} 张，耗时 ${(summary.elapsedMs / 1000).toFixed(1)} 秒`,
        summary.failed > 0 ? 'error' : 'success'
      )
      setPage(1)
      await load(1, pageSize)
      onChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setImportProgress(null)
    }
  }

  const doDelete = async () => {
    if (selected.size === 0) {
      toast('请先勾选要删除的记录', 'error')
      return
    }
    const ok = await confirm({
      title: '确认删除',
      body: `将永久删除选中的 ${selected.size} 条记录，并删除其在存储目录中的图片文件。\n此操作不可撤销。`,
      okText: '永久删除',
      danger: true
    })
    if (!ok) return
    try {
      const removed = await api.deleteImages([...selected])
      setSelected(new Set())
      await load(page, pageSize)
      onChanged()
      toast(`已删除 ${removed} 条记录`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
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
      await load(page, pageSize)
      toast(`已为 ${descTarget.length} 条记录写入描述`, 'success')
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
      setData((prev) =>
        prev
          ? {
              ...prev,
              rows: prev.rows.map((r) => (r.id === id ? { ...r, description: value.trim() } : r))
            }
          : prev
      )
      const st = await api.getStats()
      setStats(st)
      toast('描述已保存', 'success')
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

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">数据管理</h1>
        <p className="page-sub">导入图片、维护描述、批量清理，所有数据都留在本机</p>
      </div>

      <div className="toolbar">
        <button className="btn primary" onClick={doImport} disabled={Boolean(importProgress)}>
          <IconPlus />
          新增图片入库
        </button>
        <button className="btn" onClick={doDelete} disabled={selected.size === 0}>
          <IconTrash />
          批量删除
        </button>
        <button className="btn" onClick={openDescDialog} disabled={selected.size === 0}>
          <IconTag />
          批量添加描述
        </button>
        <button className="btn" onClick={() => void load(page, pageSize)}>
          <IconRefresh />
          刷新列表
        </button>
        <span className="spacer" />
        {selected.size > 0 && (
          <span className="result-meta">已选 {selected.size} 项</span>
        )}
      </div>

      <div className="stats">
        <span>
          总记录 <b>{stats?.total ?? 0}</b>
        </span>
        <span className="sep">|</span>
        <span>
          有描述 <b>{stats?.withDescription ?? 0}</b>（
          {((stats?.descriptionRate ?? 0) * 100).toFixed(1)}%）
        </span>
        <span className="sep">|</span>
        <span>
          有向量 <b>{stats?.withVector ?? 0}</b>（
          {((stats?.vectorRate ?? 0) * 100).toFixed(1)}%）
        </span>
        <span className="sep">|</span>
        <span>
          维度 <b>{stats?.dimension ?? 0}</b>
        </span>
        {stats?.earliest && (
          <>
            <span className="sep">|</span>
            <span>
              时间范围 {stats.earliest} 至 {stats.latest}
            </span>
          </>
        )}
      </div>

      <div className="table-wrap">
        <table className="grid">
          <colgroup>
            <col style={{ width: 56 }} />
            <col style={{ width: 92 }} />
            <col style={{ width: 260 }} />
            <col />
            <col style={{ width: 168 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="cell-check">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              </th>
              <th>预览</th>
              <th>描述（双击修改）</th>
              <th>图片路径</th>
              <th>入库时间</th>
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
                  <div
                    className="path-cell"
                    title={`${row.path}\n点击在文件夹中显示`}
                    onClick={() => void api.showInFolder(row.path)}
                  >
                    {basename(row.path)}
                  </div>
                </td>
                <td className="time-cell">{row.createdAt}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className="empty">
                    <IconLibrary size={30} />
                    <strong>{loading ? '正在读取…' : '图库还是空的'}</strong>
                    <span>点左上角「新增图片入库」开始建立你的素材库</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button
          className="btn sm"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
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
            importProgress.failed > 0 ? `已有 ${importProgress.failed} 张处理失败` : '请勿关闭窗口'
          }
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
    </>
  )
}
