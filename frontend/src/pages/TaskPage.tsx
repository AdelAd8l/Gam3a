import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import Icon from '../components/Icon'
import PageHeader from '../components/PageHeader'
import SwatchSelect from '../components/SwatchSelect'
import { DateField, Select, TimeField } from '../components/pickers'
import { api, type Assessment, type AssessmentKind, type Subtask } from '../lib/api'
import { ask } from '../lib/confirm'
import { addDays, todayISO } from '../lib/format'
import { useAssessment, useCourses, useRefresh, useTerm, useUser } from '../lib/hooks'
import { t, type Key } from '../lib/i18n'

const KINDS: AssessmentKind[] = ['assignment', 'quiz', 'midterm', 'final', 'project', 'other']
const MAX_STEPS = 40
const NONE = 'none' // the course list's "no course" choice
const NO_COURSE_COLOR = '#8A8F98'
const TEMPLATES: { label: Key; steps: Key }[] = [
  { label: 'task.tplPresentation', steps: 'task.tplPresentationSteps' },
  { label: 'task.tplReport', steps: 'task.tplReportSteps' },
  { label: 'task.tplStudy', steps: 'task.tplStudySteps' },
]

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
/** A pasted list may carry bullets or numbers ("- Intro", "1. Intro"): keep just the words. */
const cleanLine = (line: string) => line.replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, '').trim().slice(0, 100)

interface Step extends Subtask {
  key: number // only for React's list; never sent to the server
}
let stepKey = 0
const nextKey = () => ++stepKey

/** The page for one task: its details, and the steps that make it up. */
export default function TaskPage() {
  const { id } = useParams()
  const taskId = id ? Number(id) : undefined
  const existing = useAssessment(taskId)
  if (taskId !== undefined && existing.isPending && !existing.data) return <div className="page page-narrow" aria-busy="true" />
  // the form starts from what it is given, so wait for the server's answer rather than show an old copy
  if (existing.data && existing.dataUpdatedAt === 0 && existing.isFetching && navigator.onLine) {
    return <div className="page page-narrow" aria-busy="true" />
  }
  if (taskId !== undefined && !existing.data) {
    return (
      <div className="page page-narrow">
        <PageHeader title={t('deadlines.edit')} />
        <div className="empty">
          <h3>{t('task.notFound')}</h3>
          <div className="empty-actions">
            <Link className="btn btn-primary" to="/deadlines">
              {t('deadlines.title')}
            </Link>
          </div>
        </div>
      </div>
    )
  }
  return <TaskForm key={existing.data?.id ?? 'new'} item={existing.data} />
}

