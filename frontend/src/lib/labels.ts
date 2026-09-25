// Small label helpers shared by several components.

import { daysBetween, formatDate, formatNumber, todayISO } from './format'
import { t } from './i18n'

/** "lab · Electronics Lab" → "Lab · Electronics Lab" in the current language. */
export function blockDetail(detail: string) {
  const [kind, ...rest] = detail.split(' · ')
  const known = ['lecture', 'lab', 'section', 'tutorial'].includes(kind)
  const label = known ? t(`kind.${kind as 'lecture'}`) : kind
  return [label, ...rest].join(' · ')
}

export function relativeDue(iso: string, today = todayISO()) {
  const diff = daysBetween(today, iso)
  if (diff === 0) return t('deadlines.today')
  if (diff === 1) return t('deadlines.tomorrow')
  if (diff === -1) return t('deadlines.yesterday')
  if (diff > 1 && diff < 7) return t('deadlines.inDays', { n: formatNumber(diff) })
  if (diff < -1 && diff > -7) return t('deadlines.daysAgo', { n: formatNumber(-diff) })
  return formatDate(iso, { weekday: 'short', month: 'short', day: 'numeric' })
}

// ---- GPA classification -----------------------------------------------------------

export const BANDS = ['excellent', 'very_good', 'good', 'pass', 'fail'] as const
export type Band = (typeof BANDS)[number]

/** Letters whose grade points fall in a band, e.g. Excellent → A+, A, A-. */
export function bandLetters(
  band: Band,
  index: number,
  limits: Record<string, number>,
  points: Record<string, number>,
  letters: string[],
): string[] {
  const low = band === 'fail' ? -Infinity : limits[band]
  const high = index === 0 ? Infinity : limits[BANDS[index - 1]]
  return letters.filter((g) => points[g] >= low - 1e-9 && points[g] < high - 1e-9)
}
