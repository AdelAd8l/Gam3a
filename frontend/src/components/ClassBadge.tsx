import { t } from '../lib/i18n'
import type { Band } from '../lib/labels'

/** Excellent / Very good / Good / Pass / Fail for a GPA. */
export default function ClassBadge({ band }: { band: string | null | undefined }) {
  if (!band) return null
  return <span className={`class-badge class-${band}`}>{t(`class.${band as Band}`)}</span>
}
