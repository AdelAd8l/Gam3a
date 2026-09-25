import type { Block, Course } from '../lib/api'
import { formatTime, toMinutes } from '../lib/format'
import { t } from '../lib/i18n'
import { blockDetail } from '../lib/labels'

interface Props {
  blocks: Block[]
  courses: Map<number, Course>
  /** Minutes since midnight to draw a "now" line, when showing today. */
  now?: number
  onBlock?: (block: Block) => void
}

/** One day as a list: time on the side, a colored card per block. */
export default function Agenda({ blocks, courses, now, onBlock }: Props) {
  const nowIndex = now === undefined ? -1 : blocks.findIndex((b) => toMinutes(b.end) > now)
  return (
    <ol className="agenda">
      {blocks.map((b, i) => {
        const course = b.course_id ? courses.get(b.course_id) : undefined
        const live = now !== undefined && toMinutes(b.start) <= now && now < toMinutes(b.end)
        const past = now !== undefined && toMinutes(b.end) <= now
        return (
          <li key={`${b.kind}-${b.ref_id ?? i}-${b.start}`}>
            {i === nowIndex && !live && <div className="agenda-now">{t('today.now')}</div>}
            <button
              type="button"
              className={`agenda-item agenda-${b.kind}${live ? ' is-live' : ''}${past ? ' is-past' : ''}`}
              style={{ '--c': course?.color ?? 'var(--ink-3)' } as React.CSSProperties}
              onClick={() => onBlock?.(b)}
            >
              <span className="agenda-body">
                <span className="agenda-time num">{formatTime(b.start)}</span>
                <strong>
                  {b.kind === 'study' ? `${t('block.study')} · ` : ''}
                  {course && b.kind !== 'busy' ? course.name : b.title}
                </strong>
                <span className="faint">
                  {b.kind === 'class' ? [course?.code, blockDetail(b.detail)].filter(Boolean).join(' · ') : ''}
                  {b.kind === 'study' ? course?.code : ''}
                  {b.kind === 'busy' ? t('block.busy') : ''}
                </span>
                <span className="agenda-time agenda-end num">{formatTime(b.end)}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
