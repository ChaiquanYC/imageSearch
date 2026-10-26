import { useCallback, useEffect, useState } from 'react'
import type { ModelState } from '../../shared/types'
import { UiProvider } from './components/Feedback'
import { Sidebar, type Route } from './components/Sidebar'
import { api } from './lib/api'
import { LibraryPage } from './pages/LibraryPage'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'

const ROUTES: Route[] = ['search', 'library', 'settings']

function readRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  return ROUTES.includes(hash as Route) ? (hash as Route) : 'search'
}

function Workspace() {
  const [route, setRoute] = useState<Route>(readRoute)
  const [model, setModel] = useState<ModelState | null>(null)
  const [total, setTotal] = useState(0)
  const [boot, setBoot] = useState<string | null>('正在启动…')

  const navigate = (next: Route) => {
    setRoute(next)
    window.location.hash = next
  }

  const refreshAll = useCallback(async () => {
    const [m, stats] = await Promise.all([api.getModelState(), api.getStats()])
    setModel(m)
    setTotal(stats.total)
    if (m.ready) setBoot(null)
  }, [])

  useEffect(() => {
    const onHash = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!api) return
    const offModel = api.onModelProgress((p) => {
      if (p.stage === 'ready') return
      if (p.stage === 'download') {
        setBoot(`正在下载模型 ${p.file ?? ''} ${(p.progress ?? 0).toFixed(0)}%`)
      } else {
        setBoot(p.message ?? '正在加载模型…')
      }
    })
    const offError = api.onAppError((p) => setBoot(`模型加载失败：${p.message}`))
    return () => {
      offModel()
      offError()
    }
  }, [])

  useEffect(() => {
    if (!api) return
    let alive = true
    let timer = 0

    const tick = async () => {
      try {
        const m = await api.getModelState()
        if (!alive) return
        setModel(m)
        if (m.ready) {
          const stats = await api.getStats()
          if (!alive) return
          setTotal(stats.total)
          setBoot(null)
          return
        }
        if (m.error) {
          setBoot(`模型加载失败：${m.error}`)
          return
        }
        timer = window.setTimeout(tick, 700)
      } catch {
        if (alive) timer = window.setTimeout(tick, 1500)
      }
    }

    void tick()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])

  return (
    <div className="app">
      <Sidebar route={route} onNavigate={navigate} model={model} total={total} />
      <main className="content">
        {boot && (
          <div className="boot-bar">
            <div className="spinner" />
            {boot}
          </div>
        )}
        {route === 'search' && <SearchPage modelReady={Boolean(model?.ready)} />}
        {route === 'library' && (
          <LibraryPage modelReady={Boolean(model?.ready)} onChanged={() => void refreshAll()} />
        )}
        {route === 'settings' && <SettingsPage onChanged={() => void refreshAll()} />}
      </main>
    </div>
  )
}

export default function App() {
  if (!api) {
    return (
      <div className="fatal">
        <strong style={{ fontSize: 16 }}>不是有效的 Electron 运行环境</strong>
        <span>
          页面没有拿到 preload 暴露的接口。请用 <code>npm run dev</code> 或
          <code>npm run build &amp;&amp; npm start</code> 启动，不要直接在浏览器里打开 HTML。
        </span>
      </div>
    )
  }
  return (
    <UiProvider>
      <Workspace />
    </UiProvider>
  )
}
