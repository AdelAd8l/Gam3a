// Small hand-drawn SVG charts (no chart library). Every chart has a readout that shows exact
// values for the touched/hovered point, and a "Show numbers" table, so no value depends on
// color or on hovering. In Arabic the charts are mirrored: time runs right to left and the
// value axis sits on the right.

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

import { compact, mirror, numClass, type Mirror } from '../lib/chart'
import { t } from '../lib/i18n'

// ---- shared helpers ---------------------------------------------------------------------

/** The element's width in CSS pixels, so charts draw at real size and text never scales. */
function useWidth(min = 260) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(min, Math.round(entry.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [min])
  return [ref, width] as const
}

/** Round axis bounds and 3–5 ticks covering lo..hi. */
function niceRange(lo: number, hi: number, integer: boolean) {
  if (hi === lo) hi = lo + (integer ? 1 : Math.max(1, Math.abs(lo) * 0.1))
  const raw = (hi - lo) / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
  if (integer) step = Math.max(1, Math.round(step))
  const bottom = Math.floor(lo / step) * step
  const top = Math.ceil(hi / step) * step
  const ticks = Array.from({ length: Math.round((top - bottom) / step) + 1 }, (_, i) => bottom + i * step)
  return { bottom, top, ticks }
}

/** Which x labels to draw so none collide: walk from the newest (always kept) toward the oldest
 * and drop any label that would overlap the one kept after it. Widths are estimated from the
 * text length, which is close enough at 11–12px. */
function fitLabels(labels: string[], xOf: (i: number) => number, wanted: (i: number) => boolean = () => true) {
  const keep = new Set<number>()
  let edge = Infinity
  for (let i = labels.length - 1; i >= 0; i--) {
    if (!wanted(i)) continue
    const half = (labels[i].length * 6.4 + 10) / 2
    if (xOf(i) + half <= edge) {
      keep.add(i)
      edge = xOf(i) - half
    }
  }
  return keep
}

/** A column path with a 4px rounded top and a square base. */
function column(x: number, y: number, w: number, h: number, round: boolean) {
  if (h <= 0) return ''
  const r = round ? Math.min(4, w / 2, h) : 0
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

/** Arrow keys move the focused point along time, whichever way time runs on screen. */
function keyStep(e: KeyboardEvent, rtl: boolean, index: number, count: number, set: (i: number) => void) {
  const next = e.key === 'ArrowRight' ? (rtl ? -1 : 1) : e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0
  if (!next) return
  e.preventDefault()
  set(Math.min(count - 1, Math.max(0, index + next)))
}

export interface ReadoutItem {
  label: string
  value: string
  color?: string
  /** "line" keys a line series; the default box keys bars and segments. */
  key?: 'line' | 'box'
  muted?: boolean
}

/** The values at the focused point: value first, name after (the reader has the name). */
export function Readout({ title, items }: { title: string; items: ReadoutItem[] }) {
  return (
    <div className="chart-readout" aria-live="polite">
      <span className="faint">{title}</span>
      {items.map((it) => (
        <span key={it.label} className={it.muted ? 'is-muted' : undefined}>
          {it.color && <i className={`chart-key chart-key-${it.key ?? 'box'}`} style={{ background: it.color }} />}
          <b className={numClass(it.value)}>{it.value}</b> {it.label}
        </span>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string; key?: 'line' | 'box' }[] }) {
  return (
    <ul className="chart-legend">
      {items.map((it) => (
        <li key={it.label}>
          <i className={`chart-key chart-key-${it.key ?? 'box'}`} style={{ background: it.color }} />
          {it.label}
        </li>
      ))}
    </ul>
  )
}

/** The chart as a table: the accessible twin, and the way to read every exact number. */
export function NumbersTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <details className="chart-table">
      <summary>{t('reports.showNumbers')}</summary>
      <div className="chart-table-scroll">
        <table>
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={i} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) =>
                  j === 0 ? (
                    <th key={j} scope="row">
                      {cell}
                    </th>
                  ) : (
                    <td key={j} className="num">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

// value axis on the start side, a little room on the end side
const PAD = { top: 14, end: 12, bottom: 28, start: 50 }

interface AxisProps {
  W: number
  ticks: number[]
  y: (v: number) => number
  tick: (v: number) => string
  m: Mirror
  start: number
}

function ValueAxis({ W, ticks, y, tick, m, start }: AxisProps) {
  return (
    <>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={m.x(start)} x2={m.x(W - PAD.end)} y1={y(v)} y2={y(v)} className={v === 0 ? 'axis' : 'grid'} />
          <text x={m.x(start - 8)} y={y(v)} dy="0.32em" textAnchor={m.anchor('end')} className="tick">
            {m.text(tick(v))}
          </text>
        </g>
      ))}
    </>
  )
}

