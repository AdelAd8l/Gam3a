import { useQuery } from '@tanstack/react-query'

import CgpaTrail from '../components/CgpaTrail'
import PageHeader from '../components/PageHeader'
import { api } from '../lib/api'
import { formatDate, formatNumber, termStatus } from '../lib/format'
import { useDialogs, useTerm } from '../lib/hooks'
import { t } from '../lib/i18n'

export default function Terms() {
  const { term: active, terms, setTermId } = useTerm()
  const { editTerm } = useDialogs()
  const courses = useQuery({ queryKey: ['courses', 'all'], queryFn: () => api.courses() })
  const grades = useQuery({ queryKey: ['grades'], queryFn: api.grades })

  return (
    <div className="page page-narrow">
      <PageHeader title={t('terms.title')}>
        <button className="btn btn-primary" onClick={() => editTerm()}>
          {t('terms.add')}
        </button>
      </PageHeader>

      <ul className="term-list">
        {[...terms].reverse().map((term) => {
          const list = (courses.data ?? []).filter((c) => c.term_id === term.id)
          const row = grades.data?.terms.find((g) => g.term_id === term.id)
          const status = termStatus(term)
          const isActive = term.id === active?.id
          return (
            <li key={term.id} className={`panel term-card${isActive ? ' is-active' : ''}`}>
              <button type="button" className="term-main" onClick={() => editTerm(term)}>
                <span className="term-name">
                  <strong>{term.name}</strong>
                  <span className={`badge badge-${status}`}>{t(`status.${status}`)}</span>
                </span>
                <span className="faint">
                  {formatDate(term.start_date, { day: 'numeric', month: 'short', year: 'numeric' })} –{' '}
                  {formatDate(term.end_date, { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <span className="faint">
                  {t('terms.stats', {
                    courses: formatNumber(list.length),
                    credits: formatNumber(list.reduce((s, c) => s + c.credits, 0), 1),
                  })}
                </span>
                {row && <CgpaTrail row={row} />}
              </button>
              <button className="btn btn-sm" disabled={isActive} onClick={() => setTermId(term.id)}>
                {isActive ? t('terms.opened') : t('terms.open')}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
