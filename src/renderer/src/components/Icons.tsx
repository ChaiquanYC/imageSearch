type Props = { size?: number; className?: string }

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export const IconSearch = ({ size = 18 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.6-3.6" />
  </svg>
)

export const IconLibrary = ({ size = 18 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M3 9h18M9 9v11" />
  </svg>
)

export const IconSettings = ({ size = 18 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 14.5a7.6 7.6 0 0 0 .1-5l1.5-1.2-2-3.4-1.8.7a7.6 7.6 0 0 0-4.3-2.5L12.6 1h-3.9L8.4 3.1a7.6 7.6 0 0 0-4.3 2.5l-1.8-.7-2 3.4L1.8 9.5a7.6 7.6 0 0 0 0 5l-1.5 1.2 2 3.4 1.8-.7a7.6 7.6 0 0 0 4.3 2.5l.3 2.1h3.9l.3-2.1a7.6 7.6 0 0 0 4.3-2.5l1.8.7 2-3.4z" />
  </svg>
)

export const IconUpload = ({ size = 30 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M12 16V4m0 0L7 9m5-5 5 5" />
    <path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11A2.5 2.5 0 0 0 20 18.5V15" />
  </svg>
)

export const IconRefresh = ({ size = 15 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 5v6h-6" />
  </svg>
)

export const IconTrash = ({ size = 15 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </svg>
)

export const IconTag = ({ size = 15 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M20.5 13.3 12.7 21a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 2.3 12.7L3 5l7.7-.7a2 2 0 0 1 1.6.6l8.2 8.2a1 1 0 0 1 0 1.4Z" />
    <circle cx="8" cy="9" r="1.4" />
  </svg>
)

export const IconFolder = ({ size = 15 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M3 7.5A2 2 0 0 1 5 5.5h4l2 2.5h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </svg>
)

export const IconPlus = ({ size = 15 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconChevronLeft = ({ size = 15 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="m14 5-7 7 7 7" />
  </svg>
)

export const IconChevronRight = ({ size = 15 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="m10 5 7 7-7 7" />
  </svg>
)

export const IconClose = ({ size = 18 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

export const IconCheck = ({ size = 15 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="m5 13 4.5 4.5L19 7" />
  </svg>
)

export const IconImage = ({ size = 28 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="m4 17 4.5-4.5L13 17l3-3 4 4" />
  </svg>
)

export const IconDownload = ({ size = 15 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5" />
    <path d="M4 16.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5" />
  </svg>
)

export const IconRestore = ({ size = 15 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M4 12a8 8 0 1 1 2.3 5.7" />
    <path d="M4 6v6h6" />
  </svg>
)

export const IconDuplicate = ({ size = 15 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <rect x="8" y="8" width="12" height="12" rx="2.2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </svg>
)

export const IconText = ({ size = 15 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M5 6V4h14v2M12 4v16M9 20h6" />
  </svg>
)

export const IconSort = ({ size = 15 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <path d="M4 7h10M4 12h7M4 17h4" />
    <path d="M17 8v11m0 0 3-3m-3 3-3-3" />
  </svg>
)

export const IconCpu = ({ size = 15 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
    <rect x="7" y="7" width="10" height="10" rx="2" />
    <path d="M10 3v4m4-4v4m-4 10v4m4-4v4M3 10h4m-4 4h4m10-4h4m-4 4h4" />
  </svg>
)
