import { useState } from 'react'

interface Props {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  /** "any" for decimals such as 1.5 hours. */
  step?: number | 'any'
  unit: string
  label?: string
}

/** A number typed freely, with its unit shown inside the field ("min", "h"). An empty or
 * out-of-range value keeps the form from saving (the browser says why). */
export default function NumberField({ value, onChange, min, max, step = 1, unit, label }: Props) {
  const [text, setText] = useState(String(value))
  return (
    <span className="input-unit">
      <input
        className="input num"
        type="number"
        inputMode={step === 'any' ? 'decimal' : 'numeric'}
        dir="ltr"
        min={min}
        max={max}
        step={step}
        required
        aria-label={label}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const n = e.target.valueAsNumber
          if (Number.isFinite(n) && n >= min && n <= max) onChange(n)
        }}
      />
      <span className="faint" aria-hidden="true">
        {unit}
      </span>
    </span>
  )
}
