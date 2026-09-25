import type { Assessment, Course } from '../lib/api'
import { formatNumber, formatTime, todayISO } from '../lib/format'
import { t } from '../lib/i18n'
import { relativeDue } from '../lib/labels'
import Icon from './Icon'

interface Props {
  item: Assessment
  course?: Course
  onToggle: () => void
  onOpen: () => void
}

export function DeadlineRow({ item, course, onToggle, onOpen }: Props) {
  const overdue = !item.done && item.due_date !== null && item.due_date < todayISO()
  return (
    <li className={`deadline${item.done ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}`}>
      <button
        type="button"
        className="tick"
        role="checkbox"
        aria-checked={item.done}
        aria-label={t('deadlines.markDone')}
        onClick={onToggle}
      >
        {item.done && <Icon name="check" size={14} />}
      </button>
      <button type="button" className="deadline-main" onClick={onOpen}>
        <span className="deadline-title">{item.title}</span>
        <span className="deadline-meta">
          <span className="swatch" style={{ background: course?.color }} />
          <span>{course?.code || course?.name}</span>
          <span className="faint">· {t(`akind.${item.kind}`)}</span>
          {item.weight !== null && <span className="faint">· {t('deadlines.weight', { n: formatNumber(item.weight, 1) })}</span>}
          {item.points_earned !== null && item.points_max !== null ? (
            <span className="faint num">
              · {formatNumber(item.points_earned, 2)} / {formatNumber(item.points_max, 2)}
            </span>
          ) : (
            item.score !== null && <span className="faint">· {t('deadlines.score', { n: formatNumber(item.score, 1) })}</span>
          )}
        </span>
      </button>
      {item.due_date && (
        <span className={`deadline-when${overdue ? ' danger-text' : ''}`}>
          {relativeDue(item.due_date)}
          {item.due_time && <span className="faint num"> {formatTime(item.due_time)}</span>}
        </span>
      )}
    </li>
  )
}
