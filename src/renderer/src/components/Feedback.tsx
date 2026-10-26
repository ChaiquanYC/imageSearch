import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'

type ToastKind = 'info' | 'success' | 'error'

interface ToastItem {
  id: number
  text: string
  kind: ToastKind
}

interface ConfirmOptions {
  title: string
  body?: string
  okText?: string
  cancelText?: string
  danger?: boolean
}

type PushToast = (text: string, kind?: ToastKind) => void
type AskConfirm = (options: ConfirmOptions) => Promise<boolean>

const ToastCtx = createContext<PushToast>(() => {})
const ConfirmCtx = createContext<AskConfirm>(async () => false)

export function useToast() {
  return useContext(ToastCtx)
}

export function useConfirm() {
  return useContext(ConfirmCtx)
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const seq = useRef(1)
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(
    null
  )

  const push = useCallback<PushToast>((text, kind = 'info') => {
    const id = seq.current++
    setToasts((list) => [...list, { id, text, kind }])
    window.setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id))
    }, 3400)
  }, [])

  const confirm = useCallback<AskConfirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve })
      }),
    []
  )

  const settle = (value: boolean) => {
    pending?.resolve(value)
    setPending(null)
  }

  const ctx = useMemo(() => ({ push, confirm }), [push, confirm])

  return (
    <ToastCtx.Provider value={ctx.push}>
      <ConfirmCtx.Provider value={ctx.confirm}>
        {children}
        <div className="toast-wrap">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind === 'info' ? '' : t.kind}`}>
              {t.text}
            </div>
          ))}
        </div>
        {pending && (
          <div className="overlay" onClick={() => settle(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h3 className="modal-title">{pending.title}</h3>
              {pending.body && <div className="modal-body">{pending.body}</div>}
              <div className="modal-actions">
                <button className="btn" onClick={() => settle(false)}>
                  {pending.cancelText ?? '取消'}
                </button>
                <button
                  className="btn primary"
                  style={pending.danger ? { background: '#e24b4a', borderColor: '#e24b4a' } : undefined}
                  onClick={() => settle(true)}
                >
                  {pending.okText ?? '确定'}
                </button>
              </div>
            </div>
          </div>
        )}
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  )
}
