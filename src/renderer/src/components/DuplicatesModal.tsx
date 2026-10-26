import { useEffect, useState } from 'react'
import type { DuplicateScanResult } from '../../../shared/types'
import { IconClose, IconDuplicate } from './Icons'
import { api, basename } from '../lib/api'

interface Props {
  result: DuplicateScanResult
  onClose: () => void
  onPurged: (removed: number) => void
}

export function DuplicatesModal({ result, onClose, onPurged }: Props) {
  // 默认保留每组第一张，其余全部勾选待删除
  const [picked, setPicked] = useState<Set<number>>(() => {
    const next = new Set<number>()
    for (const group of result.groups) {
      for (const item of group.items.slice(1)) next.add(item.id)
    }
    return next
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggle = (id: number) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const purge = async () => {
    if (picked.size === 0) return
    setBusy(true)
    try {
      const removed = await api.purgeDuplicates([...picked])
      onPurged(removed)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const totalDup = result.groups.reduce((n, g) => n + g.items.length - 1, 0)

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 className="modal-title">
            <IconDuplicate size={16} /> 查重结果
          </h3>
          <button className="icon-btn" onClick={onClose} title="关闭">
            <IconClose size={16} />
          </button>
        </div>

        <div className="modal-sub">
          扫描 {result.scanned} 张 · 相似度阈值 {(result.threshold * 100).toFixed(0)}% · 发现{' '}
          <b>{result.groups.length}</b> 组重复，共 <b>{totalDup}</b> 张冗余 · 耗时{' '}
          {(result.elapsedMs / 1000).toFixed(2)} 秒
        </div>

        <div className="dup-list">
          {result.groups.map((group, gi) => (
            <div className="dup-group" key={group.keepId}>
              <div className="dup-group-head">
                <span className="dup-index">第 {gi + 1} 组</span>
                <span className="dup-sim">相似度 {(group.similarity * 100).toFixed(1)}%</span>
                <span className="dup-count">{group.items.length} 张</span>
              </div>
              <div className="dup-items">
                {group.items.map((item, idx) => {
                  const isKeep = idx === 0
                  return (
                    <label
                      className={`dup-item ${isKeep ? 'keep' : ''} ${
                        picked.has(item.id) ? 'checked' : ''
                      }`}
                      key={item.id}
                    >
                      <img src={api.thumb(item.path, 160)} alt="" loading="lazy" />
                      <div className="dup-meta">
                        <span className="dup-name" title={item.path}>
                          {basename(item.path)}
                        </span>
                        <span className="dup-desc">{item.description || '无描述'}</span>
                        <span className="dup-badge">
                          {isKeep ? '保留' : item.exact ? '内容完全相同' : `${(item.similarity * 100).toFixed(1)}%`}
                        </span>
                      </div>
                      {!isKeep && (
                        <input
                          type="checkbox"
                          checked={picked.has(item.id)}
                          onChange={() => toggle(item.id)}
                        />
                      )}
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
          {result.groups.length === 0 && (
            <div className="empty">
              <IconDuplicate size={28} />
              <strong>没有发现重复图</strong>
              <span>把阈值调低一些可以找出更宽松的相似图</span>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <span className="modal-note">已勾选 {picked.size} 张将被彻底删除（含磁盘文件）</span>
          <button className="btn" onClick={onClose}>
            关闭
          </button>
          <button
            className="btn danger"
            disabled={picked.size === 0 || busy}
            onClick={() => void purge()}
          >
            {busy ? '正在删除…' : `删除选中的 ${picked.size} 张`}
          </button>
        </div>
      </div>
    </div>
  )
}
