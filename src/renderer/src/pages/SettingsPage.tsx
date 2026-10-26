import { useEffect, useState } from 'react'
import type { AppInfo, ModelState, ReindexProgress, Settings } from '../../../shared/types'
import { MODEL_CATALOG, modelMeta } from '../../../shared/types'
import { useConfirm, useToast } from '../components/Feedback'
import { IconFolder, IconRefresh } from '../components/Icons'
import { ProgressModal } from '../components/ProgressModal'
import { api } from '../lib/api'

interface Props {
  onChanged: () => void
}

type PathKey = 'modelDir' | 'storageDir' | 'dbFolder'

const PATH_ROWS: Array<{ key: PathKey; label: string; hint: string; kind: 'model' | 'storage' | 'db' }> = [
  {
    key: 'modelDir',
    label: '模型目录',
    hint: 'DINOv2 ONNX 权重缓存位置，首次运行会自动下载到此处',
    kind: 'model'
  },
  {
    key: 'storageDir',
    label: '图片存储目录',
    hint: '新入库的图片会被复制到这里，迁移后数据库路径会自动改写',
    kind: 'storage'
  },
  {
    key: 'dbFolder',
    label: '数据库目录',
    hint: 'SQLite 元数据与向量文件 image.db 所在位置',
    kind: 'db'
  }
]

