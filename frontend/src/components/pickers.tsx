// Drop-downs, dates and times in the app's own look (instead of the browser's grey/white pop-ups).
//
// - <Select>     replaces <select>. Same <option> children, onChange gets { target: { value } }.
// - <DateField>  replaces <input type="date">. Value is "YYYY-MM-DD" (or "").
// - <TimeField>  replaces <input type="time">. Value is 24-hour "HH:MM" (or ""), shown as 10:30 AM / PM.
//
// On a computer the choices open in a small panel under the field; on a phone they open as a sheet from
// the bottom. Everything follows the app language (English / Arabic, left-to-right / right-to-left).
// The panel is placed inside the open <dialog> (if any), because a dialog covers the rest of the page.

import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

import { locale, t, useLang } from '../lib/i18n'

// ---- the floating panel ----------------------------------------------------------------

function usePanel() {
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<CSSProperties | null>(null)
  const [host, setHost] = useState<Element | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  const hide = useCallback((refocus = true) => {
    setOpen(false)
    setPlace(null)
    if (refocus) trigger.current?.focus({ preventScroll: true })
  }, [])

  // Measure first (hidden), then put the panel under the field, or above it when there is no room.
  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return
    const r = trigger.current.getBoundingClientRect()
    const h = panel.current.offsetHeight
    const w = panel.current.offsetWidth
    const pad = 8
    const rtl = document.documentElement.dir === 'rtl'
    let left = rtl ? r.right - w : r.left
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad))
    const fitsBelow = r.bottom + 4 + h <= window.innerHeight - pad
    const fitsAbove = r.top - 4 - h >= pad
    if (fitsBelow || !fitsAbove) {
      setPlace({ left, top: Math.max(pad, Math.min(r.bottom + 4, window.innerHeight - h - pad)), minWidth: r.width })
    } else {
      setPlace({ left, bottom: window.innerHeight - r.top + 4, minWidth: r.width })
    }
  }, [open])

  // Once shown: focus inside it, and close on outside click / scroll / resize / Esc.
  useEffect(() => {
    if (!place) return
    ;(panel.current?.querySelector<HTMLElement>('[data-focus]') ?? panel.current)?.focus({ preventScroll: true })
  }, [place])

  useEffect(() => {
    if (!open) return
    const inside = (n: EventTarget | null) => !!panel.current?.contains(n as Node)
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target) && !trigger.current?.contains(e.target as Node)) hide(false)
    }
    const typing = () => inside(document.activeElement) && document.activeElement?.tagName === 'INPUT'
    // On a phone the panel is a sheet over a dimmed page: scrolling or the browser bars moving must not close it.
    const sheet = window.matchMedia('(max-width: 640px)').matches
    const width = window.innerWidth
    const onScroll = (e: Event) => {
      if (!sheet && !inside(e.target) && !typing()) hide(false)
    }
    const onResize = () => {
      if (window.innerWidth !== width && !typing()) hide(false)
    }
    const dialog = trigger.current?.closest('dialog')
    const onCancel = (e: Event) => {
      e.preventDefault() // Esc closes the panel, not the dialog behind it
      hide()
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    dialog?.addEventListener('cancel', onCancel)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      dialog?.removeEventListener('cancel', onCancel)
    }
  }, [open, hide])

  const render = (title: string, className: string, body: ReactNode, onKey?: (e: KeyboardEvent) => void) => {
    if (!open) return null
    if (!host) return null
    return createPortal(
      <>
        <div className="pk-scrim" onClick={() => hide()} />
        <div
          ref={panel}
          className={`pk-panel ${className}`}
          tabIndex={-1}
          style={place ?? { visibility: 'hidden', top: 0, left: 0 }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              hide()
            } else if (e.key === 'Tab') hide(false)
            else onKey?.(e)
          }}
        >
          <div className="pk-sheet-head">
            <strong>{title}</strong>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => hide()}>
              {t('picker.close')}
            </button>
          </div>
          {body}
        </div>
      </>,
      host,
    )
  }

  const show = () => {
    setHost(trigger.current?.closest('dialog') ?? document.body)
    setOpen(true)
  }

  return { open, show, hide, trigger, panel, render }
}

