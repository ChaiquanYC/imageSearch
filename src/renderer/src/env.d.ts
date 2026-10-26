import type { ImageSearchApi } from '../../shared/api'

declare global {
  interface Window {
    api?: ImageSearchApi
  }
}

export {}
