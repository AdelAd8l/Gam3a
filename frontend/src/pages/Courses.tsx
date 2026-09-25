import { Link } from 'react-router-dom'

import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { formatNumber, formatTime, toMinutes, weekOrder, weekdayName } from '../lib/format'
import { useCourses, useDialogs, useTerm, useUser } from '../lib/hooks'
import { t } from '../lib/i18n'

export default function Courses() {
  const user = useUser()
  const { term } = useTerm()
  const { data: courses = [] } = useCourses(term!.id)
  const { editCourse } = useDialogs()
  const order = weekOrder(user.week_start)

  const credits = courses.reduce((s, c) => s + c.credits, 0)
  const classMinutes = courses.reduce(
    (s, c) => s + c.meetings.reduce((m, x) => m + toMinutes(x.end) - toMinutes(x.start), 0),
    0,
  )

  return (
    <div className="page">
      <PageHeader title={t('courses.title')}>
        <button className="btn btn-primary" onClick={() => editCourse()}>
          {t('courses.add')}
        </button>
      </PageHeader>

      {courses.length > 0 && (
        <p className="summary-line">
          {t('courses.summary', {
            courses: formatNumber(courses.length),
            credits: formatNumber(credits, 1),
            hours: t('schedule.hours', { n: formatNumber(classMinutes / 60, 1) }),
          })}
        </p>
      )}

      {courses.length === 0 && (
        <div className="empty">
          <h3>{t('courses.empty')}</h3>
          <p className="muted">{t('courses.emptyBody')}</p>
          <div className="empty-actions">
            <button className="btn btn-primary" onClick={() => editCourse()}>
              {t('courses.add')}
            </button>
          </div>
        </div>
      )}

      <div className="course-grid">
        {courses.map((c) => (
          <Link
            key={c.id}
            to={`/courses/${c.id}`}
            className="course-card"
            style={{ '--c': c.color } as React.CSSProperties}
          >
            <div className="course-top">
              <span className="course-code num">{c.code}</span>
              <span className="faint num">{t('common.creditsN', { n: formatNumber(c.credits, 1) })}</span>
            </div>
            <h3>{c.name}</h3>
            {c.instructor && <p className="faint course-instructor">{c.instructor}</p>}
            <ul className="course-meetings">
              {[...c.meetings]
                .sort((a, b) => order.indexOf(a.weekday) - order.indexOf(b.weekday) || a.start.localeCompare(b.start))
                .map((m) => (
                  <li key={m.id}>
                    <span>{weekdayName(m.weekday, 'short')}</span>
                    <span className="num">{formatTime(m.start)}</span>
                    <span className="faint">
                      {t(`kind.${m.kind}`)}
                      {m.location ? ` · ${m.location}` : ''}
                    </span>
                  </li>
                ))}
              {c.meetings.length === 0 && <li className="faint">{t('courses.noClasses')}</li>}
            </ul>
            <div className="course-foot">
              {c.grade ? (
                <span className="grade-badge">{c.grade}</span>
              ) : c.progress.current !== null ? (
                <span className="course-score">
                  <strong className="num">{formatNumber(c.progress.current, 1)}%</strong>
                  <span className="faint"> {c.progress.current_letter}</span>
                </span>
              ) : (
                <span className="faint">{t('courses.inProgress')}</span>
              )}
              {!c.grade && (
                <span className="course-goal">
                  <span className="faint">{t('course.targetShort', { grade: c.progress.target_grade })}</span>
                  <StatusBadge status={c.progress.status} />
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
