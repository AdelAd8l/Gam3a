import { t } from '../lib/i18n'

interface Props {
  /** The length in minutes. */
  minutes: number
  onChange: (minutes: number) => void
  min: number
  max: number
  label: string
}

const STEP = 5 // minutes

/** A length picked as hours + minutes from two lists. Choices outside min..max are greyed out;
 * picking an hour that would go out of range moves the minutes to the nearest allowed value. */
export default function DurationField({ minutes, onChange, min, max, label }: Props) {
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  const hourChoices = Array.from({ length: Math.floor(max / 60) + 1 }, (_, i) => i)
  // Every 5 minutes, plus the current value if it was saved off that grid (e.g. 97 min).
  const minuteChoices = [...new Set([...Array.from({ length: 60 / STEP }, (_, i) => i * STEP), m])].sort((a, b) => a - b)
  const fits = (hours: number, mins: number) => hours * 60 + mins >= min && hours * 60 + mins <= max
  const clamp = (v: number) => Math.min(max, Math.max(min, v))

  return (
    <div className="duration-field" role="group" aria-label={label}>
      <select
        className="select"
        aria-label={`${label} · ${t('duration.hours')}`}
        value={h}
        onChange={(e) => onChange(clamp(Number(e.target.value) * 60 + m))}
      >
        {hourChoices.map((n) => (
          <option key={n} value={n} disabled={!minuteChoices.some((mm) => fits(n, mm))}>
            {t('time.h', { h: n })}
          </option>
        ))}
      </select>
      <select
        className="select"
        aria-label={`${label} · ${t('duration.minutes')}`}
        value={m}
        onChange={(e) => onChange(clamp(h * 60 + Number(e.target.value)))}
      >
        {minuteChoices.map((n) => (
          <option key={n} value={n} disabled={!fits(h, n)}>
            {t('time.m', { m: n })}
          </option>
        ))}
      </select>
    </div>
  )
}
