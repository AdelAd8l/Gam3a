import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, type Busy, type Term } from '../lib/api'
import { weekOrder, weekdayName } from '../lib/format'
import { useRefresh, useUser } from '../lib/hooks'
import { t } from '../lib/i18n'
import Icon from './Icon'
import Modal from './Modal'

type Row = Omit<Busy, 'id' | 'term_id'> & { id?: number }

interface Props {
  open: boolean
  term: Term
  onClose: () => void
}

/** Study preferences + fixed weekly commitments for one term. Loads its own data, saves both together. */
export default function TimingsDialog({ open, term, onClose }: Props) {
  const busy = useQuery({ queryKey: ['busy', term.id], queryFn: () => api.busy(term.id), enabled: open })
  return (
    <Modal title={t('timings.title')} open={open} onClose={onClose} width={620}>
      {busy.data && <TimingsForm term={term} initial={busy.data} onClose={onClose} />}
    </Modal>
  )
}

function TimingsForm({ term, initial, onClose }: { term: Term; initial: Busy[]; onClose: () => void }) {
  const user = useUser()
  const refresh = useRefresh()
  const days = weekOrder(user.week_start)

  const [studyStart, setStudyStart] = useState(term.study_start)
  const [studyEnd, setStudyEnd] = useState(term.study_end)
  const [perCredit, setPerCredit] = useState(term.hours_per_credit)
  const [session, setSession] = useState(term.session_minutes)
  const [rest, setRest] = useState<number[]>(term.rest_days)
  const [rows, setRows] = useState<Row[]>(initial)

  const update = (i: number, patch: Partial<Row>) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const save = useMutation({
    mutationFn: async () => {
      const { id, ...rest_of_term } = term
      await api.saveTerm(
        {
          ...rest_of_term,
          study_start: studyStart,
          study_end: studyEnd,
          hours_per_credit: perCredit,
          session_minutes: session,
          rest_days: rest,
        },
        id,
      )
      const kept = new Set(rows.filter((r) => r.id).map((r) => r.id))
      await Promise.all([
        ...initial.filter((b) => !kept.has(b.id)).map((b) => api.deleteBusy(b.id)),
        ...rows.map((r) =>
          api.saveBusy(
            { term_id: term.id, title: r.title.trim(), weekday: r.weekday, start: r.start, end: r.end },
            r.id,
          ),
        ),
      ])
    },
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: () => refresh(),
  })

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <h2>{t('timings.prefs')}</h2>
      <div className="grid-2">
        <div className="field">
          <span>{t('timings.window')}</span>
          <div className="time-pair">
            <input
              className="input"
              type="time"
              aria-label={t('common.from')}
              value={studyStart}
              onChange={(e) => setStudyStart(e.target.value)}
              required
            />
            <span className="faint">–</span>
            <input
              className="input"
              type="time"
              aria-label={t('common.to')}
              value={studyEnd}
              onChange={(e) => setStudyEnd(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="grid-2">
          <label className="field">
            <span>{t('timings.hoursPerCredit')}</span>
            <select className="select" value={perCredit} onChange={(e) => setPerCredit(Number(e.target.value))}>
              {[0, 0.5, 1, 1.5, 2, 2.5, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('timings.session')}</span>
            <select className="select" value={session} onChange={(e) => setSession(Number(e.target.value))}>
              {[45, 60, 90, 120].map((n) => (
                <option key={n} value={n}>
                  {t('timings.minutes', { n })}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <fieldset className="field day-chips">
        <legend>{t('timings.restDays')}</legend>
        <div>
          {days.map((d) => (
            <button
              key={d}
              type="button"
              className="chip"
              aria-pressed={rest.includes(d)}
              onClick={() => setRest((r) => (r.includes(d) ? r.filter((x) => x !== d) : [...r, d]))}
            >
              {weekdayName(d, 'short')}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <h2>{t('timings.commitments')}</h2>
        <p className="faint help">{t('timings.commitmentsHelp')}</p>
      </div>
      <div className="meetings">
        {rows.map((r, i) => (
          <div className="busy-row" key={r.id ?? `new-${i}`}>
            <input
              className="input"
              aria-label={t('common.name')}
              placeholder={t('timings.titlePlaceholder')}
              value={r.title}
              maxLength={60}
              onChange={(e) => update(i, { title: e.target.value })}
              required
            />
            <select
              className="select"
              aria-label={t('common.day')}
              value={r.weekday}
              onChange={(e) => update(i, { weekday: Number(e.target.value) })}
            >
              {days.map((d) => (
                <option key={d} value={d}>
                  {weekdayName(d)}
                </option>
              ))}
            </select>
            <input
              className="input"
              type="time"
              aria-label={t('common.from')}
              value={r.start}
              onChange={(e) => update(i, { start: e.target.value })}
              required
            />
            <input
              className="input"
              type="time"
              aria-label={t('common.to')}
              value={r.end}
              onChange={(e) => update(i, { end: e.target.value })}
              required
            />
            <button
              type="button"
              className="btn btn-quiet icon-btn"
              aria-label={t('common.delete')}
              onClick={() => setRows((list) => list.filter((_, j) => j !== i))}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-sm add-row"
          onClick={() => setRows((list) => [...list, { title: '', weekday: days[0], start: '17:00', end: '19:00' }])}
        >
          <Icon name="plus" size={14} /> {t('timings.addCommitment')}
        </button>
      </div>

      {save.error && <p className="form-error">{save.error.message}</p>}
      <footer className="modal-actions">
        <span className="spacer" />
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </button>
      </footer>
    </form>
  )
}