export function SettingsPage({ onChanged }: Props) {
  const toast = useToast()
  const confirm = useConfirm()

  const [settings, setSettings] = useState<Settings | null>(null)
  const [model, setModel] = useState<ModelState | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [drafts, setDrafts] = useState<Record<PathKey, string>>({
    modelDir: '',
    storageDir: '',
    dbFolder: ''
  })
  const [modelId, setModelId] = useState('')
  const [dtype, setDtype] = useState('fp32')
  const [reindex, setReindex] = useState<ReindexProgress | null>(null)
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    if (!api) return
    void (async () => {
      const [s, m, i] = await Promise.all([api.getSettings(), api.getModelState(), api.info()])
      setSettings(s)
      setModel(m)
      setInfo(i)
      setModelId(s.modelId)
      setDtype(s.dtype)
      setDrafts({ modelDir: s.modelDir, storageDir: s.storageDir, dbFolder: s.dbFolder })
    })()
    const off = api.onReindexProgress((p) => setReindex(p))
    return off
  }, [])

  const applyModel = async () => {
    if (!settings) return
    if (modelId === settings.modelId && dtype === settings.dtype) {
      toast('模型配置没有变化', 'info')
      return
    }
    const meta = modelMeta(modelId)
    const ok = await confirm({
      title: '切换模型引擎',
      body: `即将切换到 ${meta.label}（${meta.size}，${dtype === 'q8' ? 'int8 量化' : 'fp32 全精度'}）。\n\n因为特征维度不兼容，系统会清空所有已有向量并重新扫描全部图片提取特征。图库较大时需要几分钟。`,
      okText: '开始切换',
      danger: true
    })
    if (!ok) {
      setModelId(settings.modelId)
      setDtype(settings.dtype)
      return
    }
    setSwitching(true)
    try {
      const state = await api.switchModel(modelId, dtype)
      setModel(state)
      const next = await api.getSettings()
      setSettings(next)
      toast(`已切换到 ${meta.label}，维度 ${state.dimension}`, 'success')
      onChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
      const m = await api.getModelState()
      setModel(m)
      const s = await api.getSettings()
      setSettings(s)
      setModelId(s.modelId)
      setDtype(s.dtype)
    } finally {
      setSwitching(false)
      setReindex(null)
    }
  }

  const doReindex = async () => {
    const ok = await confirm({
      title: '重建全部索引',
      body: '将清空数据库中的全部特征向量，并逐张重新提取。图片和描述不会丢失。',
      okText: '开始重建'
    })
    if (!ok) return
    setSwitching(true)
    try {
      const count = await api.reindexAll()
      toast(`索引重建完成，共 ${count} 张图片`, 'success')
      onChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setSwitching(false)
      setReindex(null)
    }
  }

  const browse = async (row: (typeof PATH_ROWS)[number]) => {
    const picked = await api.pickDirectory(drafts[row.key])
    if (picked) setDrafts((d) => ({ ...d, [row.key]: picked }))
  }

  const applyPath = async (row: (typeof PATH_ROWS)[number]) => {
    if (!settings) return
    const target = drafts[row.key]
    if (!target || target === settings[row.key]) return
    const ok = await confirm({
      title: '迁移目录',
      body: `将「${row.label}」从\n${settings[row.key]}\n改为\n${target}\n\n系统会把现有文件复制到新目录，成功后保存配置。${
        row.kind === 'storage' ? '\n数据库里的图片路径会同步改写。' : ''
      }${row.kind === 'model' ? '\n迁移后会重新加载模型。' : ''}`,
      okText: '开始迁移'
    })
    if (!ok) {
      setDrafts((d) => ({ ...d, [row.key]: settings[row.key] }))
      return
    }
    setSwitching(true)
    try {
      const result = await api.migrate(row.kind, target)
      const next = await api.getSettings()
      setSettings(next)
      setDrafts({
        modelDir: next.modelDir,
        storageDir: next.storageDir,
        dbFolder: next.dbFolder
      })
      const m = await api.getModelState()
      setModel(m)
      toast(
        `迁移完成：${result.moved} 个项目，${result.records} 条记录受影响`,
        'success'
      )
      onChanged()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
      const s = await api.getSettings()
      setSettings(s)
      setDrafts({
        modelDir: s.modelDir,
        storageDir: s.storageDir,
        dbFolder: s.dbFolder
      })
    } finally {
      setSwitching(false)
      setReindex(null)
    }
  }

  const statusBadge = () => {
    if (!model) return <span className="badge warn">读取中</span>
    if (model.ready) return <span className="badge">就绪 · {model.dimension} 维</span>
    if (model.loading) return <span className="badge warn">加载中…</span>
    return <span className="badge bad">{model.error ? '不可用' : '未初始化'}</span>
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">系统设置</h1>
        <p className="page-sub">模型引擎、存储路径与运行环境</p>
      </div>

      <div className="panel">
        <h2 className="panel-title">模型引擎</h2>

        <div className="setting-row">
          <div className="setting-main">
            <div className="setting-label">模型规模</div>
            <div className="setting-hint">
              越大越准，也越慢。CPU 推理下 ViT-S 单张约 25ms，ViT-L 约 250ms。
            </div>
          </div>
          <div className="setting-ctrl">
            {statusBadge()}
            <select className="select" value={modelId} onChange={(e) => setModelId(e.target.value)}>
              {MODEL_CATALOG.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} · {m.dimension} 维 · {m.size}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-main">
            <div className="setting-label">权重精度</div>
            <div className="setting-hint">
              int8 量化体积约为 fp32 的四分之一，速度更快，精度略有损失。
            </div>
          </div>
          <div className="setting-ctrl">
            <select className="select" value={dtype} onChange={(e) => setDtype(e.target.value)}>
              <option value="fp32">fp32 全精度（推荐）</option>
              <option value="q8">int8 量化（更小更快）</option>
            </select>
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-main">
            <div className="setting-label">索引维护</div>
            <div className="setting-hint">
              切换模型会自动清空旧向量并全量重扫；这里可以手动触发一次重建。
            </div>
          </div>
          <div className="setting-ctrl">
            <button className="btn" onClick={() => void doReindex()} disabled={switching || !model?.ready}>
              <IconRefresh />
              重建全部索引
            </button>
            <button className="btn primary" onClick={() => void applyModel()} disabled={switching}>
              应用模型配置
            </button>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">存储路径</h2>
        {PATH_ROWS.map((row) => (
          <div className="setting-row" key={row.key}>
            <div className="setting-main">
              <div className="setting-label">{row.label}</div>
              <div className="setting-hint">{row.hint}</div>
            </div>
            <div className="setting-ctrl">
              <input
                className="path-input"
                value={drafts[row.key]}
                spellCheck={false}
                onChange={(e) => setDrafts((d) => ({ ...d, [row.key]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void applyPath(row)
                }}
              />
              <button className="btn" onClick={() => void browse(row)}>
                <IconFolder />
                浏览
              </button>
              <button
                className="btn primary"
                disabled={!settings || drafts[row.key] === settings[row.key] || switching}
                onClick={() => void applyPath(row)}
              >
                应用
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2 className="panel-title">运行环境</h2>
        <dl className="kv">
          <dt>应用版本</dt>
          <dd>{info?.version ?? '—'}</dd>
          <dt>Electron</dt>
          <dd>{info?.electron ?? '—'}</dd>
          <dt>Chromium</dt>
          <dd>{info?.chrome ?? '—'}</dd>
          <dt>Node.js</dt>
          <dd>{info?.node ?? '—'}</dd>
          <dt>平台</dt>
          <dd>{info?.platform ?? '—'}</dd>
          <dt>数据目录</dt>
          <dd>{info?.userData ?? '—'}</dd>
        </dl>
        <div className="setting-row" style={{ borderTop: 'none', paddingTop: 0 }}>
          <div className="setting-main">
            <div className="setting-hint">
              配置写在数据目录下的 settings.json，全部数据不离开本机。
            </div>
          </div>
          <div className="setting-ctrl">
            <button className="btn" onClick={() => info && void api.openPath(info.userData)}>
              <IconFolder />
              打开数据目录
            </button>
          </div>
        </div>
      </div>

      {(switching || reindex) && (
        <ProgressModal
          title={reindex ? '正在重建索引' : '正在切换模型'}
          label={
            reindex
              ? `已处理 ${reindex.done} / ${reindex.total} 张`
              : '正在加载模型权重，首次切换需要下载…'
          }
          value={reindex?.done ?? 0}
          total={reindex?.total ?? 0}
          hint="期间请勿关闭窗口"
        />
      )}
    </>
  )
}
