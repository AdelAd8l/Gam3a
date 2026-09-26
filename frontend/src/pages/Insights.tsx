import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { Columns, NumbersTable, type Stack } from '../components/charts'
import PageHeader from '../components/PageHeader'
import { api, type Assessment, type Course, type Plan } from '../lib/api'
import { compact, numClass } from '../lib/chart'
import { durationLabel, formatGpa, formatNumber, todayISO, toMinutes, weekdayName, weekOrder } from '../lib/format'
import { useCourses, usePlan, useTerm, useUser } from '../lib/hooks'
import { t } from '../lib/i18n'

const DAY = 86_400_000

const courseName = (c: Course) => c.code || c.name
const hours = (minutes: number) => durationLabel(Math.round(minutes))

/** A few charts about the selected term: where each course stands, how the deadlines fall
 * across the weeks, and where the week's hours go. */
export default function Insights() {
  const { term } = useTerm()
  const { data: courses = [] } = useCourses(term!.id)
  const plan = usePlan(term!.id)
  const items = useQuery({
    queryKey: ['assessments', 'term', term!.id],
    queryFn: () => api.assessments({ term_id: term!.id }),
  })
  const grades = useQuery({ queryKey: ['grades'], queryFn: api.grades })

  const withDate = (items.data ?? []).filter((a) => a.due_date)
  const done = withDate.filter((a) => a.done).length
  const credits = courses.reduce((s, c) => s + c.credits, 0)
  const weekly = plan.data ? plan.data.class_minutes + plan.data.study_minutes : null

  return (
    <div className="page">
      <PageHeader title={t('nav.insights')} />

      <section className="figures" aria-label={t('insights.summary')}>
        <Figure label={t('insights.cgpa')} value={formatGpa(grades.data?.cgpa)} note={t('insights.allTerms')} />
        <Figure
          label={t('insights.credits')}
          value={formatNumber(credits, 1)}
          note={t('insights.courses', { n: courses.length })}
        />
        <Figure
          label={t('insights.deadlinesDone')}
          value={withDate.length ? `${done} / ${withDate.length}` : '—'}
          note={withDate.length ? t('insights.pctDone', { pct: Math.round((done / withDate.length) * 100) }) : ' '}
        />
        <Figure
          label={t('insights.weekly')}
          value={weekly === null ? '—' : hours(weekly)}
          note={
            plan.data
              ? t('insights.weeklySplit', { classes: hours(plan.data.class_minutes), study: hours(plan.data.study_minutes) })
              : ' '
          }
        />
      </section>

      {courses.length === 0 ? (
        <div className="empty">
          <h3>{t('insights.emptyTitle')}</h3>
          <p className="muted">{t('insights.emptyBody')}</p>
          <div className="empty-actions">
            <Link className="btn btn-primary" to="/courses">
              {t('nav.courses')}
            </Link>
          </div>
        </div>
      ) : (
        <div className="insights-grid">
          <Standing courses={courses} />
          <DeadlineWeeks courses={courses} items={items.data ?? []} start={term!.start_date} end={term!.end_date} />
          {plan.data && <WeekHours plan={plan.data} />}
          {plan.data && <CourseHours plan={plan.data} courses={courses} />}
        </div>
      )}
    </div>
  )
}

/** Each course out of 100: what is already earned, how high it can still go, and the target. */
function Standing({ courses }: { courses: Course[] }) {
  return (
    <section className="panel span-2">
      <div className="panel-head">
        <h2>{t('insights.standing')}</h2>
      </div>
      <p className="chart-note faint">{t('insights.standingHint')}</p>
      <ul className="standing">
        {courses.map((c) => {
          const p = c.progress
          return (
            <li key={c.id}>
              <Link to={`/courses/${c.id}`} className="standing-line">
                <span className="cat-name">
                  <span className="swatch" style={{ background: c.color }} />
                  <span className="standing-name">{courseName(c)}</span>
                </span>
                <span className="faint standing-text">
                  {p.graded_weight > 0
                    ? t('insights.standingText', {
                        earned: formatNumber(p.earned, 1),
                        best: formatNumber(p.max_possible, 1),
                      })
                    : t('insights.noMarks')}
                </span>
              </Link>
              <span className="standing-bar" aria-hidden="true">
                <span className="standing-best" style={{ width: `${p.max_possible}%`, background: c.color }} />
                <span className="standing-earned" style={{ width: `${p.earned}%`, background: c.color }} />
                {p.status !== 'no_data' && (
                  <span className="standing-target" style={{ insetInlineStart: `${p.target_percent}%` }} title={p.target_grade} />
                )}
              </span>
            </li>
          )
        })}
      </ul>
      <ul className="chart-legend standing-legend">
        <li>
          <i className="chart-key standing-key-earned" /> {t('insights.earned')}
        </li>
        <li>
          <i className="chart-key standing-key-best" /> {t('insights.canReach')}
        </li>
        <li>
          <i className="chart-key standing-key-target" /> {t('insights.target')}
        </li>
      </ul>
      <NumbersTable
        head={[t('common.course'), t('insights.earned'), t('insights.canReach'), t('insights.target'), t('insights.average')]}
        rows={courses.map((c) => [
          courseName(c),
          formatNumber(c.progress.earned, 2),
          formatNumber(c.progress.max_possible, 2),
          `${c.progress.target_grade} (${formatNumber(c.progress.target_percent, 1)})`,
          c.progress.current === null ? '—' : `${formatNumber(c.progress.current, 1)}%`,
        ])}
      />
    </section>
  )
}

