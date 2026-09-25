import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { api, type Term } from '../lib/api'
import { addDays, todayISO } from '../lib/format'
import { useRefresh } from '../lib/hooks'
import { t } from '../lib/i18n'
import Modal from './Modal'

interface Props {
  open: boolean
  term?: Term
  onClose: () => void
  onCreated: (term: Term) => void
}

export default function TermDialog({ open, term, onClose, onCreated }: Props) {
  const refresh = useRefresh()
  const [name, setName] = useState(term?.name ?? '')
  const [start, setStart] = useState(term?.start_date ?? todayISO())
  const [end, setEnd] = useState(term?.end_date ?? addDays(todayISO(), 7 * 15 - 1))

  const save = useMutation({
    mutationFn: () =>
      api.saveTerm(
        {
          name,
          start_date: start,
          end_date: end,
          // Keep existing study preferences; new terms start with sensible defaults.
          study_start: term?.study_start ?? '09:00',
          study_end: term?.study_end ?? '22:00',
          hours_per_credit: term?.hours_per_credit ?? 2,
          session_minutes: term?.session_minutes ?? 90,
          rest_days: term?.rest_days ?? [4],
        },
        term?.id,
      ),
    onSuccess: async (saved) => {
      await refresh()
      if (!term) onCreated(saved)
      onClose()
    },
  })
  const remove = useMutation({
    mutationFn: () => api.deleteTerm(term!.id),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
  })

  return (
    <Modal title={term ? t('terms.edit') : t('terms.new')} open={open} onClose={onClose} width={420}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <label className="field">
          <span>{t('common.name')}</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('terms.namePlaceholder')}
            maxLength={60}
            required
          />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>{t('terms.start')}</span>
            <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label className="field">
            <span>{t('terms.end')}</span>
            <input className="input" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required />
          </label>
        </div>
        {(save.error || remove.error) && <p className="form-error">{(save.error ?? remove.error)!.message}</p>}
        <footer className="modal-actions">
          {term && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => confirm(t('terms.confirmDelete', { name: term.name })) && remove.mutate()}
            >
              {t('common.delete')}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
