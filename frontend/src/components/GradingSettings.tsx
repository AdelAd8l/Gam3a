import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api, type User } from '../lib/api'
import { formatNumber, GRADES } from '../lib/format'
import { useRefresh } from '../lib/hooks'
import { t } from '../lib/i18n'
import { BANDS, bandLetters } from '../lib/labels'

const asStrings = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]))
const asNumbers = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]))

/** Settings → Grading: minimum % and grade points per letter, GPA classification, default goal. */
export default function GradingSettings({ user }: { user: User }) {
  const qc = useQueryClient()
  const refresh = useRefresh()
  const letters = GRADES[user.scale]

  const [cutoffs, setCutoffs] = useState(() => asStrings(user.cutoffs))
  const [points, setPoints] = useState(() => asStrings(user.points))
  const [bands, setBands] = useState(() => asStrings(user.bands))
  const [defaultTarget, setDefaultTarget] = useState(user.default_target)

  const apply = async (u: User) => {
    qc.setQueryData(['me'], u)
    setCutoffs(asStrings(u.cutoffs))
    setPoints(asStrings(u.points))
    setBands(asStrings(u.bands))
    await refresh()
  }
  const save = useMutation({
    mutationFn: () => {
      const { F: _, ...mins } = asNumbers(cutoffs)
      return api.updateMe({
        cutoffs: mins,
        points: asNumbers(points),
        bands: asNumbers(bands),
        default_target: defaultTarget,
      })
    },
    onSuccess: apply,
  })
  const reset = useMutation({
    mutationFn: () => api.updateMe({ cutoffs: {}, points: {}, bands: {} }),
    onSuccess: apply,
  })

  // "To" of each letter = just under the "from" of the letter above it.
  const upper = (i: number) => {
    if (i === 0) return '100'
    const above = Number(cutoffs[letters[i - 1]])
    return Number.isFinite(above) ? formatNumber(above - 0.01, 2) : '—'
  }
  const numericPoints = asNumbers(points)

  return (
    <form
      className="stack panel panel-pad"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <table className="grading-table">
        <thead>
          <tr>
            <th>{t('grading.letter')}</th>
            <th>{t('grading.from')}</th>
            <th>{t('grading.to')}</th>
            <th>{t('grading.points')}</th>
          </tr>
        </thead>
        <tbody>
          {letters.map((g, i) => (
            <tr key={g}>
              <td className="grade-cell">{g}</td>
              <td>
                {g === 'F' ? (
                  <span className="faint">{t('grading.below', { pct: cutoffs[letters[i - 1]] ?? '' })}</span>
                ) : (
                  <span className="pct-input">
                    <input
                      className="input"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step="any"
                      aria-label={`${g} ${t('grading.from')}`}
                      value={cutoffs[g] ?? ''}
                      onChange={(e) => setCutoffs((c) => ({ ...c, [g]: e.target.value }))}
                      required
                    />
                    <span className="faint">%</span>
                  </span>
                )}
              </td>
              <td className="faint num">{g === 'F' ? '' : `${upper(i)}%`}</td>
              <td>
                <input
                  className="input points-input"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={Number(user.scale)}
                  step="any"
                  aria-label={`${g} ${t('grading.points')}`}
                  value={points[g] ?? ''}
                  onChange={(e) => setPoints((p) => ({ ...p, [g]: e.target.value }))}
                  required
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div>
        <h3 className="sub-title">{t('grading.classes')}</h3>
        <p className="faint help">{t('grading.classesHint')}</p>
      </div>
      <table className="grading-table bands-table">
        <tbody>
          {BANDS.map((band, i) => (
            <tr key={band}>
              <td>
                <span className={`class-badge class-${band}`}>{t(`class.${band}`)}</span>
              </td>
              <td>
                {band === 'fail' ? (
                  <span className="faint">{t('grading.lessThan', { gpa: bands.pass ?? '' })}</span>
                ) : (
                  <span className="pct-input">
                    <span className="faint">≥</span>
                    <input
                      className="input points-input"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={Number(user.scale)}
                      step="any"
                      aria-label={t(`class.${band}`)}
                      value={bands[band] ?? ''}
                      onChange={(e) => setBands((b) => ({ ...b, [band]: e.target.value }))}
                      required
                    />
                  </span>
                )}
              </td>
              <td className="faint band-letters">
                {bandLetters(band, i, asNumbers(bands), numericPoints, letters).join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <label className="field">
        <span>{t('settings.defaultTarget')}</span>
        <select className="select" value={defaultTarget} onChange={(e) => setDefaultTarget(e.target.value)}>
          {letters.map((g) => (
            <option key={g} value={g}>
              {g} ({formatNumber(Number(cutoffs[g] ?? 0), 2)}%+)
            </option>
          ))}
        </select>
      </label>

      <div className="form-foot">
        {(save.isSuccess || reset.isSuccess) && <span className="faint">{t('settings.saved')}</span>}
        {(save.error || reset.error) && <span className="danger-text">{(save.error ?? reset.error)!.message}</span>}
        <button type="button" className="btn btn-quiet" onClick={() => reset.mutate()} disabled={reset.isPending}>
          {t('settings.reset')}
        </button>
        <button className="btn btn-primary" disabled={save.isPending}>
          {t('settings.saveProfile')}
        </button>
      </div>
    </form>
  )
}
