import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import Agenda from '../components/Agenda'
import ClassBadge from '../components/ClassBadge'
import { DeadlineRow } from '../components/DeadlineRow'
import { api, type Block } from '../lib/api'
import {
  addDays,
  formatDate,
  formatGpa,
  formatNumber,
  longDate,
  termStatus,
  termWeek,
  formatTime,
  todayISO,
  weekdayOf,
} from '../lib/format'
import { useCourses, useDialogs, usePlan, useRefresh, useTerm, useUser } from '../lib/hooks'
import { t } from '../lib/i18n'

export default function Today() {
  const user = useUser()
  const { term } = useTerm()
  const { byId: courses, data: courseList = [] } = useCourses(term!.id)
  const plan = usePlan(term!.id)
  const { editCourse, editAssessment } = useDialogs()
  const refresh = useRefresh()

  const today = todayISO()
  const weekday = weekdayOf(today)
  const now = new Date()
  const minutes = now.getHours() * 60 + now.getMinutes()
  const status = termStatus(term!, today)
  const week = termWeek(term!, today)

  const due = useQuery({
    queryKey: ['assessments', 'due', term!.id, today],
    queryFn: () => api.assessments({ term_id: term!.id, open_only: 'true', end: addDays(today, 7) }),
  })
  const grades = useQuery({ queryKey: ['grades'], queryFn: api.grades })
  const toggle = useMutation({
    mutationFn: (id: number) => {
      const item = due.data!.find((a) => a.id === id)!
      const { id: _, ...rest } = item
      return api.saveAssessment({ ...rest, done: !item.done }, id)
    },
    onSuccess: () => refresh(),
  })

  const blocksToday = status === 'current' ? (plan.data?.blocks ?? []).filter((b) => b.weekday === weekday) : []
  const tomorrowDay = weekdayOf(addDays(today, 1))
  const nextClass = (plan.data?.blocks ?? []).find((b) => b.weekday === tomorrowDay && b.kind === 'class')
  const openBlock = (b: Block) => {
    const c = b.course_id ? courses.get(b.course_id) : undefined
    if (c) editCourse(c)
  }

  const greeting = minutes < 12 * 60 ? 'today.morning' : minutes < 17 * 60 ? 'today.afternoon' : 'today.evening'
  const firstName = user.name.split(' ')[0]
  const credits = courseList.reduce((s, c) => s + c.credits, 0)
  const termGrades = grades.data?.terms.find((g) => g.term_id === term!.id)

  return (
    <div className="page">
      <header className="today-head">
        <div>
          <p className="eyebrow">{longDate(today)}</p>
          <h1>{t(greeting, { name: firstName })}</h1>
        </div>
        <div className="term-progress">
          <div className="term-progress-line">
            <strong>{term!.name}</strong>
            <span className="faint">
              {status === 'current'
                ? t('today.week', { n: formatNumber(week.current), total: formatNumber(week.total) })
                : status === 'upcoming'
                  ? t('today.notStarted', { date: formatDate(term!.start_date) })
                  : t('today.ended', { date: formatDate(term!.end_date) })}
            </span>
          </div>
          <div className="meter">
            <span style={{ width: `${status === 'past' ? 100 : status === 'upcoming' ? 0 : (week.current / week.total) * 100}%` }} />
          </div>
        </div>
      </header>

      <div className="today-grid">
        <section className="panel today-schedule">
          <div className="panel-head">
            <h2>{t('today.schedule')}</h2>
            <Link to="/schedule" className="link-quiet">
              {t('nav.schedule')}
            </Link>
          </div>
          {blocksToday.length > 0 ? (
            <Agenda blocks={blocksToday} courses={courses} now={minutes} onBlock={openBlock} />
          ) : (
            <p className="faint panel-empty">
              {term!.rest_days.includes(weekday) ? t('today.restDay') : t('today.free')}
            </p>
          )}
          {nextClass && status === 'current' && (
            <p className="tomorrow faint">
              {t('today.tomorrow')}: <strong>{courses.get(nextClass.course_id!)?.name}</strong> ·{' '}
              <span className="num">{formatTime(nextClass.start)}</span>
            </p>
          )}
        </section>

        <div className="today-side">
          <section className="panel">
            <div className="panel-head">
              <h2>{t('today.dueSoon')}</h2>
              <Link to="/deadlines" className="link-quiet">
                {t('nav.deadlines')}
              </Link>
            </div>
            {due.data && due.data.length > 0 ? (
              <ul className="deadline-list">
                {due.data.map((a) => (
                  <DeadlineRow
                    key={a.id}
                    item={a}
                    course={courses.get(a.course_id)}
                    onToggle={() => toggle.mutate(a.id)}
                    onOpen={() => editAssessment(a)}
                  />
                ))}
              </ul>
            ) : (
              <p className="faint panel-empty">{t('today.nothingDue')}</p>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>{t('today.glance')}</h2>
            </div>
            <dl className="glance">
              <div>
                <dt>{t('today.courses')}</dt>
                <dd className="num">{formatNumber(courseList.length)}</dd>
              </div>
              <div>
                <dt>{t('today.credits')}</dt>
                <dd className="num">{formatNumber(credits, 1)}</dd>
              </div>
              <div>
                <dt>{t('today.classHours')}</dt>
                <dd className="num">{formatNumber((plan.data?.class_minutes ?? 0) / 60, 1)}</dd>
              </div>
              <div>
                <dt>{t('today.studyHours')}</dt>
                <dd className="num">{formatNumber((plan.data?.study_minutes ?? 0) / 60, 1)}</dd>
              </div>
              <div>
                <dt>{t('grades.termGpa')}</dt>
                <dd className="num">{formatGpa(termGrades?.gpa)}</dd>
              </div>
              <div>
                <dt>{t('today.cgpa')}</dt>
                <dd className="num">
                  {formatGpa(grades.data?.cgpa)} <ClassBadge band={grades.data?.cgpa_class} />
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  )
}
