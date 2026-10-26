import { useEffect } from 'react'
import { IconClose, IconFolder } from './Icons'

interface Props {
  path: string
  description?: string
  score?: number
  thumbUrl: string
  onClose: () => void
  onReveal: (path: string) => void
}

export function Lightbox({ path, description, score, thumbUrl, onClose, onReveal }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <img src={thumbUrl} alt={description || '预览'} />
        <div className="lightbox-bar">
          <span>{description?.trim() ? description : '无描述'}</span>
          {typeof score === 'number' && <span>匹配度 {(score * 100).toFixed(2)}%</span>}
          <button className="btn sm" onClick={() => onReveal(path)}>
            <IconFolder />
            打开所在文件夹
          </button>
          <button className="btn sm" onClick={onClose}>
            <IconClose size={14} />
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