function TaskForm({ item }: { item?: Assessment }) {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const { term } = useTerm()
  const { data: courses = [] } = useCourses(term?.id)
  const refresh = useRefresh()
  const user = useUser()

  // Back to wherever the person came from (the deadlines list, a course page, Today).
  const back = () => (window.history.state?.idx > 0 ? nav(-1) : nav('/deadlines'))

  // A course id, or NONE for a task with no course. New tasks start on the course they came from,
  // else the first course, or on "no course" when there are none yet.
  const presetCourse = params.get('course') ?? ''
  const [course, setCourse] = useState(
    item ? (item.course_id === null ? NONE : String(item.course_id)) : presetCourse,
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
  const [steps, setSteps] = useState<Step[]>(() => (item?.subtasks ?? []).map((s) => ({ ...s, key: nextKey() })))
  const [draft, setDraft] = useState('')
  const addRef = useRef<HTMLInputElement>(null)

  const hasMark = !noCourse && numOrNull(earned) !== null
  const stepsDone = steps.filter((s) => s.done).length

  /** Ticking the last step finishes the task; un-ticking one reopens it (unless a mark already finished it). */
  function syncDone(next: Step[]) {
    if (hasMark) return
    setDone(next.length > 0 && next.every((s) => s.done))
  }
  function setStepList(next: Step[]) {
    setSteps(next)
    syncDone(next)
  }
  function addSteps(titles: string[]) {
    const room = MAX_STEPS - steps.length
    const fresh = titles.map(cleanLine).filter(Boolean).slice(0, Math.max(0, room))
    if (fresh.length) setStepList([...steps, ...fresh.map((title) => ({ title, done: false, key: nextKey() }))])
  }
  function addDraft() {
    if (!draft.trim()) return
    addSteps([draft])
    setDraft('')
    addRef.current?.focus()
  }
  const move = (i: number, by: -1 | 1) => {
    const j = i + by
    if (j < 0 || j >= steps.length) return
    const next = [...steps]
    ;[next[i], next[j]] = [next[j], next[i]]
    setSteps(next)
  }

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
          done: done || hasMark,
          subtasks: steps.map((s) => ({ title: s.title.trim(), done: s.done })).filter((s) => s.title),
        },
        item?.id,
      ),
    onSuccess: async () => {
      await refresh()
      back()
    },
  })
  const remove = useMutation({
    mutationFn: () => api.deleteAssessment(item!.id),
    onSuccess: async () => {
      await refresh()
      back()
    },
  })

  return (
    <div className="page page-narrow task-page">
      <PageHeader title={item ? t('deadlines.edit') : t('deadlines.new')}>
        <button type="button" className="btn" onClick={back}>
          {t('common.cancel')}
        </button>
      </PageHeader>

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <section className="panel panel-pad stack">
          <h2 className="task-h">{t('task.details')}</h2>
          <label className="field">
            <span>{t('deadlines.titleLabel')}</span>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('deadlines.titlePlaceholder')}
              maxLength={100}
              required
              autoFocus={!item}
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
              <Select
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
              </Select>
            </label>
          </div>
          <div className="grid-2">
            <label className="field">
              <span>{t('deadlines.dueDate')}</span>
              <DateField value={date} onChange={setDate} weekStart={user.week_start} />
            </label>
            <label className="field">
              <span>
                {t('deadlines.dueTime')} <span className="faint">({t('common.optional')})</span>
              </span>
              <TimeField value={time} disabled={!date} onChange={setTime} />
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
        </section>

        <section className="panel panel-pad task-steps">
          <div className="task-steps-head">
            <h2 className="task-h">{t('task.steps')}</h2>
            {steps.length > 0 && <span className="faint num">{t('task.stepsDone', { done: stepsDone, total: steps.length })}</span>}
          </div>
          <p className="muted task-hint">{t('task.stepsHint')}</p>
          {steps.length > 0 && (
            <div className="step-bar" aria-hidden="true">
              <span style={{ width: `${Math.round((stepsDone / steps.length) * 100)}%` }} />
            </div>
          )}

          {steps.length > 0 && (
            <ul className="step-list">
              {steps.map((s, i) => (
                <li key={s.key} className={`step${s.done ? ' is-done' : ''}`}>
                  <button
                    type="button"
                    className="tick"
                    role="checkbox"
                    aria-checked={s.done}
                    aria-label={t('task.markStep')}
                    onClick={() => setStepList(steps.map((x) => (x.key === s.key ? { ...x, done: !x.done } : x)))}
                  >
                    {s.done && <Icon name="check" size={14} />}
                  </button>
                  <input
                    className="input step-title"
                    value={s.title}
                    maxLength={100}
                    aria-label={t('task.stepTitle')}
                    onChange={(e) => setSteps(steps.map((x) => (x.key === s.key ? { ...x, title: e.target.value } : x)))}
                    // Enter in a step must not submit the whole task: it moves on to the next box
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      addRef.current?.focus()
                    }}
                  />
                  <span className="step-actions">
                    <button type="button" className="icon-btn" aria-label={t('task.moveUp')} disabled={i === 0} onClick={() => move(i, -1)}>
                      <Icon name="up" size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('task.moveDown')}
                      disabled={i === steps.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <Icon name="down" size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('task.removeStep')}
                      onClick={() => setStepList(steps.filter((x) => x.key !== s.key))}
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {steps.length < MAX_STEPS ? (
            <div className="step-add">
              <input
                ref={addRef}
                className="input"
                value={draft}
                maxLength={100}
                placeholder={t('task.addStepPlaceholder')}
                aria-label={t('task.addStep')}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  addDraft()
                }}
                // a pasted list becomes one step per line
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text')
                  if (!/\r?\n/.test(text.trim())) return
                  e.preventDefault()
                  addSteps(text.split(/\r?\n/))
                }}
              />
              <button type="button" className="btn" disabled={!draft.trim()} onClick={addDraft}>
                <Icon name="plus" size={16} /> {t('task.addStep')}
              </button>
            </div>
          ) : (
            <p className="faint">{t('task.limit', { n: MAX_STEPS })}</p>
          )}

          {steps.length === 0 && (
            <div className="step-templates">
              <span className="faint">{t('task.quickStart')}</span>
              {TEMPLATES.map((tpl) => (
                <button key={tpl.label} type="button" className="chip" onClick={() => addSteps(t(tpl.steps).split('|'))}>
                  {t(tpl.label)}
                </button>
              ))}
            </div>
          )}
          {steps.length > 0 && <small className="faint">{t('task.autoDone')}</small>}
        </section>

        {(save.error || remove.error) && <p className="form-error">{(save.error ?? remove.error)!.message}</p>}
        <footer className="modal-actions task-actions">
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
          <button type="button" className="btn" onClick={back}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </button>
        </footer>
      </form>
    </div>
  )
}