// ---- line chart ---------------------------------------------------------------------------

export interface LineSeries {
  label: string
  color: string
  values: (number | null)[]
  /** Drawn quieter, as context for the main line. */
  muted?: boolean
}

interface LineProps {
  series: LineSeries[]
  xLabel: (i: number) => string
  /** Which x positions may get an axis label (colliding ones are skipped anyway). */
  xTick?: (i: number) => boolean
  format: (v: number) => string
  tick?: (v: number) => string
  title: (i: number) => string
  initial: number
  zero?: boolean
  integer?: boolean
  /** A fixed value range, e.g. 0..4 for a GPA. */
  domain?: [number, number]
  markers?: boolean
  ariaLabel: string
  height?: number
  axisWidth?: number
}

/** Lines over a shared x; a crosshair snaps to the nearest position and the readout lists every
 * series there. */
export function LineChart(props: LineProps) {
  const { series, xLabel, xTick, format, tick = compact, title, initial, zero, integer = false, domain, markers, ariaLabel } = props
  const height = props.height ?? 200
  const start = props.axisWidth ?? PAD.start
  const [box, W] = useWidth()
  const m = mirror(W)
  const [hover, setHover] = useState<number | null>(null)
  const count = Math.max(1, ...series.map((s) => s.values.length))
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null))
  const lo = domain ? domain[0] : all.length ? Math.min(zero ? 0 : Infinity, ...all) : 0
  const hi = domain ? domain[1] : all.length ? Math.max(zero ? 0 : -Infinity, ...all) : 0
  const { bottom, top, ticks } = niceRange(lo, hi, integer)
  const innerW = W - start - PAD.end
  const innerH = height - PAD.top - PAD.bottom
  const lx = (i: number) => start + (count <= 1 ? innerW / 2 : (i / (count - 1)) * innerW) // logical x
  const x = (i: number) => m.x(lx(i))
  const y = (v: number) => PAD.top + innerH - ((v - bottom) / (top - bottom || 1)) * innerH
  const at = Math.min(count - 1, hover ?? initial)
  const shown = fitLabels(Array.from({ length: count }, (_, i) => xLabel(i)), lx, xTick)

  const move = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    let f = (e.clientX - r.left) / r.width
    if (m.rtl) f = 1 - f
    setHover(Math.min(count - 1, Math.max(0, count <= 1 ? 0 : Math.round(f * (count - 1)))))
  }

  return (
    <div className="chart" ref={box}>
      <Readout
        title={title(at)}
        items={series.map((s) => ({
          label: s.label,
          value: s.values[at] === null || s.values[at] === undefined ? '—' : format(s.values[at]!),
          color: s.color,
          key: 'line',
          muted: s.muted,
        }))}
      />
      <svg
        height={height}
        viewBox={`0 0 ${W} ${height}`}
        className="chart-svg"
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={(e) => keyStep(e, m.rtl, at, count, setHover)}
      >
        <ValueAxis W={W} ticks={ticks} y={y} tick={tick} m={m} start={start} />
        {Array.from({ length: count }, (_, i) =>
          shown.has(i) ? (
            <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className={`tick tick-x${i === at ? ' is-active' : ''}`}>
              {m.text(xLabel(i))}
            </text>
          ) : null,
        )}
        <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={PAD.top + innerH} className="crosshair" />
        {[...series].reverse().map((s) => {
          let d = ''
          s.values.forEach((v, i) => {
            if (v === null) return
            d += `${i === 0 || s.values[i - 1] === null ? 'M' : 'L'}${x(i)},${y(v)}`
          })
          return (
            <g key={s.label} className={s.muted ? 'series is-muted' : 'series'}>
              <path d={d} className="line" style={{ stroke: s.color }} />
              {markers &&
                s.values.map((v, i) =>
                  v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={3} className="dot" style={{ fill: s.color }} />,
                )}
              {s.values[at] !== null && s.values[at] !== undefined && (
                <circle cx={x(at)} cy={y(s.values[at]!)} r={4.5} className="marker" style={{ fill: s.color }} />
              )}
            </g>
          )
        })}
        <rect
          x={m.box(start - 10, innerW + 20)}
          y={PAD.top}
          width={innerW + 20}
          height={innerH}
          className="hit"
          onPointerMove={move}
          onPointerDown={move}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
        />
      </svg>
    </div>
  )
}

