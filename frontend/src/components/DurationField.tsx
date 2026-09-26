import { durationLabel } from '../lib/format'
import { t } from '../lib/i18n'

interface Props {
  /** The length in minutes. */
  minutes: number
  onChange: (minutes: number) => void
  min: number
  /** 12 hours at most: the phone's time picker, like the one for class times, stops at 12:00. */
  max?: number
  label: string
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(Math.round(minutes) % 60).padStart(2, '0')}`

/** A length picked with the same time box as class times: hours:minutes, up to 12:00. On a
 * phone set to a 12-hour clock the box also shows AM/PM, so the length is spelled out under it. */
export default function DurationField({ minutes, onChange, min, max = 12 * 60, label }: Props) {
  return (
    <div className="duration-field">
      <input
        className="input"
        type="time"
        dir="ltr"
        aria-label={label}
        value={hhmm(minutes)}
        min={hhmm(min)}
        max={hhmm(max)}
        required
        onChange={(e) => {
          const [h, m] = e.target.value.split(':').map(Number)
          if (Number.isFinite(h) && Number.isFinite(m)) {
            const total = h * 60 + m
            if (total >= min && total <= max) onChange(total)
          }
        }}
      />
      <small className="faint">{t('duration.is', { d: durationLabel(Math.round(minutes)) })}</small>
    </div>
  )
}
