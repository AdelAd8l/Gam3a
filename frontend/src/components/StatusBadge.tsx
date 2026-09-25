import type { Progress } from '../lib/api'
import { t, type Key } from '../lib/i18n'

const LABELS: Record<Progress['status'], Key | null> = {
  secured: 'course.statusSecured',
  on_track: 'course.statusOnTrack',
  needs: 'course.statusNeeds',
  out_of_reach: 'course.statusOut',
  no_data: null,
}

export default function StatusBadge({ status }: { status: Progress['status'] }) {
  const label = LABELS[status]
  return label ? <span className={`status status-${status}`}>{t(label)}</span> : null
}