/** How many deadlines fall in each week of the term, by course. */
function DeadlineWeeks({ courses, items, start, end }: { courses: Course[]; items: Assessment[]; start: string; end: string }) {
  const first = Date.parse(start)
  const weeks = Math.max(1, Math.ceil((Date.parse(end) - first + DAY) / (7 * DAY)))
  const week = (iso: string) => Math.min(weeks - 1, Math.max(0, Math.floor((Date.parse(iso) - first) / (7 * DAY))))
  const shown = courses.filter((c) => items.some((a) => a.course_id === c.id && a.due_date))
  const stacks: Stack[] = shown.map((c) => ({ label: courseName(c), color: c.color }))
  const values = Array.from({ length: weeks }, () => new Array(stacks.length).fill(0))
  for (const a of items) {
    const k = shown.findIndex((c) => c.id === a.course_id)
    if (a.due_date && k >= 0) values[week(a.due_date)][k] += 1
  }
  const now = week(todayISO())
  const busiest = values.reduce((best, col, i, all) => (sum(col) > sum(all[best]) ? i : best), 0)
  const count = (n: number) => t('insights.deadlinesN', { n })

  return (
    <section className="panel span-2">
      <div className="panel-head">
        <h2>{t('insights.byWeek')}</h2>
      </div>
      {stacks.length ? (
        <>
          <p className="chart-note faint">
            {t('insights.busiest', { week: busiest + 1, n: sum(values[busiest]) })}
          </p>
          <Columns
            labels={values.map((_, i) => String(i + 1))}
            values={values}
            stacks={stacks}
            format={(v) => formatNumber(v)}
            title={(i) => `${t('insights.weekN', { n: i + 1 })}${i === now ? ` · ${t('insights.thisWeek')}` : ''}`}
            initial={now}
            integer
            ariaLabel={t('insights.byWeek')}
            axisWidth={34}
          />
          <NumbersTable
            head={[t('insights.week'), ...stacks.map((s) => s.label), t('reports.total')]}
            rows={values.map((col, i) => [String(i + 1), ...col.map((v) => formatNumber(v)), count(sum(col))])}
          />
        </>
      ) : (
        <p className="faint panel-empty">{t('insights.noDeadlines')}</p>
      )}
    </section>
  )
}

/** Hours in class and hours of planned study on each day of the week. */
function WeekHours({ plan }: { plan: Plan }) {
  const user = useUser()
  const days = weekOrder(user.week_start)
  const minutes = (kind: 'class' | 'study', day: number) =>
    plan.blocks
      .filter((b) => b.kind === kind && b.weekday === day)
      .reduce((s, b) => s + toMinutes(b.end) - toMinutes(b.start), 0)
  // in hours, so the axis steps in whole hours
  const values = days.map((d) => [minutes('class', d) / 60, minutes('study', d) / 60])
  const stacks: Stack[] = [
    { label: t('insights.classes'), color: 'var(--accent)' },
    { label: t('insights.study'), color: 'var(--ink-3)' },
  ]
  const today = days.indexOf((new Date().getDay() + 6) % 7)
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('insights.hoursByDay')}</h2>
      </div>
      <Columns
        labels={days.map((d) => weekdayName(d, 'short'))}
        values={values}
        stacks={stacks}
        format={(h) => hours(h * 60)}
        tick={compact}
        title={(i) => weekdayName(days[i])}
        initial={Math.max(0, today)}
        ariaLabel={t('insights.hoursByDay')}
        axisWidth={34}
        height={200}
      />
      <NumbersTable
        head={[t('insights.day'), t('insights.classes'), t('insights.study')]}
        rows={days.map((d, i) => [weekdayName(d), hours(values[i][0] * 60), hours(values[i][1] * 60)])}
      />
    </section>
  )
}

/** Each course's weekly hours: classes plus planned study. */
function CourseHours({ plan, courses }: { plan: Plan; courses: Course[] }) {
  const rows = courses
    .map((c) => {
      const mins = (kind: 'class' | 'study') =>
        plan.blocks
          .filter((b) => b.kind === kind && b.course_id === c.id)
          .reduce((s, b) => s + toMinutes(b.end) - toMinutes(b.start), 0)
      return { c, classes: mins('class'), study: mins('study') }
    })
    .sort((a, b) => b.classes + b.study - (a.classes + a.study))
  const max = Math.max(1, ...rows.map((r) => r.classes + r.study))
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('insights.hoursByCourse')}</h2>
      </div>
      <ul className="account-bars">
        {rows.map(({ c, classes, study }) => (
          <li key={c.id}>
            <span className="cat-name">
              <span className="swatch" style={{ background: c.color }} />
              {courseName(c)}
            </span>
            <span className={numClass(hours(classes + study))}>{hours(classes + study)}</span>
            <span className="account-bar" aria-hidden="true">
              <span style={{ width: `${((classes + study) / max) * 100}%`, background: c.color }} />
            </span>
            <small className="faint account-note">
              {t('insights.weeklySplit', { classes: hours(classes), study: hours(study) })}
            </small>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="figure">
      <span className="figure-label">{label}</span>
      <span className={`figure-value ${numClass(value) ?? ''}`}>{value}</span>
      <span className="figure-note">{note}</span>
    </div>
  )
}

function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0)
}
