import { useMutation, useQuery } from '@tanstack/react-query'
import { useLayoutEffect, useRef, useState } from 'react'

import CgpaTrail from '../components/CgpaTrail'
import PageHeader from '../components/PageHeader'
import { api, type Course, type Grades as GradesData } from '../lib/api'
import { formatGpa, formatGpaAtLeast, formatNumber, GRADES, POINTS, SPECIAL_GRADES } from '../lib/format'
import { useRefresh, useTerm, useUser } from '../lib/hooks'
import { t } from '../lib/i18n'

export default function Grades() {
  const user = useUser()
  const { term } = useTerm()
  const refresh = useRefresh()
  const grades = useQuery({ queryKey: ['grades'], queryFn: api.grades })
  const courses = useQuery({ queryKey: ['courses', 'all'], queryFn: () => api.courses() })
  const setGrade = useMutation({
    mutationFn: ({ id, grade }: { id: number; grade: string | null }) => api.setGrade(id, grade),
    onSuccess: () => refresh(),
  })

  const g = grades.data
  if (!g || !courses.data) return <div className="page" />
  const max = Number(g.scale)
  const selected = g.terms.find((x) => x.term_id === term!.id)

  return (
    <div className="page">
      <PageHeader title={t('grades.title')} />

      <section className="figures figures-3">
        <div className="figure">
          <span className="figure-label">{t('grades.cgpa')}</span>
          <span className="figure-value num">{formatGpa(g.cgpa)}</span>
          <span className="figure-note">{t('grades.scale', { n: g.scale })}</span>
        </div>
        <div className="figure">
          <span className="figure-label">{t('grades.credits')}</span>
          <span className="figure-value num">{formatNumber(g.earned_credits, 1)}</span>
          <span className="figure-note">&nbsp;</span>
        </div>
        <div className="figure">
          <span className="figure-label">{t('grades.termGpa')}</span>
          <span className="figure-value num">{formatGpa(selected?.gpa)}</span>
          <span className="figure-note">{term!.name}</span>
        </div>
      </section>

      {g.terms.some((x) => x.gpa !== null) && (
        <section className="panel">
          <div className="panel-head">
            <h2>{t('grades.chart')}</h2>
          </div>
          <GpaChart data={g} max={max} />
        </section>
      )}

      <div className="grades-grid">
        <div className="grade-terms">
          {[...g.terms].reverse().map((row) => {
            const list = courses.data.filter((c) => c.term_id === row.term_id)
            return (
              <section key={row.term_id} className="panel">
                <div className="panel-head">
                  <h2>{row.name}</h2>
                </div>
                <CgpaTrail row={row} />
                {list.length ? (
                  <table className="grade-table">
                    <thead>
                      <tr>
                        <th>{t('grades.courseCol')}</th>
                        <th className="num-col">{t('grades.creditsCol')}</th>
                        <th className="num-col">{t('grades.gradeCol')}</th>
                        <th className="num-col">{t('grades.pointsCol')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <span className="swatch" style={{ background: c.color }} /> {c.code && <span className="num">{c.code} </span>}
                            {c.name}
                          </td>
                          <td className="num-col num">{formatNumber(c.credits, 1)}</td>
                          <td className="num-col">
                            <select
                              className="select select-grade"
                              value={c.grade ?? ''}
                              aria-label={`${t('grades.gradeCol')} · ${c.name}`}
                              onChange={(e) => setGrade.mutate({ id: c.id, grade: e.target.value || null })}
                            >
                              <option value="">—</option>
                              {[...GRADES[g.scale], ...SPECIAL_GRADES].map((x) => (
                                <option key={x}>{x}</option>
                              ))}
                            </select>
                          </td>
                          <td className="num-col num faint">
                            {c.grade && c.in_gpa && POINTS[g.scale][c.grade] !== undefined
                              ? formatNumber(POINTS[g.scale][c.grade] * c.credits, 2)
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="faint panel-empty">{t('grades.noCourses')}</p>
                )}
              </section>
            )
          })}
        </div>

        <aside className="grade-tools">
          <WhatIf data={g} max={max} defaultCredits={courses.data.filter((c) => c.term_id === term!.id && !c.grade).reduce((s, c) => s + c.credits, 0) || 15} />
          <Projection
            data={g}
            courses={courses.data.filter((c) => c.term_id === term!.id && !c.grade && c.in_gpa)}
            scale={user.scale}
          />
        </aside>
      </div>
    </div>
  )
}

function WhatIf({ data, max, defaultCredits }: { data: GradesData; max: number; defaultCredits: number }) {
  const [target, setTarget] = useState(String(Math.min(max, Math.round(((data.cgpa ?? max * 0.75) + 0.1) * 10) / 10)))
  const [credits, setCredits] = useState(String(defaultCredits))
  const goal = Number(target)
  const next = Number(credits)
  const needed = next > 0 ? (goal * (data.total_credits + next) - data.points) / next : null
  const best = next > 0 ? (data.points + max * next) / (data.total_credits + next) : null

  return (
    <section className="panel panel-pad stack">
      <h2>{t('grades.whatIf')}</h2>
      <div className="grid-2">
        <label className="field">
          <span>{t('grades.target')}</span>
          <input className="input" type="number" inputMode="decimal" min={0} max={max} step={0.01} value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('grades.nextCredits')}</span>
          <input className="input" type="number" inputMode="decimal" min={1} max={40} value={credits} onChange={(e) => setCredits(e.target.value)} />
        </label>
      </div>
      {needed !== null && Number.isFinite(needed) && (
        <p className="answer">
          {needed <= 1e-9
            ? t('grades.reached')
            : needed > max + 1e-9
              ? t('grades.impossible', { gpa: formatGpa(best) })
              : t('grades.need', { gpa: formatGpaAtLeast(Math.min(needed, max)) })}
        </p>
      )}
    </section>
  )
}

function Projection({ data, courses, scale }: { data: GradesData; courses: Course[]; scale: '4' | '5' }) {
  const [expected, setExpected] = useState<Record<number, string>>({})
  if (!courses.length) return null
  const table = POINTS[scale]
  const picked = courses.filter((c) => expected[c.id])
  const addPoints = picked.reduce((s, c) => s + table[expected[c.id]] * c.credits, 0)
  const addCredits = picked.reduce((s, c) => s + c.credits, 0)
  const index = data.terms.findIndex((x) => x.term_id === courses[0].term_id)
  const term = data.terms[index]
  // Exact points already graded in this term (not re-derived from the cut-off GPA).
  const termPoints = term ? term.cumulative_points - (index > 0 ? data.terms[index - 1].cumulative_points : 0) : 0
  const termCredits = term?.gpa_credits ?? 0
  const termGpa = termCredits + addCredits ? (termPoints + addPoints) / (termCredits + addCredits) : null
  const cgpa = data.total_credits + addCredits ? (data.points + addPoints) / (data.total_credits + addCredits) : null

  return (
    <section className="panel panel-pad stack">
      <div>
        <h2>{t('grades.projection')}</h2>
        <p className="faint help">{t('grades.projectionHelp')}</p>
      </div>
      <ul className="projection">
        {courses.map((c) => (
          <li key={c.id}>
            <span>
              <span className="swatch" style={{ background: c.color }} /> {c.code || c.name}
            </span>
            <select
              className="select select-grade"
              aria-label={`${t('grades.expected')} · ${c.name}`}
              value={expected[c.id] ?? ''}
              onChange={(e) => setExpected((x) => ({ ...x, [c.id]: e.target.value }))}
            >
              <option value="">—</option>
              {GRADES[scale].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      {picked.length > 0 && (
        <p className="answer">{t('grades.projected', { gpa: formatGpa(termGpa), cgpa: formatGpa(cgpa) })}</p>
      )}
    </section>
  )
}

/** Bars for each term's GPA, a line for the cumulative GPA. Hand-drawn SVG sized to its container. */
function GpaChart({ data, max }: { data: GradesData; max: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(640)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rows = data.terms.filter((x) => x.gpa !== null || x.cgpa !== null)
  const H = 200
  const pad = { top: 14, right: 8, bottom: 28, left: 36 }
  const innerW = W - pad.left - pad.right
  const innerH = H - pad.top - pad.bottom
  const slot = innerW / Math.max(1, rows.length)
  const y = (v: number) => pad.top + innerH - (v / max) * innerH
  const ticks = Array.from({ length: max + 1 }, (_, i) => i)
  const line = rows
    .map((r, i) => (r.cgpa === null ? null : `${pad.left + slot * i + slot / 2},${y(r.cgpa)}`))
    .filter(Boolean)
    .join(' ')

  return (
    <div className="gpa-chart" ref={box}>
      <div className="trend-readout">
        <span>
          <i className="key key-term" /> {t('grades.chartTerm')}
        </span>
        <span>
          <i className="key key-cum" /> {t('grades.chartCumulative')}
        </span>
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} className="trend-svg" role="img" aria-label={t('grades.chart')}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={W - pad.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? 'axis' : 'grid'} />
            <text x={pad.left - 10} y={y(tick)} dy="0.32em" textAnchor="end" className="tick">
              {tick}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = pad.left + slot * i + slot / 2
          const bw = Math.min(34, slot * 0.45)
          return (
            <g key={r.term_id}>
              {r.gpa !== null && (
                <>
                  <rect x={cx - bw / 2} y={y(r.gpa)} width={bw} height={innerH + pad.top - y(r.gpa)} rx="2" className="bar-term" />
                  <text x={cx} y={y(r.gpa) - 6} textAnchor="middle" className="tick tick-value">
                    {formatGpa(r.gpa)}
                  </text>
                </>
              )}
              <text x={cx} y={H - 8} textAnchor="middle" className="tick tick-x">
                {r.name}
              </text>
            </g>
          )
        })}
        {line && <polyline points={line} className="cum-line" />}
        {rows.map((r, i) =>
          r.cgpa === null ? null : (
            <circle key={r.term_id} cx={pad.left + slot * i + slot / 2} cy={y(r.cgpa)} r="3.5" className="cum-dot" />
          ),
        )}
      </svg>
    </div>
  )
}
