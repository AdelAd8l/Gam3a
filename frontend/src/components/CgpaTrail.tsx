import type { TermGrades } from '../lib/api'
import { formatGpa } from '../lib/format'
import { locale, t } from '../lib/i18n'

/** CGPA going into a term → the term's GPA → CGPA coming out of it, with the change. */
export default function CgpaTrail({ row }: { row: TermGrades }) {
  const graded = row.gpa !== null
  const delta = graded && row.cgpa !== null && row.cgpa_before !== null ? row.cgpa - row.cgpa_before : null
  const sign = delta === null || Math.abs(delta) < 0.005 ? 'same' : delta > 0 ? 'up' : 'down'

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
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                  signDisplay: 'exceptZero',
                }).format(Math.round(delta * 100) / 100)}
              </em>
            )}
          </b>
        ) : (
          <small className="faint">{t('cgpa.pending')}</small>
        )}
      </span>
    </div>
  )
}
