/** Gam3a's mark: a little timetable, three blocks on a week grid. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--accent)" />
      <g fill="var(--accent-ink)">
        <rect x="7" y="7" width="8" height="7" rx="1.6" />
        <rect x="17" y="7" width="8" height="12" rx="1.6" opacity="0.55" />
        <rect x="7" y="16" width="8" height="9" rx="1.6" opacity="0.55" />
        <rect x="17" y="21" width="8" height="4" rx="1.6" />
      </g>
    </svg>
  )
}

export default function Logo({ size = 22 }: { size?: number }) {
  return (
    <span className="logo">
      <Mark size={size} />
      <span>Gam3a</span>
    </span>
  )
}
