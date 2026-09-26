import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { api, type Busy, type Term } from '../lib/api'
import { weekOrder, weekdayName } from '../lib/format'
import { useRefresh, useUser } from '../lib/hooks'
import { t } from '../lib/i18n'
import ColorField from './ColorField'
import Icon from './Icon'
import Modal from './Modal'
import DurationField from './DurationField'

/** One day of a commitment: its own hours, and the saved row's id if it has one. */
interface DayTime {
  id?: number
  weekday: number
  start: string
  end: string
}

/** A commitment (e.g. "Commute") on one or more days, each day with its own hours. Saved as one
 * row per day, so the planner, calendar and reminders see plain weekly blocks. */
interface Commitment {
  key: string
  title: string
  color: string
  days: DayTime[]
}

const GREY = '#8A8F98' // a commitment's color until one is chosen

/** Rows with the same name are one commitment. */
function group(rows: Busy[], order: number[]): Commitment[] {
  const out: Commitment[] = []
  for (const r of rows) {
    const name = r.title.trim().toLowerCase()
    let c = out.find((x) => x.title.trim().toLowerCase() === name)
    if (!c) {
      c = { key: `c${r.id}`, title: r.title, color: r.color ?? GREY, days: [] }
      out.push(c)
    }
    c.days.push({ id: r.id, weekday: r.weekday, start: r.start, end: r.end })
  }
  for (const c of out) c.days.sort((a, b) => order.indexOf(a.weekday) - order.indexOf(b.weekday))
  return out
}

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
  const [items, setItems] = useState<Commitment[]>(() => group(initial, days))
  const [missingDays, setMissingDays] = useState<string | null>(null)
  const [coloring, setColoring] = useState<string | null>(null) // the card whose color picker is open

  const edit = (key: string, change: (c: Commitment) => Commitment) =>
    setItems((list) => list.map((c) => (c.key === key ? change(c) : c)))
  const toggleDay = (key: string, weekday: number) =>
    edit(key, (c) => {
      if (c.days.some((d) => d.weekday === weekday)) return { ...c, days: c.days.filter((d) => d.weekday !== weekday) }
      // A new day starts with the hours of the days already chosen; change them if they differ.
      const like = c.days[c.days.length - 1] ?? { start: '17:00', end: '19:00' }
      const next = [...c.days, { weekday, start: like.start, end: like.end }]
      return { ...c, days: next.sort((a, b) => days.indexOf(a.weekday) - days.indexOf(b.weekday)) }
    })
  const setTime = (key: string, weekday: number, patch: Partial<DayTime>) =>
    edit(key, (c) => ({ ...c, days: c.days.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)) }))

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
      const rows = items.flatMap((c) => c.days.map((d) => ({ ...d, title: c.title.trim(), color: c.color })))
      const kept = new Set(rows.filter((r) => r.id).map((r) => r.id))
      await Promise.all([
        ...initial.filter((b) => !kept.has(b.id)).map((b) => api.deleteBusy(b.id)),
        ...rows.map((r) =>
          api.saveBusy(
            { term_id: term.id, title: r.title, weekday: r.weekday, start: r.start, end: r.end, color: r.color },
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
        const empty = items.find((c) => c.days.length === 0)
        setMissingDays(empty ? empty.title.trim() || t('timings.commitment') : null)
        if (!empty) save.mutate()
      }}
    >
      <h2>{t('timings.prefs')}</h2>
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
      <div className="stack">
        <div className="field">
          <span>{t('timings.hoursPerCredit')}</span>
          <DurationField
            minutes={perCredit * 60}
            onChange={(m) => setPerCredit(m / 60)}
            min={0}
            label={t('timings.hoursPerCredit')}
          />
        </div>
        <div className="field">
          <span>{t('timings.session')}</span>
          <DurationField minutes={session} onChange={setSession} min={30} label={t('timings.session')} />
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
      <div className="commitments">
        {items.map((c) => (
          <fieldset className="commitment" key={c.key}>
            <legend className="visually-hidden">{c.title || t('timings.commitment')}</legend>
            <div className="commitment-head">
              <button
                type="button"
                className="commitment-color"
                style={{ background: c.color }}
                aria-label={t('timings.color')}
                aria-expanded={coloring === c.key}
                onClick={() => setColoring((k) => (k === c.key ? null : c.key))}
              />
              <input
                className="input"
                aria-label={t('common.name')}
                placeholder={t('timings.titlePlaceholder')}
                value={c.title}
                maxLength={60}
                onChange={(e) => edit(c.key, (x) => ({ ...x, title: e.target.value }))}
                required
              />
              <button
                type="button"
                className="btn btn-quiet icon-btn"
                aria-label={t('common.delete')}
                onClick={() => setItems((list) => list.filter((x) => x.key !== c.key))}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
            {coloring === c.key && (
              <ColorField
                label={t('timings.color')}
                value={c.color}
                onChange={(color) => edit(c.key, (x) => ({ ...x, color }))}
              />
            )}
            <div className="commitment-chips" role="group" aria-label={t('timings.onDays')}>
              {days.map((d) => (
                <button
                  key={d}
                  type="button"
                  className="chip chip-sm"
                  aria-pressed={c.days.some((x) => x.weekday === d)}
                  onClick={() => toggleDay(c.key, d)}
                >
                  {weekdayName(d, 'short')}
                </button>
              ))}
            </div>
            {c.days.length === 0 ? (
              <p className="faint help">{t('timings.pickDays')}</p>
            ) : (
              <div className="commitment-days">
                {c.days.map((d) => (
                  <div className="commitment-day" key={d.weekday}>
                    <span>{weekdayName(d.weekday, 'short')}</span>
                    <input
                      className="input"
                      type="time"
                      aria-label={`${weekdayName(d.weekday)} · ${t('common.from')}`}
                      value={d.start}
                      onChange={(e) => setTime(c.key, d.weekday, { start: e.target.value })}
                      required
                    />
                    <input
                      className="input"
                      type="time"
                      aria-label={`${weekdayName(d.weekday)} · ${t('common.to')}`}
                      value={d.end}
                      onChange={(e) => setTime(c.key, d.weekday, { end: e.target.value })}
                      required
                    />
                  </div>
                ))}
              </div>
            )}
          </fieldset>
        ))}
        <button
          type="button"
          className="btn btn-sm add-row"
          onClick={() => setItems((list) => [...list, { key: `n${Date.now()}`, title: '', color: GREY, days: [] }])}
        >
          <Icon name="plus" size={14} /> {t('timings.addCommitment')}
        </button>
      </div>

      {missingDays && <p className="form-error">{t('timings.needDays', { name: missingDays })}</p>}
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
