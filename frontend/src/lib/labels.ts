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
