interface Props {
  title: string
  label: string
  value: number
  total: number
  hint?: string
}

export function ProgressModal({ title, label, value, total, hint }: Props) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0
  return (
    <div className="overlay">
      <div className="modal" style={{ width: 440 }}>
        <h3 className="modal-title">{title}</h3>
        <div className="modal-body" style={{ minHeight: 22 }}>
          {label}
        </div>
        <div className="progress-track">
          <i style={{ width: `${total > 0 ? pct : 30}%` }} />
        </div>
        <div className="progress-line">
          <span>{total > 0 ? `${value} / ${total}` : '准备中…'}</span>
          <span>{total > 0 ? `${pct.toFixed(0)}%` : ''}</span>
        </div>
        {hint && (
          <div className="progress-line">
            <span>{hint}</span>
          </div>
        )}
      </div>
    </div>
  )
}
