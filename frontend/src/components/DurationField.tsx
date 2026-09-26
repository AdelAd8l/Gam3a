import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'

import { durationLabel } from '../lib/format'
import { t } from '../lib/i18n'
import Icon from './Icon'

interface Props {
  /** The length in minutes. */
  minutes: number
  onChange: (minutes: number) => void
  min: number
  /** 12 hours at most. */
  max?: number
  label: string
}

const STEP = 5 // minutes
const PANEL_H = 264 // px

/** A length picked like a phone's time picker, without AM/PM: the field shows "1 h 30 min";
 * tapping it opens two columns, hours and minutes. Choices outside min..max are greyed out, and
 * picking an hour that would go out of range moves the minutes to the nearest allowed value. */
export default function DurationField({ minutes, onChange, min, max = 12 * 60, label }: Props) {
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<CSSProperties>({})
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const openedAt = useRef(0) // where the field was when the panel opened
  const id = useId()

  const hours = Array.from({ length: Math.floor(max / 60) + 1 }, (_, i) => i)
  // every 5 minutes, plus the current value if it was saved off that grid (e.g. 97 min)
  const mins = [...new Set([...Array.from({ length: 60 / STEP }, (_, i) => i * STEP), m])].sort((a, b) => a - b)
  const fits = (hh: number, mm: number) => hh * 60 + mm >= min && hh * 60 + mm <= max
  const clamp = (v: number) => Math.min(max, Math.max(min, v))

  function show() {
    const r = button.current!.getBoundingClientRect()
    openedAt.current = r.top
    const rtl = getComputedStyle(button.current!).direction === 'rtl'
    const below = window.innerHeight - r.bottom
    const up = below < PANEL_H + 12 && r.top > below
    const width = Math.max(r.width, 240)
    // Fixed to the screen, so a dialog's scrolling edge can't cut it off; kept inside the screen.
    const start = rtl ? Math.max(8, window.innerWidth - r.right) : Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    setPlace({
      width,
      ...(rtl ? { right: start } : { left: start }),
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    })
    setOpen(true)
  }

  function close(focus = true) {
    setOpen(false)
    if (focus) button.current?.focus()
  }

  // Close when tapping elsewhere, or when the page scrolls or resizes under the panel.
  useEffect(() => {
    if (!open) return
    const away = (e: Event) => {
      const target = e.target as Node
      if (!button.current?.contains(target) && !panel.current?.contains(target)) setOpen(false)
    }
    // A scroll event can arrive just after the tap (the end of a fling); only close once the
    // field has really moved away from where the panel was placed.
    const moved = (e: Event) => {
      if (panel.current?.contains(e.target as Node)) return
      const top = button.current?.getBoundingClientRect().top ?? 0
      if (Math.abs(top - openedAt.current) > 4) setOpen(false)
    }
    const shut = () => setOpen(false)
    document.addEventListener('pointerdown', away)
    window.addEventListener('scroll', moved, true)
    window.addEventListener('resize', shut)
    return () => {
      document.removeEventListener('pointerdown', away)
      window.removeEventListener('scroll', moved, true)
      window.removeEventListener('resize', shut)
    }
  }, [open])

  // Start with the chosen hour and minutes in view, and focus the chosen hour.
  useLayoutEffect(() => {
    if (!open) return
    panel.current?.querySelectorAll<HTMLElement>('[aria-pressed="true"]').forEach((el) => {
      const list = el.parentElement!
      list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2
    })
    panel.current?.querySelector<HTMLElement>('.duration-col [aria-pressed="true"]')?.focus({ preventScroll: true })
  }, [open])

  function onPanelKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault() // close the panel, not the dialog around it
      e.stopPropagation()
      close()
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const col = (e.target as HTMLElement).closest('.duration-col')
      const items = [...(col?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
      const i = items.indexOf(e.target as HTMLButtonElement)
      const next = items[i + (e.key === 'ArrowDown' ? 1 : -1)]
      if (next) {
        e.preventDefault()
        next.focus()
      }
    }
  }

  return (
    <div className="duration-field">
      <button
        ref={button}
        type="button"
        className="input duration-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        aria-label={`${label}: ${durationLabel(total)}`}
        onClick={() => (open ? close() : show())}
      >
        <span>{durationLabel(total)}</span>
        <Icon name="clock" size={17} />
      </button>
      {open && (
        <div
          ref={panel}
          id={`${id}-panel`}
          role="dialog"
          aria-label={label}
          className="duration-panel"
          style={place}
          onKeyDown={onPanelKey}
        >
          <div className="duration-col">
            <span className="duration-head">{t('duration.hours')}</span>
            <div className="duration-list">
              {hours.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={n === h}
                  disabled={!mins.some((mm) => fits(n, mm))}
                  onClick={() => onChange(clamp(n * 60 + m))}
                >
                  {t('time.h', { h: n })}
                </button>
              ))}
            </div>
          </div>
          <div className="duration-col">
            <span className="duration-head">{t('duration.minutes')}</span>
            <div className="duration-list">
              {mins.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={n === m}
                  disabled={!fits(h, n)}
                  onClick={() => onChange(clamp(h * 60 + n))}
                >
                  {t('time.m', { m: n })}
                </button>
              ))}
            </div>
          </div>
          <div className="duration-foot">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => close()}>
              {t('common.done')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