/** Lets the browser's own "please fill this in" message work for a button-based field. */
function Required({ on, value }: { on?: boolean; value: string }) {
  if (!on) return null
  return <input className="pk-req" tabIndex={-1} aria-hidden="true" required value={value} onChange={() => {}} />
}

const Chevron = () => (
  <svg className="pk-chev" width="10" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="m1 1 4 4 4-4" />
  </svg>
)
const CalendarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 5h18v16H3zM3 10h18M8 3v4M16 3v4" />
  </svg>
)
const ClockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />
  </svg>
)
const Tick = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)
const Arrow = ({ dir }: { dir: 'prev' | 'next' }) => (
  <svg className="pk-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={dir === 'prev' ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'} />
  </svg>
)

// ---- Select ------------------------------------------------------------------------------

interface Opt {
  value: string
  label: string
  disabled?: boolean
  group?: string
}

function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement(c) ? text((c.props as { children?: ReactNode }).children) : ''))
    .join('')
}

function readOptions(children: ReactNode, group?: string): Opt[] {
  const out: Opt[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const el = child as ReactElement<{ value?: string | number; disabled?: boolean; label?: string; children?: ReactNode }>
    if (el.type === 'option') {
      const label = text(el.props.children)
      out.push({ value: String(el.props.value ?? label), label, disabled: el.props.disabled, group })
    } else if (el.type === 'optgroup') {
      out.push(...readOptions(el.props.children, el.props.label))
    } else if (el.type === Fragment) {
      out.push(...readOptions(el.props.children, group))
    }
  })
  return out
}

interface SelectProps {
  value: string | number
  onChange: (e: { target: { value: string } }) => void
  children: ReactNode
  className?: string
  disabled?: boolean
  required?: boolean
  id?: string
  title?: string
  'aria-label'?: string
}

export function Select({ value, onChange, children, className = 'select', disabled, required, id, title, ...rest }: SelectProps) {
  useLang()
  const p = usePanel()
  const options = readOptions(children)
  const current = options.find((o) => o.value === String(value))
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const typed = useRef({ text: '', at: 0 })
  const searchable = options.length > 12
  const q = query.trim().toLowerCase()
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options

  const openPanel = () => {
    setQuery('')
    setActive(Math.max(0, options.findIndex((o) => o.value === String(value))))
    p.show()
  }
  const choose = (o?: Opt) => {
    if (!o || o.disabled) return
    onChange({ target: { value: o.value } })
    p.hide()
  }
  const move = (from: number, step: 1 | -1) => {
    for (let i = from + step; i >= 0 && i < shown.length; i += step) if (!shown[i].disabled) return i
    return from
  }

  useEffect(() => {
    if (p.open) p.panel.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [p.open, active, p.panel])

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((a) => move(a, 1))
    else if (e.key === 'ArrowUp') setActive((a) => move(a, -1))
    else if (e.key === 'Home') setActive(move(-1, 1))
    else if (e.key === 'End') setActive(move(shown.length, -1))
    else if (e.key === 'Enter') choose(shown[active])
    else if (!searchable && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const now = e.timeStamp
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now }
      const hit = shown.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text))
      if (hit >= 0) setActive(hit)
      return
    } else return
    e.preventDefault()
  }

  const startsGroup = shown.map((o, i) => !!o.group && (i === 0 || shown[i - 1].group !== o.group))
  return (
    <div className="pk">
      <button
        type="button"
        id={id}
        ref={p.trigger}
        className={`${className} pk-trigger`}
        disabled={disabled}
        title={title}
        aria-label={rest['aria-label']}
        aria-haspopup="listbox"
        aria-expanded={p.open}
        data-empty={current ? undefined : ''}
        onClick={() => (p.open ? p.hide() : openPanel())}
        onKeyDown={(e) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
            e.preventDefault()
            openPanel()
          }
        }}
      >
        <span className="pk-value">{current?.label ?? ''}</span>
      </button>
      <Required on={required} value={current && current.value !== '' ? current.value : ''} />
      {p.render(
        rest['aria-label'] ?? '',
        'pk-select',
        <>
          {searchable && (
            <input
              data-focus
              className="input pk-search"
              placeholder={t('picker.search')}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
            />
          )}
          <div className="pk-list" role="listbox" tabIndex={searchable ? -1 : 0} data-focus={searchable ? undefined : ''}>
            {shown.map((o, i) => {
              const header = startsGroup[i] ? <div className="pk-group">{o.group}</div> : null
              return (
                <Fragment key={`${o.value}-${i}`}>
                  {header}
                  <div
                    role="option"
                    aria-selected={o.value === String(value)}
                    aria-disabled={o.disabled}
                    data-active={i === active}
                    className="pk-opt"
                    onMouseMove={() => i !== active && !o.disabled && setActive(i)}
                    onClick={() => choose(o)}
                  >
                    <span>{o.label}</span>
                    {o.value === String(value) && <Tick />}
                  </div>
                </Fragment>
              )
            })}
            {shown.length === 0 && <div className="pk-none">{t('picker.noMatch')}</div>}
          </div>
        </>,
        onKey,
      )}
    </div>
  )
}