// ---- columns (stacked or single) ---------------------------------------------------------

export interface Stack {
  label: string
  color: string
}

interface ColumnsProps {
  labels: string[]
  /** values[x][stack] */
  values: number[][]
  stacks: Stack[]
  format: (v: number) => string
  tick?: (v: number) => string
  title: (i: number) => string
  initial: number
  integer?: boolean
  /** Put the value above this column (the one the story is about). */
  labelAt?: number
  ariaLabel: string
  height?: number
  axisWidth?: number
}

/** Columns from one baseline; with several stacks, segments sit on each other with a 2px gap. */
export function Columns(props: ColumnsProps) {
  const { labels, values, stacks, format, tick = compact, title, initial, integer = false, labelAt, ariaLabel } = props
  const height = props.height ?? 220
  const start = props.axisWidth ?? PAD.start
  const [box, W] = useWidth()
  const m = mirror(W)
  const [hover, setHover] = useState<number | null>(null)
  const totals = values.map((col) => col.reduce((a, b) => a + b, 0))
  const { top, ticks } = niceRange(0, Math.max(integer ? 1 : 0, ...totals), integer)
  const innerW = W - start - PAD.end
  const innerH = height - PAD.top - PAD.bottom
  const slot = innerW / Math.max(1, labels.length)
  const bar = Math.min(24, slot * 0.56)
  const y = (v: number) => PAD.top + innerH - (v / (top || 1)) * innerH
  const at = Math.min(labels.length - 1, hover ?? initial)
  const GAP = 2
  const center = (i: number) => start + slot * i + slot / 2 // logical
  const shown = fitLabels(labels, center)

  const items: ReadoutItem[] =
    stacks.length === 1
      ? [{ label: stacks[0].label, value: format(totals[at] ?? 0) }]
      : [
          ...stacks
            .map((s, k) => ({ label: s.label, value: values[at]?.[k] ?? 0, color: s.color }))
            .filter((it) => it.value > 0)
            .sort((a, b) => b.value - a.value)
            .map((it) => ({ ...it, value: format(it.value) })),
          { label: t('reports.total'), value: format(totals[at] ?? 0) },
        ]

  return (
    <div className="chart" ref={box}>
      <Readout title={title(at)} items={items} />
      <svg
        height={height}
        viewBox={`0 0 ${W} ${height}`}
        className="chart-svg"
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={(e) => keyStep(e, m.rtl, at, labels.length, setHover)}
      >
        <ValueAxis W={W} ticks={ticks} y={y} tick={tick} m={m} start={start} />
        {values.map((col, i) => {
          const cx = m.x(center(i))
          let base = PAD.top + innerH
          const last = col.reduce((found, v, k) => (v > 0 ? k : found), -1)
          return (
            <g key={labels[i] + i} className={i === at ? 'col is-active' : 'col'}>
              {col.map((v, k) => {
                if (v <= 0) return null
                const h = (v / (top || 1)) * innerH
                const segTop = base - h
                // the gap comes off each segment's top, so the stack still reaches its total
                const d = column(cx - bar / 2, segTop + (k === last ? 0 : GAP), bar, h - (k === last ? 0 : GAP), k === last)
                base = segTop
                return <path key={k} d={d} style={{ fill: stacks.length === 1 ? undefined : stacks[k].color }} className="seg" />
              })}
              {shown.has(i) && (
                <text x={cx} y={height - 8} textAnchor="middle" className={`tick tick-x${i === at ? ' is-active' : ''}`}>
                  {m.text(labels[i])}
                </text>
              )}
              {labelAt === i && totals[i] > 0 && (
                <text x={cx} y={y(totals[i]) - 6} textAnchor="middle" className="value-label">
                  {m.text(format(totals[i]))}
                </text>
              )}
              <rect
                x={m.box(start + slot * i, slot)}
                y={PAD.top}
                width={slot}
                height={innerH}
                className="hit"
                onPointerEnter={() => setHover(i)}
                onPointerDown={() => setHover(i)}
                onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
              />
            </g>
          )
        })}
      </svg>
      {stacks.length > 1 && <Legend items={stacks} />}
    </div>
  )
}
