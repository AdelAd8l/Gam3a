import { useEffect, useRef } from 'react'

import { answer, useQuestion } from '../lib/confirm'
import { t } from '../lib/i18n'

/** The app's own "are you sure?" dialog (see lib/confirm.ts). It opens on top of any other
 * dialog; Esc, the backdrop and Cancel all mean no. Cancel has the focus, so a stray Enter
 * never deletes anything. */
export default function ConfirmHost() {
  const question = useQuestion()
  const ref = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (question && !dialog.open) {
      dialog.showModal()
      cancel.current?.focus()
    }
    if (!question && dialog.open) dialog.close()
  }, [question])

  return (
    <dialog
      ref={ref}
      className="modal confirm"
      aria-labelledby="confirm-title"
      aria-describedby={question?.body ? 'confirm-body' : undefined}
      onCancel={(e) => {
        e.preventDefault() // Esc: close through answer() so the question resolves
        answer(false)
      }}
      onClick={(e) => e.target === ref.current && answer(false)}
    >
      {question && (
        <div className="modal-body">
          <h3 id="confirm-title" className="confirm-title">
            {question.title}
          </h3>
          {question.body && (
            <p id="confirm-body" className="muted confirm-body">
              {question.body}
            </p>
          )}
          <footer className="modal-actions">
            <span className="spacer" />
            <button ref={cancel} type="button" className="btn" onClick={() => answer(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className={question.danger ? 'btn btn-danger-solid' : 'btn btn-primary'}
              onClick={() => answer(true)}
            >
              {question.confirm}
            </button>
          </footer>
        </div>
      )}
    </dialog>
  )
}
