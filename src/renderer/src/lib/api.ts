import type { ImageSearchApi } from '../../../shared/api'

export const api = window.api as ImageSearchApi

export function basename(p: string) {
  const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return idx >= 0 ? p.slice(idx + 1) : p
}

export function dash(value: string | null | undefined) {
  return value && value.trim() ? value : '—'
}
