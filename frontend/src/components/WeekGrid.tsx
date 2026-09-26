import type { Block, Course } from '../lib/api'
import { formatTime, fromMinutes, toMinutes, weekdayName } from '../lib/format'
import { t } from '../lib/i18n'
import { blockDetail } from '../lib/labels'
import { lanes } from '../lib/lanes'

interface Props {
  blocks: Block[]
  days: number[]
  restDays: number[]
  courses: Map<number, Course>
  today?: number
  onBlock?: (block: Block) => void
}

const HOUR = 48 // px per hour

/** The desktop timetable: one column per weekday, blocks positioned by time. */
export default function WeekGrid({ blocks, days, restDays, courses, today, onBlock }: Props) {
  const starts = blocks.map((b) => toMinutes(b.start))
  const ends = blocks.map((b) => toMinutes(b.end))
  const first = Math.floor(Math.min(8 * 60, ...starts) / 60) * 60
  const last = Math.ceil(Math.max(18 * 60, ...ends) / 60) * 60
  const hours = Array.from({ length: (last - first) / 60 }, (_, i) => first + i * 60)
  const px = (m: number) => ((m - first) / 60) * HOUR

  return (
    <div className="week" style={{ '--hours': hours.length, '--hour': `${HOUR}px` } as React.CSSProperties}>
      <div className="week-head">
        <span />
        {days.map((d) => (
          <span key={d} className={d === today ? 'is-today' : ''}>
            {weekdayName(d, 'short')}
          </span>
        ))}
      </div>
      <div className="week-body">
        <div className="week-hours">
          {hours.map((h) => (
            <span key={h} style={{ top: px(h) }}>
              {formatTime(fromMinutes(h))}
            </span>
          ))}
        </div>
        {days.map((d) => (
          <div key={d} className={`week-day${restDays.includes(d) ? ' is-rest' : ''}${d === today ? ' is-today' : ''}`}>
            {restDays.includes(d) && !blocks.some((b) => b.weekday === d) && (
              <span className="week-rest">{t('schedule.rest')}</span>
            )}
            {lanes(blocks.filter((b) => b.weekday === d)).map(({ block: b, lane, of }, i) => {
                const course = b.course_id ? courses.get(b.course_id) : undefined
                const top = px(toMinutes(b.start))
                const height = Math.max(18, px(toMinutes(b.end)) - top - 2)
                // Overlapping blocks (a clash) share the column side by side instead of hiding each other.
                const place: React.CSSProperties = of > 1 ? { insetInlineStart: `calc(${(lane / of) * 100}% + 3px)`, width: `calc(${100 / of}% - 6px)` } : {}
                return (
                  <button
                    key={`${b.kind}-${b.ref_id ?? i}-${b.start}`}
                    type="button"
                    className={`slot slot-${b.kind}${of > 1 ? ' is-clash' : ''}`}
                    style={{ top, height, ...place, '--c': course?.color ?? b.color ?? 'var(--ink-3)' } as React.CSSProperties}
                    onClick={() => onBlock?.(b)}
                    title={`${b.title} · ${formatTime(b.start)} – ${formatTime(b.end)}`}
                  >
                    {height >= 42 && <span className="slot-time num">{formatTime(b.start)}</span>}
                    <strong>{b.kind === 'study' ? `${t('block.study')} · ${b.title}` : b.title}</strong>
                    {height >= 70 && b.kind === 'class' && b.detail && <span>{blockDetail(b.detail)}</span>}
                    {height >= 42 ? (
                      <span className="slot-time slot-end num">{formatTime(b.end)}</span>
                    ) : (
                      height > 34 && (
                        <span className="num">
                          {formatTime(b.start)} – {formatTime(b.end)}
                        </span>
                      )
                    )}
                  </button>
                )
              })}
          </div>
        ))}
      </div>
    </div>
  )
}

