import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { api, type Assessment, type AssessmentKind } from '../lib/api'
import { ask } from '../lib/confirm'
import { addDays, todayISO } from '../lib/format'
import { useCourses, useRefresh, useTerm } from '../lib/hooks'
import { t } from '../lib/i18n'
import Modal from './Modal'
import SwatchSelect from './SwatchSelect'

const KINDS: AssessmentKind[] = ['assignment', 'quiz', 'midterm', 'final', 'project', 'other']

interface Props {
  open: boolean
  item?: Assessment
  courseId?: number
  onClose: () => void
}

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
const NONE = 'none' // the course list's "no course" choice
const NO_COURSE_COLOR = '#8A8F98'

export default function AssessmentDialog({ open, item, courseId, onClose }: Props) {
  const { term } = useTerm()
  const { data: courses = [] } = useCourses(term?.id)
  const refresh = useRefresh()

  // A course id, or NONE for a task with no course. New tasks start on the first course, or on
  // "no course" when there are none yet.
  const [course, setCourse] = useState(
    item ? (item.course_id === null ? NONE : String(item.course_id)) : courseId ? String(courseId) : '',
  )
  const chosen = course || (courses.length ? String(courses[0].id) : NONE)
  const noCourse = chosen === NONE
  const [title, setTitle] = useState(item?.title ?? '')
  const [kind, setKind] = useState<AssessmentKind>(item?.kind ?? 'assignment')
  const [kindPicked, setKindPicked] = useState(!!item)
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
          course_id: noCourse ? null : Number(chosen),
          title,
          kind,
          due_date: date || null,
          due_time: date && time ? time : null,
          // A task with no course has nothing to grade.
          weight: noCourse ? null : numOrNull(weight),
          score: null,
          points_earned: noCourse ? null : numOrNull(earned),
          // A mark without "out of" is read as a percentage.
          points_max: noCourse ? null : (numOrNull(outOf) ?? (numOrNull(earned) !== null ? 100 : null)),
          done: done || (!noCourse && numOrNull(earned) !== null),
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
            <SwatchSelect
              colorOf={(v) => (v === NONE ? NO_COURSE_COLOR : courses.find((c) => String(c.id) === v)?.color)}
              value={chosen}
              onChange={(v) => {
                setCourse(v)
                // an everyday task isn't an "assignment" unless you say so
                if (v === NONE && !kindPicked) setKind('other')
              }}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code ? `${c.code} · ${c.name}` : c.name}
                </option>
              ))}
              <option value={NONE}>{t('deadlines.noCourse')}</option>
            </SwatchSelect>
          </label>
          <label className="field">
            <span>{t('deadlines.type')}</span>
            <select
              className="select"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as AssessmentKind)
                setKindPicked(true)
              }}
            >
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
        {/* weight and mark count toward a course's grade, so only a course's items have them */}
        {!noCourse && (
          <>
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
          </>
        )}
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
              onClick={async () => (await ask({ title: t('deadlines.confirmDelete'), confirm: t('common.delete') })) && remove.mutate()}
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
