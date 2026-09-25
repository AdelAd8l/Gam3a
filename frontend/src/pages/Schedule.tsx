import { useState } from 'react'
import { Link } from 'react-router-dom'

import Agenda from '../components/Agenda'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import PageHeader from '../components/PageHeader'
import TimingsDialog from '../components/TimingsDialog'
import WeekGrid from '../components/WeekGrid'
import { api, type Block } from '../lib/api'
import { formatNumber, todayISO, weekOrder, weekdayName, weekdayOf } from '../lib/format'
import { useCourses, useDialogs, usePlan, useTerm, useUser } from '../lib/hooks'
import { t } from '../lib/i18n'

const hours = (minutes: number) => t('schedule.hours', { n: formatNumber(minutes / 60, 1) })

export default function Schedule() {
  const user = useUser()
  const { term } = useTerm()
  const { byId: courses } = useCourses(term!.id)
  const plan = usePlan(term!.id)
  const { editCourse } = useDialogs()
  const [withStudy, setWithStudy] = useState(true)
  const [timings, setTimings] = useState(false)
  const [exporting, setExporting] = useState(false)
  const days = weekOrder(user.week_start)
  const today = weekdayOf(todayISO())
  const [day, setDay] = useState(today)

  const blocks = (plan.data?.blocks ?? []).filter((b) => withStudy || b.kind !== 'study')
  const openBlock = (b: Block) => {
    const course = b.course_id ? courses.get(b.course_id) : undefined
    if (course) editCourse(course)
    else if (b.kind === 'busy') setTimings(true)
  }
  const hasClasses = plan.data?.blocks.some((b) => b.kind === 'class')

  return (
    <div className="page page-wide">
      <PageHeader title={t('schedule.title')}>
        <div className="segmented" role="group">
          <button aria-pressed={!withStudy} onClick={() => setWithStudy(false)}>
            {t('schedule.classesOnly')}
          </button>
          <button aria-pressed={withStudy} onClick={() => setWithStudy(true)}>
            {t('schedule.withStudy')}
          </button>
        </div>
        <button className="btn" onClick={() => setTimings(true)}>
          <Icon name="sliders" size={16} /> {t('schedule.timings')}
        </button>
        <button className="btn" onClick={() => setExporting(true)}>
          <Icon name="download" size={16} /> {t('schedule.export')}
        </button>
      </PageHeader>

      {plan.data && (
        <p className="summary-line">
          {t('schedule.summary', { classes: hours(plan.data.class_minutes), study: hours(plan.data.study_minutes) })}
        </p>
      )}

      {plan.data?.conflicts.map((c, i) => (
        <p key={i} className="notice notice-danger">
          <Icon name="alert" size={16} />
          {t('schedule.conflicts', { a: c.a.title, b: c.b.title, day: weekdayName(c.a.weekday) })}
        </p>
      ))}
      {plan.data &&
        Object.entries(plan.data.unplaced).map(([id, minutes]) => (
          <p key={id} className="notice">
            <Icon name="clock" size={16} />
            {t('schedule.unplaced', { time: hours(minutes), course: courses.get(Number(id))?.name ?? '' })}
          </p>
        ))}

      {plan.data && !hasClasses && (
        <div className="empty">
          <h3>{t('schedule.empty')}</h3>
          <p className="muted">{t('schedule.emptyBody')}</p>
          <div className="empty-actions">
            <button className="btn btn-primary" onClick={() => editCourse()}>
              {t('schedule.addCourse')}
            </button>
          </div>
        </div>
      )}

      {plan.data && (hasClasses || blocks.length > 0) && (
        <>
          <div className="only-wide">
            <WeekGrid
              blocks={blocks}
              days={days}
              restDays={term!.rest_days}
              courses={courses}
              today={today}
              onBlock={openBlock}
            />
          </div>
          <div className="only-narrow">
            <div className="day-tabs" role="tablist">
              {days.map((d) => (
                <button
                  key={d}
                  role="tab"
                  aria-selected={d === day}
                  className={d === today ? 'is-today' : ''}
                  onClick={() => setDay(d)}
                >
                  {weekdayName(d, 'short')}
                </button>
              ))}
            </div>
            {blocks.some((b) => b.weekday === day) ? (
              <Agenda blocks={blocks.filter((b) => b.weekday === day)} courses={courses} onBlock={openBlock} />
            ) : (
              <p className="faint panel-empty">{term!.rest_days.includes(day) ? t('today.restDay') : t('today.free')}</p>
            )}
          </div>
          <Legend />
        </>
      )}

      <TimingsDialog key={timings ? 'open' : 'closed'} open={timings} term={term!} onClose={() => setTimings(false)} />
      <ExportDialog open={exporting} termId={term!.id} onClose={() => setExporting(false)} />
    </div>
  )
}

function Legend() {
  return (
    <div className="legend">
      <span>
        <i className="legend-class" /> {t('schedule.classesOnly')}
      </span>
      <span>
        <i className="legend-study" /> {t('block.study')}
      </span>
      <span>
        <i className="legend-busy" /> {t('block.busy')}
      </span>
    </div>
  )
}

function ExportDialog({ open, termId, onClose }: { open: boolean; termId: number; onClose: () => void }) {
  const [study, setStudy] = useState(false)
  return (
    <Modal title={t('schedule.export')} open={open} onClose={onClose} width={420}>
      <div className="stack">
        <p className="muted">{t('schedule.exportHelp')}</p>
        <p className="google-tip">
          {t('schedule.googleTip')}{' '}
          <Link to="/settings#google" onClick={onClose}>
            {t('schedule.googleTipLink')}
          </Link>
        </p>
        <label className="check">
          <input type="checkbox" checked={study} onChange={(e) => setStudy(e.target.checked)} />
          <span>{t('schedule.includeStudy')}</span>
        </label>
        <footer className="modal-actions">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
          <a className="btn btn-primary" href={api.calendarUrl(termId, study)} download onClick={onClose}>
            <Icon name="download" size={16} /> {t('schedule.download')}
          </a>
        </footer>
      </div>
    </Modal>
  )
}
