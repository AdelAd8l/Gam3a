import { useEffect, useRef, type ReactNode } from 'react'

import { t } from '../lib/i18n'
import Icon from './Icon'

interface Props {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
  width?: number
}

/** Native <dialog>: focus trapping, Esc to close and the backdrop come for free. */
export default function Modal({ title, open, onClose, children, width = 440 }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      // showModal() focuses the first button (the close ×); start in the first field instead.
      dialog.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select, textarea')?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="modal"
      style={{ width }}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="modal-title"
    >
      {open && (
        <div className="modal-body">
          <header className="modal-head">
            <h3 id="modal-title">{title}</h3>
            <button type="button" className="btn btn-quiet icon-btn" onClick={onClose} aria-label={t('common.close')}>
              <Icon name="x" />
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  )
}
