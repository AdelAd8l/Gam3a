import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'

import Icon from '../components/Icon'
import StatusBadge from '../components/StatusBadge'
import { api, type Assessment, type Course } from '../lib/api'
import { courseInput, formatDate, formatNumber, formatTime, GRADES, weekOrder, weekdayName } from '../lib/format'
import { useDialogs, useRefresh, useUser } from '../lib/hooks'
import { t } from '../lib/i18n'

const pct = (n: number) => `${formatNumber(n, 2)}%`

export default function CourseDetail() {
  const { id } = useParams()
  const courseId = Number(id)
  const course = useQuery({ queryKey: ['courses', 'one', courseId], queryFn: () => api.course(courseId) })
  const items = useQuery({
    queryKey: ['assessments', 'course', courseId],
    queryFn: () => api.assessments({ course_id: courseId }),
  })
  const { editCourse, editAssessment } = useDialogs()

  const c = course.data
  if (!c || !items.data) return <div className="page" />
  const list = items.data
  const listed = list.filter((a) => a.weight).reduce((s, a) => s + (a.weight ?? 0), 0)

  return (
    <div className="page course-page" style={{ '--c': c.color } as React.CSSProperties}>
      <Link to="/courses" className="back-link">
        <Icon name="left" size={16} flip /> {t('course.back')}
      </Link>

      <header className="course-head">
        <div>
          <p className="eyebrow">
            {[c.code, t('common.creditsN', { n: formatNumber(c.credits, 1) }), c.instructor].filter(Boolean).join(' · ')}
          </p>
          <h1>{c.name}</h1>
          {c.meetings.length > 0 && <MeetingsLine course={c} />}
        </div>
        <div className="page-head-actions">
          <button className="btn" onClick={() => editCourse(c)}>
            {t('course.editDetails')}
          </button>
          <button className="btn btn-primary" onClick={() => editAssessment(undefined, { course_id: c.id })}>
            <Icon name="plus" size={16} /> {t('course.addWork')}
          </button>
        </div>
      </header>

      <div className="course-layout">
        <section className="panel">
          <div className="panel-head">
            <h2>{t('course.work')}</h2>
          </div>
          {list.length === 0 ? (
            <p className="faint panel-empty">{t('course.noWork')}</p>
          ) : (
            <table className="work-table">
              <thead>
                <tr>
                  <th>{t('course.colItem')}</th>
                  <th>{t('course.colDue')}</th>
                  <th className="num-col">{t('course.colWeight')}</th>
                  <th className="num-col">{t('course.colMark')}</th>
                  <th className="num-col">{t('course.colPercent')}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id} onClick={() => editAssessment(a)} className={a.score === null ? 'is-open' : ''}>
                    <td>
                      <button type="button" className="row-link">
                        {a.title}
                      </button>
                      <span className="faint work-kind">{t(`akind.${a.kind}`)}</span>
                    </td>
                    <td className="faint">{a.due_date ? formatDate(a.due_date) : '—'}</td>
                    <td className="num-col num">{a.weight !== null ? `${formatNumber(a.weight, 2)}%` : '—'}</td>
                    <td className="num-col num">{markText(a)}</td>
                    <td className="num-col num">{a.score !== null ? formatNumber(a.score, 1) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>{t('course.total')}</td>
                  <td className={`num-col num${listed > 100.001 ? ' danger-text' : ''}`}>{formatNumber(listed, 2)}%</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        <GoalPanel course={c} items={list} />
      </div>
    </div>
  )
}

function markText(a: Assessment) {
  if (a.points_earned !== null && a.points_max !== null)
    return `${formatNumber(a.points_earned, 2)} / ${formatNumber(a.points_max, 2)}`
  if (a.points_max !== null) return `— / ${formatNumber(a.points_max, 2)}`
  return '—'
}

function MeetingsLine({ course }: { course: Course }) {
  const user = useUser()
  const order = weekOrder(user.week_start)
  const sorted = [...course.meetings].sort((a, b) => order.indexOf(a.weekday) - order.indexOf(b.weekday))
  return (
    <p className="faint meetings-line">
      {sorted.map((m, i) => (
        <span key={i}>
          {weekdayName(m.weekday, 'short')} {formatTime(m.start)} · {t(`kind.${m.kind}`)}
          {m.location ? ` · ${m.location}` : ''}
        </span>
      ))}
    </p>
  )
}

function GoalPanel({ course, items }: { course: Course; items: Assessment[] }) {
  const user = useUser()
  const refresh = useRefresh()
  const p = course.progress
  const letters = GRADES[user.scale]

  const setTarget = useMutation({
    mutationFn: (grade: string) => api.saveCourse({ ...courseInput(course), target_grade: grade }, course.id),
    onSuccess: () => refresh(),
  })
  const setFinal = useMutation({
    mutationFn: (grade: string) => api.setGrade(course.id, grade),
    onSuccess: () => refresh(),
  })

  // Items still to be marked, and what "the required average" means on each of them.
  const upcoming = items.filter((a) => a.score === null && a.weight)
  const upcomingWeight = upcoming.reduce((s, a) => s + (a.weight ?? 0), 0)
  const unlisted = Math.max(0, p.remaining_weight - upcomingWeight)
  const allMarked = p.graded_weight >= 99.99

  return (
    <aside className="panel goal-panel">
      <div className="panel-head">
        <h2>{t('course.goal')}</h2>
        <StatusBadge status={p.status} />
      </div>

      <div className="goal-body">
        <label className="field">
          <span>{t('course.target')}</span>
          <select
            className="select"
            value={p.target_grade}
            onChange={(e) => setTarget.mutate(e.target.value)}
            disabled={setTarget.isPending}
          >
            {letters.map((g) => (
              <option key={g} value={g}>
                {g} ({formatNumber(user.cutoffs[g] ?? 0, 1)}%+)
              </option>
            ))}
          </select>
        </label>

        <dl className="goal-figures">
          <div>
            <dt>{t('course.current')}</dt>
            <dd>
              <span className="num">{p.current !== null ? pct(p.current) : '—'}</span>
              {p.current_letter && <span className="grade-chip">{p.current_letter}</span>}
            </dd>
            {p.current !== null && (
              <small className="faint">{t('course.onGraded', { pct: formatNumber(p.graded_weight, 2) })}</small>
            )}
          </div>
          <div>
            <dt>{t('course.secured')}</dt>
            <dd className="num">{formatNumber(p.earned, 2)}</dd>
            <small className="faint">{t('course.securedHelp')}</small>
          </div>
          <div>
            <dt>{t('course.best')}</dt>
            <dd>
              <span className="num">{pct(p.max_possible)}</span>
              <span className="grade-chip">{p.max_letter}</span>
            </dd>
          </div>
        </dl>

        <div className={`goal-answer goal-${p.status}`}>
          {p.status === 'secured' && <p>{t('course.securedMsg', { grade: p.target_grade })}</p>}
          {p.status === 'out_of_reach' && (
            <p>
              {t('course.outOfReach', {
                grade: p.target_grade,
                best: formatNumber(p.max_possible, 2),
                letter: p.max_letter,
              })}
            </p>
          )}
          {(p.status === 'needs' || p.status === 'on_track' || p.status === 'no_data') && p.required !== null && (
            <>
              <p className="goal-title">
                {t('course.needTitle', { grade: p.target_grade, pct: formatNumber(p.target_percent, 2) })}
              </p>
              <p>
                {t('course.need', {
                  need: formatNumber(p.required, 2),
                  rest: formatNumber(p.remaining_weight, 2),
                })}
              </p>
              {p.status === 'on_track' && <p className="faint">{t('course.onTrack')}</p>}
              {p.status === 'needs' && <p className="faint">{t('course.behind')}</p>}
              {p.status === 'no_data' && items.length === 0 && <p className="faint">{t('course.noData')}</p>}
            </>
          )}
        </div>

        {(p.status === 'needs' || p.status === 'on_track' || p.status === 'no_data') &&
          p.required !== null &&
          upcoming.length > 0 && (
            <div>
              <p className="faint per-item-title">{t('course.perItem')}</p>
              <ul className="per-item">
                {upcoming.map((a) => (
                  <li key={a.id}>
                    <span>
                      {a.title} <span className="faint">({formatNumber(a.weight ?? 0, 2)}%)</span>
                    </span>
                    <strong className="num">
                      {a.points_max
                        ? t('course.atLeast', {
                            points: formatNumber(Math.min(a.points_max, (p.required! / 100) * a.points_max), 2),
                            max: formatNumber(a.points_max, 2),
                          })
                        : pct(Math.min(100, p.required!))}
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

        {unlisted > 0.01 && p.status !== 'secured' && (
          <p className="notice">{t('course.unlisted', { pct: formatNumber(unlisted, 2) })}</p>
        )}
        {p.listed_weight > 100.001 && (
          <p className="notice notice-danger">{t('course.overweight', { pct: formatNumber(p.listed_weight, 2) })}</p>
        )}

        {allMarked && p.current_letter && (
          course.grade === p.current_letter ? (
            <p className="faint">{t('course.finalSet', { grade: course.grade })}</p>
          ) : (
            <button className="btn" onClick={() => setFinal.mutate(p.current_letter!)} disabled={setFinal.isPending}>
              {t('course.setFinal', { grade: p.current_letter })}
            </button>
          )
        )}
      </div>
    </aside>
  )
}
