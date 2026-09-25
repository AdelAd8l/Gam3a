import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { DeadlineRow } from '../components/DeadlineRow'
import PageHeader from '../components/PageHeader'
import { api, type Assessment } from '../lib/api'
import { addDays, todayISO } from '../lib/format'
import { useCourses, useDialogs, useRefresh, useTerm } from '../lib/hooks'
import { t, type Key } from '../lib/i18n'

type Filter = 'open' | 'done' | 'all'

export default function Deadlines() {
  const { term } = useTerm()
  const { data: courses = [], byId } = useCourses(term!.id)
  const { editAssessment } = useDialogs()
  const refresh = useRefresh()
  const [filter, setFilter] = useState<Filter>('open')
  const [courseId, setCourseId] = useState('')

  const items = useQuery({
    queryKey: ['assessments', 'term', term!.id],
    queryFn: () => api.assessments({ term_id: term!.id }),
  })
  const toggle = useMutation({
    mutationFn: (item: Assessment) => {
      const { id, ...rest } = item
      return api.saveAssessment({ ...rest, done: !item.done }, id)
    },
    onSuccess: () => refresh(),
  })

  const visible = (items.data ?? []).filter(
    (a) =>
      (filter === 'all' || (filter === 'done' ? a.done : !a.done)) && (!courseId || a.course_id === Number(courseId)),
  )
  const today = todayISO()
  const week = addDays(today, 7)
  const groups: [Key, Assessment[]][] = [
    ['deadlines.overdue', visible.filter((a) => a.due_date && a.due_date < today && !a.done)],
    ['deadlines.thisWeek', visible.filter((a) => a.due_date && a.due_date >= today && a.due_date <= week)],
    ['deadlines.later', visible.filter((a) => a.due_date && a.due_date > week)],
    ['deadlines.done', visible.filter((a) => a.due_date && a.due_date < today && a.done)],
    ['deadlines.noDate', visible.filter((a) => !a.due_date)],
  ]

  return (
    <div className="page page-narrow">
      <PageHeader title={t('deadlines.title')}>
        <button className="btn btn-primary" onClick={() => editAssessment()}>
          {t('deadlines.add')}
        </button>
      </PageHeader>

      <div className="toolbar">
        <div className="segmented" role="group">
          {(['open', 'done', 'all'] as const).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {t(`deadlines.${f}`)}
            </button>
          ))}
        </div>
        <select className="select select-auto" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          <option value="">{t('deadlines.allCourses')}</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code || c.name}
            </option>
          ))}
        </select>
      </div>

      {items.data && visible.length === 0 && (
        <div className="empty">
          <h3>{t('deadlines.empty')}</h3>
          <p className="muted">{t('deadlines.emptyBody')}</p>
          <div className="empty-actions">
            <button className="btn btn-primary" onClick={() => editAssessment()}>
              {t('deadlines.add')}
            </button>
          </div>
        </div>
      )}

      <div className="deadline-groups">
        {groups
          .filter(([, list]) => list.length > 0)
          .map(([label, list]) => (
            <section key={label}>
              <h2 className={label === 'deadlines.overdue' ? 'danger-text' : ''}>{t(label)}</h2>
              <ul className="deadline-list panel">
                {list.map((a) => (
                  <DeadlineRow
                    key={a.id}
                    item={a}
                    course={byId.get(a.course_id)}
                    onToggle={() => toggle.mutate(a)}
                    onOpen={() => editAssessment(a)}
                  />
                ))}
              </ul>
            </section>
          ))}
      </div>
    </div>
  )
}
