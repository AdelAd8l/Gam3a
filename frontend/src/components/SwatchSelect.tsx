import type { SelectHTMLAttributes } from 'react'

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  /** The chosen item's color, shown at the start of the field; none for "All …". */
  color?: string
}

/** A select for a course, account or category that shows the chosen one's color. A phone's own
 * list of options can't be colored, but the closed field can. */
export default function SwatchSelect({ color, className = 'select', ...props }: Props) {
  return (
    <span
      className={`swatch-select${color ? ' has-swatch' : ''}${className.includes('select-auto') ? ' is-auto' : ''}`}
      style={color ? ({ '--c': color } as React.CSSProperties) : undefined}
    >
      <select className={className} {...props} />
    </span>
  )
}
