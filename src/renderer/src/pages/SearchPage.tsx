import { useEffect, useRef, useState } from 'react'
import type { SearchHit, SearchMode, SearchResult } from '../../../shared/types'
import { useToast } from '../components/Feedback'
import {
  IconDownload,
  IconImage,
  IconRefresh,
  IconSearch,
  IconText,
  IconUpload
} from '../components/Icons'
import { Lightbox } from '../components/Lightbox'
import { api } from '../lib/api'

const COUNTS = [6, 12, 24, 36, 48]

const MODES: Array<{ key: SearchMode; label: string; hint: string }> = [
  { key: 'image', label: '以图搜图', hint: '用一张图的 DINOv2 特征找视觉相似的图' },
  { key: 'text', label: '文字搜图', hint: '用描述/标签的语义向量找图，不需要查询图' },
  { key: 'hybrid', label: '图文混合', hint: '图像特征 + 描述语义一起参与排序' }
]

function fmtElapsed(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} 秒`
}

function viaLabel(via: SearchHit['via']) {
  if (via === 'both') return '图文双命中'
  return via === 'image' ? '图像命中' : '文本命中'
}

export function SearchPage({ modelReady }: { modelReady: boolean }) {
  const toast = useToast()
  const [mode, setMode] = useState<SearchMode>('image')
  const [queryPath, setQueryPath] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [k, setK] = useState(12)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [lightbox, setLightbox] = useState<SearchHit | null>(null)
  const reqRef = useRef(0)

  const needImage = mode !== 'text'
  const needText = mode !== 'image'

  const run = async (override?: { path?: string; text?: string; count?: number }) => {
    if (!api) return
    const path = override?.path ?? queryPath
    const keyword = override?.text ?? text
    const count = override?.count ?? k

    if (mode === 'text' && !keyword.trim()) {
      toast('请输入要检索的文字', 'error')
      return
    }
    if (mode !== 'text' && !path) {
      toast('请先选择一张查询图', 'error')
      return
    }

    const req = ++reqRef.current
    setBusy(true)
    setResult(null)
    try {
      const res = await api.search({
        mode,
        k: count,
        imagePath: mode === 'image' || mode === 'hybrid' ? path : null,
        text: mode === 'text' || mode === 'hybrid' ? keyword : null
      })
      if (req === reqRef.current) setResult(res)
    } catch (err) {
      if (req === reqRef.current) {
        setResult(null)
        toast(err instanceof Error ? err.message : String(err), 'error')
      }
    } finally {
      if (req === reqRef.current) setBusy(false)
    }
  }

  const pick = async () => {
    const path = await api.pickImage()
    if (!path) return
    setQueryPath(path)
    void run({ path })
  }

  // 数量变化自动重检
  useEffect(() => {
    if (!result) return
    if (result.requested === k) return
    void run({ count: k })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k])

  // 从命令行/外部以图启动：ImageSearch --query <path>
  useEffect(() => {
    if (!api) return
    const off = api.onOpenQuery((path) => {
      if (!path) return
      setQueryPath(path)
      setMode((m) => (m === 'text' ? 'hybrid' : m))
      void run({ path })
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    const path = api.pathForFile(file)
    if (!path) {
      toast('无法读取该文件的本地路径', 'error')
      return
    }
    setQueryPath(path)
    void run({ path })
  }

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path)
      toast('路径已复制', 'success')
    } catch {
      toast('复制失败', 'error')
    }
  }

  const exportHits = async () => {
    const hits = result?.hits ?? []
    if (hits.length === 0) return
    const dir = await api.pickDirectory()
    if (!dir) return
    try {
      const res = await api.exportImages(
        hits.map((h) => h.id),
        dir
      )
      toast(`已导出 ${res.exported} 张（含 metadata.csv）`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const hits = result?.hits ?? []
  const showResults = Boolean(result) || busy

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">图像检索控制台</h1>
        <p className="page-sub">以图搜图、用文字搜图，或者两者一起排序</p>
      </div>

      <div className="mode-tabs">
        {MODES.map((m) => (
          <button
            key={m.key}
            className={`mode-tab ${mode === m.key ? 'active' : ''}`}
            onClick={() => {
              setMode(m.key)
              setResult(null)
            }}
            title={m.hint}
          >
            {m.key === 'text' ? <IconText /> : <IconImage size={15} />}
            {m.label}
          </button>
        ))}
        <span className="mode-hint">{MODES.find((m) => m.key === mode)?.hint}</span>
      </div>

      {needImage && !queryPath && (
        <button
          className={`dropzone ${dragging ? 'drag' : ''}`}
          onClick={pick}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <IconUpload size={34} />
          <span>{modelReady ? '点击上传图片进行 DINOv2 检索' : '模型加载中，稍候即可检索'}</span>
          <small>也可以直接把图片拖进来 · 支持 jpg / png / webp / bmp</small>
        </button>
      )}

      {needImage && queryPath && (
        <div className="preview-row">
          <div className="preview-thumb">
            <img src={api.thumb(queryPath, 320)} alt="查询图" />
          </div>
          <div className="preview-meta">
            <div className="preview-name" title={queryPath}>
              {queryPath.split(/[\\/]/).pop()}
            </div>
            <div className="preview-hint">
              {mode === 'hybrid'
                ? '查询图已载入，再补一句描述可让排序更贴合意图'
                : '查询图已载入，换图或调整数量会自动重新检索'}
            </div>
            <div className="preview-actions">
              <button className="btn primary" onClick={pick}>
                更换图片
              </button>
              <button className="btn" disabled={busy} onClick={() => void run()}>
                <IconRefresh />
                重新检索
              </button>
            </div>
          </div>
        </div>
      )}

      {needText && (
        <div className="text-search-bar">
          <IconSearch size={16} />
          <input
            className="text-search-input"
            value={text}
            placeholder={
              mode === 'text'
                ? '用一句话描述你找什么，例如：海边日落的暖色调照片'
                : '补充文字条件（可留空，仅用图像检索）'
            }
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run()
            }}
          />
          <button className="btn primary" disabled={busy} onClick={() => void run()}>
            {busy ? '检索中…' : '检索'}
          </button>
        </div>
      )}

      {showResults && (
        <>
          <div className="result-head">
            <h2 className="result-title">检索结果</h2>
            <span className={`result-meta ${busy ? '' : hits.length > 0 ? 'ok' : result ? 'bad' : ''}`}>
              {busy
                ? '正在检索中…'
                : result
                  ? hits.length > 0
                    ? `找到 ${hits.length} 个结果 (请求 ${result.requested} 个) · 耗时 ${fmtElapsed(
                        result.elapsedMs
                      )}`
                    : `未找到匹配结果 · 耗时 ${fmtElapsed(result.elapsedMs)}`
                  : ''}
            </span>
            <span className="spacer" />
            <button className="btn sm" disabled={hits.length === 0} onClick={() => void exportHits()}>
              <IconDownload size={14} />
              导出结果
            </button>
            <span className="field-label">显示数量</span>
            <select className="select-sm" value={k} onChange={(e) => setK(Number(e.target.value))}>
              {COUNTS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {busy && (
            <div className="empty">
              <div className="spinner" />
              正在提取特征并检索…
            </div>
          )}

          {!busy && hits.length === 0 && (
            <div className="empty">
              <IconImage size={30} />
              <strong>{result ? '没有命中相似图' : '等待检索'}</strong>
              <span>
                {result
                  ? mode === 'text'
                    ? '先给图片写上描述，文字检索才有内容可用'
                    : '图库可能还是空的，先去「数据管理」导入图片'
                  : ''}
              </span>
            </div>
          )}

          {!busy && hits.length > 0 && (
            <div className="result-grid">
              {hits.map((hit) => (
                <div className="card" key={hit.id}>
                  <div className="card-img" onClick={() => setLightbox(hit)}>
                    <img
                      src={api.thumb(hit.path, 360)}
                      alt={hit.description || '结果图'}
                      loading="lazy"
                    />
                    <span className={`via-badge ${hit.via}`}>{viaLabel(hit.via)}</span>
                  </div>
                  <div
                    className={`pill ${hit.description.trim() ? '' : 'empty'}`}
                    title={hit.description}
                  >
                    {hit.description.trim() ? hit.description : '无描述'}
                  </div>
                  {hit.tags.length > 0 && (
                    <div className="card-tags">
                      {hit.tags.map((t) => (
                        <span className="tag-chip sm" key={t}>
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div
                    className="card-path"
                    title={`${hit.path}\n点击复制路径`}
                    onClick={() => void copyPath(hit.path)}
                  >
                    {hit.path}
                  </div>
                  <div className="card-score">
                    匹配度 {(hit.score * 100).toFixed(2)}%
                    <span className="score-detail">
                      {hit.imageScore !== null && `图 ${(hit.imageScore * 100).toFixed(1)}%`}
                      {hit.imageScore !== null && hit.textScore !== null && ' · '}
                      {hit.textScore !== null && `文 ${(hit.textScore * 100).toFixed(1)}%`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {lightbox && (
        <Lightbox
          path={lightbox.path}
          description={lightbox.description}
          score={lightbox.score}
          thumbUrl={api.thumb(lightbox.path)}
          onClose={() => setLightbox(null)}
          onReveal={(p) => void api.showInFolder(p)}
        />
      )}
    </>
  )
}
