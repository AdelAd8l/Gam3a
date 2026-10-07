import { useEffect, useState } from 'react'

import type { Block, Course } from '../lib/api'
import { formatTime, toMinutes } from '../lib/format'
import { locale, t } from '../lib/i18n'
import { blockDetail } from '../lib/labels'

interface Props {
  /** The week's blocks (only classes are used). */
  blocks: Block[]
  courses: Map<number, Course>
  /** Last day of the term (YYYY-MM-DD): no "next class" after it. */
  termEnd: string
  onOpen?: (block: Block) => void
}

const DAY = 86_400_000

/** "1:07:31", or "2 d 3 h" when it is more than a day away. */
function span(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86400)
  if (d >= 1) return t('countdown.days', { d, h: Math.floor((s % 86400) / 3600) })
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** A class's start and end on a given date, as local times. */
function at(date: Date, b: Block) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  return [day.getTime() + toMinutes(b.start) * 60_000, day.getTime() + toMinutes(b.end) * 60_000]
}

/** The class on now (with how long until it ends), or else the next one (with how long until it
 * starts), ticking every second. */
export default function ClassCountdown({ blocks, courses, termEnd, onOpen }: Props) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const classes = blocks.filter((b) => b.kind === 'class')
  const last = new Date(`${termEnd}T23:59:59`).getTime()
  let current: { b: Block; start: number; end: number } | null = null
  let next: { b: Block; start: number; end: number } | null = null
  // Look through today and the coming week, in time order.
  for (let i = 0; i < 8 && !current && !next; i++) {
    const date = new Date(now + i * DAY)
    if (date.getTime() > last && i > 0) break
    const weekday = (date.getDay() + 6) % 7
    const today = classes
      .filter((b) => b.weekday === weekday)
      .map((b) => {
        const [start, end] = at(date, b)
        return { b, start, end }
      })
      .sort((a, b) => a.start - b.start)
    current = today.find((c) => c.start <= now && now < c.end) ?? null
    if (!current) next = today.find((c) => c.start > now && c.start <= last) ?? null
  }
  const shown = current ?? next
  if (!shown) return null

  const course = shown.b.course_id ? courses.get(shown.b.course_id) : undefined
  const name = course ? course.code || course.name : shown.b.title
  const detail = shown.b.detail ? blockDetail(shown.b.detail) : ''
  const done = current ? (now - current.start) / (current.end - current.start) : 0
  const sameDay = new Date(shown.start).toDateString() === new Date(now).toDateString()
  const day = sameDay
    ? ''
    : new Date(shown.start).toDateString() === new Date(now + DAY).toDateString()
      ? `${t('today.tomorrow')} · `
      : `${new Date(shown.start).toLocaleDateString(locale(), { weekday: 'long' })} · `

  return (
    <button
      type="button"
      className={`countdown${current ? ' is-on' : ''}`}
      style={{ '--c': course?.color ?? 'var(--accent)' } as React.CSSProperties}
      onClick={() => onOpen?.(shown.b)}
    >
      <span className="countdown-label">{current ? t('countdown.now') : t('countdown.next')}</span>
      <span className="countdown-main">
        <strong>{name}</strong>
        {detail && <span className="faint"> · {detail}</span>}
      </span>
      <span className="countdown-time">
        <span className="faint">{current ? t('countdown.endsIn') : t('countdown.startsIn')}</span>
        <b className="num" dir="ltr">
          {span((current ? current.end : shown.start) - now)}
        </b>
      </span>
      <span className="countdown-when faint">
        {day}
        {formatTime(shown.b.start)} – {formatTime(shown.b.end)}
      </span>
      {current && (
        <span className="countdown-bar" aria-hidden="true">
          <span style={{ width: `${Math.min(100, done * 100)}%` }} />
        </span>
      )}
    </button>
  )
}
