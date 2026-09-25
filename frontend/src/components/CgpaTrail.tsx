import type { TermGrades } from '../lib/api'
import { formatGpa, truncateGpa } from '../lib/format'
import ClassBadge from './ClassBadge'
import { locale, t } from '../lib/i18n'

/** CGPA going into a term → the term's GPA → CGPA coming out of it, with the change. */
export default function CgpaTrail({ row }: { row: TermGrades }) {
  const graded = row.gpa !== null
  // Difference of the two numbers as shown (both cut to 3 decimals), counted in thousandths.
  const delta =
    graded && row.cgpa !== null && row.cgpa_before !== null
      ? Math.round((truncateGpa(row.cgpa) - truncateGpa(row.cgpa_before)) * 1000) / 1000
      : null
  const sign = delta === null || delta === 0 ? 'same' : delta > 0 ? 'up' : 'down'

  return (
    <div className="cgpa-trail">
      <span>
        <small>{t('cgpa.before')}</small>
        <b className="num">{row.cgpa_before !== null ? formatGpa(row.cgpa_before) : '—'}</b>
        {row.cgpa_before === null && <small className="faint">{t('cgpa.first')}</small>}
      </span>
      <span className="cgpa-arrow" aria-hidden="true">
        →
      </span>
      <span>
        <small>{t('grades.termGpa')}</small>
        <b className="num">{formatGpa(row.gpa)}</b>
        <ClassBadge band={row.gpa_class} />
      </span>
      <span className="cgpa-arrow" aria-hidden="true">
        →
      </span>
      <span>
        <small>{t('cgpa.after')}</small>
        {graded ? (
          <b className="num">
            {formatGpa(row.cgpa)}
            {delta !== null && (
              <em className={`cgpa-delta cgpa-${sign}`}>
                {new Intl.NumberFormat(locale(), {
                  minimumFractionDigits: 3,
                  maximumFractionDigits: 3,
                  signDisplay: 'exceptZero',
                }).format(delta)}
              </em>
            )}
          </b>
        ) : (
          <small className="faint">{t('cgpa.pending')}</small>
        )}
        {graded && <ClassBadge band={row.cgpa_class} />}
      </span>
    </div>
  )
}
