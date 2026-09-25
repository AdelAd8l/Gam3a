import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { api, type Course, type Meeting, type MeetingKind } from '../lib/api'
import { GRADES, SPECIAL_GRADES, weekOrder, weekdayName } from '../lib/format'
import { useCourses, useRefresh, useTerm, useUser } from '../lib/hooks'
import { t } from '../lib/i18n'
import Icon from './Icon'
import Modal from './Modal'
import { PALETTE } from './palette'

const KINDS: MeetingKind[] = ['lecture', 'section', 'lab', 'tutorial']

interface Props {
  open: boolean
  course?: Course
  onClose: () => void
}

export default function CourseDialog({ open, course, onClose }: Props) {
  const user = useUser()
  const { term } = useTerm()
  const { data: existing = [] } = useCourses(term?.id)
  const refresh = useRefresh()
  const days = weekOrder(user.week_start)

  const [code, setCode] = useState(course?.code ?? '')
  const [name, setName] = useState(course?.name ?? '')
  const [credits, setCredits] = useState(String(course?.credits ?? 3))
  const [instructor, setInstructor] = useState(course?.instructor ?? '')
  const [color, setColor] = useState(course?.color ?? PALETTE[existing.length % PALETTE.length])
  const [grade, setGrade] = useState(course?.grade ?? '')
  const [inGpa, setInGpa] = useState(course?.in_gpa ?? true)
  const [meetings, setMeetings] = useState<Meeting[]>(course?.meetings ?? [])

  const updateMeeting = (i: number, patch: Partial<Meeting>) =>
    setMeetings((list) => list.map((m, j) => (j === i ? { ...m, ...patch } : m)))

  const addMeeting = () =>
    setMeetings((list) => {
      const last = list[list.length - 1]
      return [
        ...list,
        last
          ? { ...last, id: undefined, weekday: days[(days.indexOf(last.weekday) + 1) % 7] }
          : { weekday: days[0], start: '10:00', end: '11:30', kind: 'lecture', location: '' },
      ]
    })

  const save = useMutation({
    mutationFn: () =>
      api.saveCourse(
        {
          term_id: course?.term_id ?? term!.id,
          code: code.trim().toUpperCase(),
          name: name.trim(),
          credits: Number(credits) || 0,
          instructor: instructor.trim(),
          color,
          grade: grade || null,
          in_gpa: grade === 'P' ? false : inGpa,
          meetings: meetings.map(({ weekday, start, end, kind, location }) => ({
            weekday,
            start,
            end,
            kind,
            location: location.trim(),
          })),
        },
        course?.id,
      ),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
  })
  const remove = useMutation({
    mutationFn: () => api.deleteCourse(course!.id),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
  })

  return (
    <Modal title={course ? t('courses.edit') : t('courses.new')} open={open} onClose={onClose} width={680}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <div className="grid-code">
          <label className="field">
            <span>{t('courses.code')}</span>
            <input
              className="input"
              dir="ltr"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('courses.codePlaceholder')}
              maxLength={20}
            />
          </label>
          <label className="field">
            <span>{t('common.name')}</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('courses.namePlaceholder')}
              maxLength={100}
              required
            />
          </label>
        </div>
        <div className="grid-2">
          <label className="field">
            <span>{t('courses.credits')}</span>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min={0}
              max={12}
              step={0.5}
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>
              {t('courses.instructor')} <span className="faint">({t('common.optional')})</span>
            </span>
            <input className="input" value={instructor} onChange={(e) => setInstructor(e.target.value)} maxLength={80} />
          </label>
        </div>

        <fieldset className="field palette">
          <legend>{t('courses.color')}</legend>
          <div className="palette-grid">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className="palette-chip"
                style={{ background: c }}
                aria-label={c}
                aria-pressed={color.toLowerCase() === c.toLowerCase()}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="field meetings">
          <legend>{t('courses.classTimes')}</legend>
          {meetings.map((m, i) => (
            <div className="meeting-row" key={i}>
              <select
                className="select"
                aria-label={t('common.day')}
                value={m.weekday}
                onChange={(e) => updateMeeting(i, { weekday: Number(e.target.value) })}
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
                value={m.start}
                onChange={(e) => updateMeeting(i, { start: e.target.value })}
                required
              />
              <input
                className="input"
                type="time"
                aria-label={t('common.to')}
                value={m.end}
                onChange={(e) => updateMeeting(i, { end: e.target.value })}
                required
              />
              <select
                className="select"
                aria-label={t('deadlines.type')}
                value={m.kind}
                onChange={(e) => updateMeeting(i, { kind: e.target.value as MeetingKind })}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`kind.${k}`)}
                  </option>
                ))}
              </select>
              <input
                className="input"
                placeholder={t('courses.location')}
                aria-label={t('courses.location')}
                value={m.location}
                maxLength={60}
                onChange={(e) => updateMeeting(i, { location: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-quiet icon-btn"
                aria-label={t('courses.removeClass')}
                onClick={() => setMeetings((list) => list.filter((_, j) => j !== i))}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-sm add-row" onClick={addMeeting}>
            <Icon name="plus" size={14} /> {t('courses.addClass')}
          </button>
        </fieldset>

        <div className="grid-2">
          <label className="field">
            <span>{t('courses.grade')}</span>
            <select className="select" value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="">{t('courses.inProgress')}</option>
              {[...GRADES[user.scale], ...SPECIAL_GRADES].map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={grade === 'P' ? false : inGpa} disabled={grade === 'P'} onChange={(e) => setInGpa(e.target.checked)} />
            <span>{t('courses.inGpa')}</span>
          </label>
        </div>

        {(save.error || remove.error) && <p className="form-error">{(save.error ?? remove.error)!.message}</p>}
        <footer className="modal-actions">
          {course && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => confirm(t('courses.confirmDelete', { name: course.name })) && remove.mutate()}
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
