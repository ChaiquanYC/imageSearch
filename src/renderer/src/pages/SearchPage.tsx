import { useEffect, useRef, useState } from 'react'
import type { SearchHit, SearchResult } from '../../../shared/types'
import { useToast } from '../components/Feedback'
import { IconImage, IconRefresh, IconUpload } from '../components/Icons'
import { Lightbox } from '../components/Lightbox'
import { api } from '../lib/api'

const COUNTS = [6, 12, 24, 36, 48]

function fmtElapsed(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} 秒`
}

export function SearchPage({ modelReady }: { modelReady: boolean }) {
  const toast = useToast()
  const [queryPath, setQueryPath] = useState<string | null>(null)
  const [k, setK] = useState(12)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [lightbox, setLightbox] = useState<SearchHit | null>(null)
  const reqRef = useRef(0)

  const run = async (path: string, count = k) => {
    if (!api) return
    const req = ++reqRef.current
    setQueryPath(path)
    setBusy(true)
    setResult(null)
    try {
      const res = await api.searchByFile(path, count)
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
    if (path) void run(path)
  }

  useEffect(() => {
    if (!queryPath) return
    const count = k
    if (result && result.requested === count) return
    void run(queryPath, count)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k])

  // 从命令行/外部以图启动：ImageSearch --query <path>
  useEffect(() => {
    if (!api) return
    const off = api.onOpenQuery((path) => {
      if (path) void run(path)
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
    void run(path)
  }

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path)
      toast('路径已复制', 'success')
    } catch {
      toast('复制失败', 'error')
    }
  }

  const hits = result?.hits ?? []
  const showResults = Boolean(queryPath)

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">图像检索控制台</h1>
        <p className="page-sub">上传一张图片，用 DINOv2 特征在本地图库中找相似图</p>
      </div>

      {!showResults ? (
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
      ) : (
        <div className="preview-row">
          <div className="preview-thumb">
            {queryPath && <img src={api.thumb(queryPath, 320)} alt="查询图" />}
          </div>
          <div className="preview-meta">
            <div className="preview-name" title={queryPath ?? ''}>
              {queryPath?.split(/[\\/]/).pop()}
            </div>
            <div className="preview-hint">查询图已载入，换图或调整数量会自动重新检索</div>
            <div className="preview-actions">
              <button className="btn primary" onClick={pick}>
                更换图片
              </button>
              <button
                className="btn"
                disabled={busy || !queryPath}
                onClick={() => queryPath && run(queryPath)}
              >
                <IconRefresh />
                重新检索
              </button>
            </div>
          </div>
        </div>
      )}

      {showResults && (
        <>
          <div className="result-head">
            <h2 className="result-title">检索结果</h2>
            <span
              className={`result-meta ${
                busy ? '' : hits.length > 0 ? 'ok' : result ? 'bad' : ''
              }`}
            >
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
            <span className="field-label">显示数量</span>
            <select
              className="select-sm"
              value={k}
              onChange={(e) => setK(Number(e.target.value))}
            >
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
              <span>{result ? '图库可能还是空的，先去「数据管理」导入图片' : ''}</span>
            </div>
          )}

          {!busy && hits.length > 0 && (
            <div className="result-grid">
              {hits.map((hit) => (
                <div className="card" key={hit.id}>
                  <div className="card-img" onClick={() => setLightbox(hit)}>
                    <img src={api.thumb(hit.path, 360)} alt={hit.description || '结果图'} loading="lazy" />
                  </div>
                  <div
                    className={`pill ${hit.description.trim() ? '' : 'empty'}`}
                    title={hit.description}
                  >
                    {hit.description.trim() ? hit.description : '无描述'}
                  </div>
                  <div
                    className="card-path"
                    title={`${hit.path}\n点击复制路径`}
                    onClick={() => void copyPath(hit.path)}
                  >
                    {hit.path}
                  </div>
                  <div className="card-score">匹配度 {(hit.score * 100).toFixed(2)}%</div>
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