// ---- DateField ---------------------------------------------------------------------------

const p2 = (n: number) => String(n).padStart(2, '0')
const isoOf = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${p2(m + 1)}-${p2(d)}`
const todayISO = () => {
  const n = new Date()
  return isoOf(n.getFullYear(), n.getMonth(), n.getDate())
}
const split = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return { y, m: m - 1, d }
}
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
const MIN_YEAR = 1000
const MAX_YEAR = 9999
const ROW = 34

interface DateProps {
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  required?: boolean
  disabled?: boolean
  className?: string
  id?: string
  /** First day of the week, 0 = Monday … 6 = Sunday (as the API counts). Default: Saturday in Arabic, Sunday in English. */
  weekStart?: number
  'aria-label'?: string
}

export function DateField({ value, onChange, min, max, required, disabled, className = 'input', id, weekStart, ...rest }: DateProps) {
  const lang = useLang()
  const p = usePanel()
  const has = validDate(value)
  const base = has ? split(value) : split(todayISO())
  const [view, setView] = useState({ y: base.y, m: base.m })
  const [mode, setMode] = useState<'days' | 'pick'>('days')
  const [pickYear, setPickYear] = useState(base.y)
  const [yearText, setYearText] = useState(String(base.y))
  const [range, setRange] = useState({ from: base.y - 30, to: base.y + 30 })
  const [focusISO, setFocusISO] = useState(has ? value : todayISO())
  const yearsRef = useRef<HTMLDivElement>(null)
  const grew = useRef(0)
  const loc = locale()

  const jsStart = weekStart === undefined ? (lang === 'ar' ? 6 : 0) : (weekStart + 1) % 7
  const out = (iso: string) => (!!min && iso < min) || (!!max && iso > max)

  const openPanel = () => {
    const d = has ? split(value) : split(todayISO())
    setView({ y: d.y, m: d.m })
    setPickYear(d.y)
    setYearText(String(d.y))
    setRange({ from: Math.max(MIN_YEAR, d.y - 30), to: Math.min(MAX_YEAR, d.y + 30) })
    setFocusISO(has ? value : todayISO())
    setMode('days')
    p.show()
  }
  const pick = (iso: string) => {
    if (out(iso)) return
    onChange(iso)
    p.hide()
  }

  // arrow keys move through the days
  useEffect(() => {
    if (p.open && mode === 'days') p.panel.current?.querySelector<HTMLElement>(`[data-iso="${focusISO}"]`)?.focus({ preventScroll: true })
  }, [p.open, mode, focusISO, view, p.panel])

  // year list: centre the chosen year, and add more years when the end is near
  useLayoutEffect(() => {
    const list = yearsRef.current
    if (!list || mode !== 'pick') return
    if (grew.current) {
      list.scrollTop += grew.current * ROW
      grew.current = 0
    } else {
      list.scrollTop = (pickYear - range.from) * ROW - list.clientHeight / 2 + ROW / 2
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, range.from, pickYear])

  const moveFocus = (days: number) => {
    const d = split(focusISO)
    const n = new Date(d.y, d.m, d.d + days)
    if (n.getFullYear() < MIN_YEAR || n.getFullYear() > MAX_YEAR) return
    setFocusISO(isoOf(n.getFullYear(), n.getMonth(), n.getDate()))
    setView({ y: n.getFullYear(), m: n.getMonth() })
  }
  const onKey = (e: KeyboardEvent) => {
    if (mode !== 'days' || (e.target as HTMLElement).tagName === 'INPUT') return
    const step = { ArrowLeft: lang === 'ar' ? 1 : -1, ArrowRight: lang === 'ar' ? -1 : 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (step !== undefined) moveFocus(step)
    else if (e.key === 'PageUp' || e.key === 'PageDown') {
      const d = split(focusISO)
      const n = new Date(d.y, d.m + (e.key === 'PageUp' ? -1 : 1), 1)
      const last = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate()
      const next = isoOf(n.getFullYear(), n.getMonth(), Math.min(d.d, last))
      setFocusISO(next)
      setView({ y: n.getFullYear(), m: n.getMonth() })
    } else return
    e.preventDefault()
  }

  const first = (new Date(view.y, view.m, 1).getDay() - jsStart + 7) % 7
  const cells = Array.from({ length: 42 }, (_, i) => {
    const n = new Date(view.y, view.m, i - first + 1)
    return { iso: isoOf(n.getFullYear(), n.getMonth(), n.getDate()), day: n.getDate(), inMonth: n.getMonth() === view.m }
  })
  const heads = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(2024, 0, 7 + ((jsStart + i) % 7))
    return lang === 'ar' ? dt.toLocaleDateString(loc, { weekday: 'narrow' }) : dt.toLocaleDateString(loc, { weekday: 'short' }).slice(0, 2)
  })
  const stepMonth = (by: number) => {
    const n = new Date(view.y, view.m + by, 1)
    if (n.getFullYear() < MIN_YEAR || n.getFullYear() > MAX_YEAR) return
    setView({ y: n.getFullYear(), m: n.getMonth() })
  }
  const today = todayISO()
  const title = new Date(view.y, view.m, 1).toLocaleDateString(loc, { month: 'long', year: 'numeric' })
  const label = has ? new Date(base.y, base.m, base.d).toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric' }) : ''

  const years: number[] = []
  for (let y = range.from; y <= range.to; y++) years.push(y)
  const commitYear = () => {
    const y = Number(yearText)
    if (Number.isInteger(y) && y >= MIN_YEAR && y <= MAX_YEAR) {
      setRange({ from: Math.max(MIN_YEAR, y - 30), to: Math.min(MAX_YEAR, y + 30) })
      setPickYear(y)
    } else setYearText(String(pickYear))
  }

  const body =
    mode === 'days' ? (
      <>
        <div className="pk-cal-head">
          <button type="button" className="pk-nav" aria-label={t('picker.prevMonth')} onClick={() => stepMonth(-1)}>
            <Arrow dir="prev" />
          </button>
          <button type="button" className="pk-title" onClick={() => { setPickYear(view.y); setYearText(String(view.y)); setRange({ from: Math.max(MIN_YEAR, view.y - 30), to: Math.min(MAX_YEAR, view.y + 30) }); setMode('pick') }}>
            {title} <Chevron />
          </button>
          <button type="button" className="pk-nav" aria-label={t('picker.nextMonth')} onClick={() => stepMonth(1)}>
            <Arrow dir="next" />
          </button>
        </div>
        <div className="pk-grid" role="grid">
          {heads.map((h, i) => (
            <span key={i} className="pk-dow">
              {h}
            </span>
          ))}
          {cells.map((c) => (
            <button
              key={c.iso}
              type="button"
              role="gridcell"
              data-iso={c.iso}
              tabIndex={c.iso === focusISO ? 0 : -1}
              className={`pk-day${c.inMonth ? '' : ' pk-faded'}${c.iso === today ? ' pk-today' : ''}${c.iso === value ? ' pk-selected' : ''}`}
              disabled={out(c.iso)}
              aria-selected={c.iso === value}
              onClick={() => pick(c.iso)}
            >
              {c.day}
            </button>
          ))}
        </div>
        <div className="pk-foot">
          {!required && has ? (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => { onChange(''); p.hide() }}>
              {t('picker.clear')}
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="btn btn-quiet btn-sm" disabled={out(today)} onClick={() => pick(today)}>
            {t('picker.today')}
          </button>
        </div>
      </>
    ) : (
      <>
        <div className="pk-cal-head">
          <button type="button" className="pk-title pk-title-back" data-focus onClick={() => setMode('days')}>
            <Arrow dir="prev" /> {t('picker.back')}
          </button>
          <input
            className="input pk-year-input"
            type="number"
            inputMode="numeric"
            min={MIN_YEAR}
            max={MAX_YEAR}
            aria-label={t('picker.year')}
            value={yearText}
            onChange={(e) => setYearText(e.target.value)}
            onBlur={commitYear}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commitYear())}
          />
        </div>
        <div className="pk-pick">
          <div
            className="pk-years"
            ref={yearsRef}
            onScroll={(e) => {
              const el = e.currentTarget
              if (el.scrollTop < ROW * 3 && range.from > MIN_YEAR) {
                const from = Math.max(MIN_YEAR, range.from - 30)
                grew.current = range.from - from
                setRange({ ...range, from })
              } else if (el.scrollHeight - el.scrollTop - el.clientHeight < ROW * 3 && range.to < MAX_YEAR) {
                setRange({ ...range, to: Math.min(MAX_YEAR, range.to + 30) })
              }
            }}
          >
            {years.map((y) => (
              <button
                key={y}
                type="button"
                className={`pk-year${y === pickYear ? ' pk-on' : ''}`}
                onClick={() => {
                  setPickYear(y)
                  setYearText(String(y))
                }}
              >
                {y}
              </button>
            ))}
          </div>
          <div className="pk-months">
            {Array.from({ length: 12 }, (_, m) => {
              const startIso = isoOf(pickYear, m, 1)
              const endIso = isoOf(pickYear, m, new Date(pickYear, m + 1, 0).getDate())
              const blocked = (!!min && endIso < min) || (!!max && startIso > max)
              return (
                <button
                  key={m}
                  type="button"
                  disabled={blocked}
                  className={`pk-month${pickYear === view.y && m === view.m ? ' pk-on' : ''}`}
                  onClick={() => {
                    setView({ y: pickYear, m })
                    setFocusISO(isoOf(pickYear, m, 1))
                    setMode('days')
                  }}
                >
                  {new Date(2024, m, 1).toLocaleDateString(loc, { month: 'short' })}
                </button>
              )
            })}
          </div>
        </div>
      </>
    )

  return (
    <div className="pk">
      <button
        type="button"
        id={id}
        ref={p.trigger}
        className={`${className} pk-trigger`}
        disabled={disabled}
        aria-label={rest['aria-label']}
        aria-haspopup="dialog"
        aria-expanded={p.open}
        data-empty={has ? undefined : ''}
        onClick={() => (p.open ? p.hide() : openPanel())}
      >
        <span className="pk-value">{has ? label : t('picker.pickDate')}</span>
        <CalendarIcon />
      </button>
      <Required on={required} value={has ? value : ''} />
      {p.render(rest['aria-label'] ?? t('picker.pickDate'), 'pk-date', body, onKey)}
    </div>
  )
}

// ---- TimeField ---------------------------------------------------------------------------

interface TimeProps {
  value: string
  onChange: (value: string) => void
  required?: boolean
  disabled?: boolean
  className?: string
  id?: string
  'aria-label'?: string
}

const validTime = (s: string) => /^\d{2}:\d{2}$/.test(s)

export function TimeField({ value, onChange, required, disabled, className = 'input', id, ...rest }: TimeProps) {
  useLang()
  const p = usePanel()
  const has = validTime(value)
  const h24 = has ? Number(value.slice(0, 2)) : -1
  const min = has ? Number(value.slice(3, 5)) : -1
  const hour12 = has ? h24 % 12 || 12 : 0
  const pm = has ? h24 >= 12 : false
  const hoursRef = useRef<HTMLDivElement>(null)
  const minsRef = useRef<HTMLDivElement>(null)

  const set = (h: number, m: number, isPm: boolean) => onChange(`${p2((h % 12) + (isPm ? 12 : 0))}:${p2(m)}`)
  const label = has ? new Date(2024, 0, 1, h24, min).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', hour12: true }) : ''

  // bring the chosen hour and minute into view when the panel opens
  useLayoutEffect(() => {
    if (!p.open) return
    for (const [ref, index] of [[hoursRef, hour12 - 1], [minsRef, min]] as const) {
      const el = ref.current
      if (el && index >= 0) el.scrollTop = index * ROW - el.clientHeight / 2 + ROW / 2
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open])

  const body = (
    <>
      <div className="pk-time">
        <div className="pk-col" ref={hoursRef} role="listbox" aria-label={t('picker.hour')}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
            <button key={h} type="button" data-focus={h === hour12 || (!has && h === 12) ? '' : undefined} className={`pk-cell${h === hour12 ? ' pk-on' : ''}`} onClick={() => set(h, has ? min : 0, pm)}>
              {h}
            </button>
          ))}
        </div>
        <span className="pk-colon">:</span>
        <div className="pk-col" ref={minsRef} role="listbox" aria-label={t('picker.minute')}>
          {Array.from({ length: 60 }, (_, i) => i).map((m) => (
            <button key={m} type="button" className={`pk-cell${m === min ? ' pk-on' : ''}`} onClick={() => set(has ? hour12 : 12, m, pm)}>
              {p2(m)}
            </button>
          ))}
        </div>
        <div className="pk-ampm" role="listbox" aria-label="AM / PM">
          <button type="button" className={`pk-cell${has && !pm ? ' pk-on' : ''}`} onClick={() => set(has ? hour12 : 12, has ? min : 0, false)}>
            {t('picker.am')}
          </button>
          <button type="button" className={`pk-cell${has && pm ? ' pk-on' : ''}`} onClick={() => set(has ? hour12 : 12, has ? min : 0, true)}>
            {t('picker.pm')}
          </button>
        </div>
      </div>
      <div className="pk-foot">
        {!required && has ? (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => { onChange(''); p.hide() }}>
            {t('picker.clear')}
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="btn btn-primary btn-sm" onClick={() => p.hide()}>
          {t('picker.done')}
        </button>
      </div>
    </>
  )

  return (
    <div className="pk">
      <button
        type="button"
        id={id}
        ref={p.trigger}
        className={`${className} pk-trigger`}
        disabled={disabled}
        aria-label={rest['aria-label']}
        aria-haspopup="dialog"
        aria-expanded={p.open}
        data-empty={has ? undefined : ''}
        onClick={() => (p.open ? p.hide() : p.show())}
      >
        <span className="pk-value">{has ? label : t('picker.pickTime')}</span>
        <ClockIcon />
      </button>
      <Required on={required} value={has ? value : ''} />
      {p.render(rest['aria-label'] ?? t('picker.pickTime'), 'pk-timepanel', body)}
    </div>
  )
}
