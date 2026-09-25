import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { api, type Assessment, type AssessmentKind } from '../lib/api'
import { addDays, todayISO } from '../lib/format'
import { useCourses, useRefresh, useTerm } from '../lib/hooks'
import { t } from '../lib/i18n'
import Modal from './Modal'

const KINDS: AssessmentKind[] = ['assignment', 'quiz', 'midterm', 'final', 'project', 'other']

interface Props {
  open: boolean
  item?: Assessment
  courseId?: number
  onClose: () => void
}

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))

export default function AssessmentDialog({ open, item, courseId, onClose }: Props) {
  const { term } = useTerm()
  const { data: courses = [] } = useCourses(term?.id)
  const refresh = useRefresh()

  const [course, setCourse] = useState(String(item?.course_id ?? courseId ?? ''))
  const [title, setTitle] = useState(item?.title ?? '')
  const [kind, setKind] = useState<AssessmentKind>(item?.kind ?? 'assignment')
  const [date, setDate] = useState(item ? (item.due_date ?? '') : addDays(todayISO(), 7))
  const [time, setTime] = useState(item?.due_time ?? '')
  const [weight, setWeight] = useState(item?.weight?.toString() ?? '')
  // Marks as written on the paper; older items that only have a % show as "x / 100".
  const [earned, setEarned] = useState(
    item?.points_earned?.toString() ?? (item?.score != null && item.points_max == null ? String(item.score) : ''),
  )
  const [outOf, setOutOf] = useState(item?.points_max?.toString() ?? (item?.score != null ? '100' : ''))
  const [done, setDone] = useState(item?.done ?? false)

  const save = useMutation({
    mutationFn: () =>
      api.saveAssessment(
        {
          course_id: Number(course || courses[0]?.id),
          title,
          kind,
          due_date: date || null,
          due_time: date && time ? time : null,
          weight: numOrNull(weight),
          score: null,
          points_earned: numOrNull(earned),
          // A mark without "out of" is read as a percentage.
          points_max: numOrNull(outOf) ?? (numOrNull(earned) !== null ? 100 : null),
          done: done || numOrNull(earned) !== null,
        },
        item?.id,
      ),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
  })
  const remove = useMutation({
    mutationFn: () => api.deleteAssessment(item!.id),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
  })

  return (
    <Modal title={item ? t('deadlines.edit') : t('deadlines.new')} open={open} onClose={onClose} width={480}>
      {courses.length === 0 && !item ? (
        <p className="muted">{t('deadlines.needCourse')}</p>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <label className="field">
            <span>{t('deadlines.titleLabel')}</span>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('deadlines.titlePlaceholder')}
              maxLength={100}
              required
            />
          </label>
          <div className="grid-2">
            <label className="field">
              <span>{t('common.course')}</span>
              <select
                className="select"
                value={course || String(courses[0]?.id ?? '')}
                onChange={(e) => setCourse(e.target.value)}
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code ? `${c.code} · ${c.name}` : c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('deadlines.type')}</span>
              <select className="select" value={kind} onChange={(e) => setKind(e.target.value as AssessmentKind)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`akind.${k}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid-2">
            <label className="field">
              <span>{t('deadlines.dueDate')}</span>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span>
                {t('deadlines.dueTime')} <span className="faint">({t('common.optional')})</span>
              </span>
              <input className="input" type="time" value={time} disabled={!date} onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>{t('deadlines.weightLabel')}</span>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="any"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </label>
          <div className="field">
            <span>
              {t('deadlines.mark')} <span className="faint">({t('common.optional')})</span>
            </span>
            <div className="mark-pair" dir="ltr">
              <input
                className="input"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                aria-label={t('deadlines.mark')}
                placeholder="28"
                value={earned}
                onChange={(e) => setEarned(e.target.value)}
              />
              <span className="faint">/</span>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                aria-label={t('deadlines.outOf')}
                placeholder="30"
                value={outOf}
                onChange={(e) => setOutOf(e.target.value)}
              />
            </div>
            <small className="faint">{t('deadlines.markHelp')}</small>
          </div>
          <label className="check">
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />
            <span>{t('deadlines.doneLabel')}</span>
          </label>

          {(save.error || remove.error) && <p className="form-error">{(save.error ?? remove.error)!.message}</p>}
          <footer className="modal-actions">
            {item && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => confirm(t('deadlines.confirmDelete')) && remove.mutate()}
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
      )}
    </Modal>
  )
}
