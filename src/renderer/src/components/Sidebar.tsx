import type { ComponentType } from 'react'
import type { ModelState } from '../../../shared/types'
import { IconLibrary, IconSearch, IconSettings } from './Icons'

export type Route = 'search' | 'library' | 'settings'

const NAV: Array<{ key: Route; label: string; icon: ComponentType<{ size?: number }> }> = [
  { key: 'search', label: '图像搜索', icon: IconSearch },
  { key: 'library', label: '数据管理', icon: IconLibrary },
  { key: 'settings', label: '系统设置', icon: IconSettings }
]

interface Props {
  route: Route
  onNavigate: (route: Route) => void
  model: ModelState | null
  total: number
}

export function Sidebar({ route, onNavigate, model, total }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">ImageSearch</div>
      {NAV.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.key}
            className={`nav-btn ${route === item.key ? 'active' : ''}`}
            onClick={() => onNavigate(item.key)}
          >
            <Icon size={18} />
            {item.label}
          </button>
        )
      })}
      <div className="sidebar-foot">
        <div className="ver">v0.1.0</div>
        <div className="dim-tag">
          {model?.ready
            ? `${model.dimension} 维 · ${total} 张`
            : model?.loading
              ? '模型加载中…'
              : '模型未就绪'}
        </div>
      </div>
    </aside>
  )
}
