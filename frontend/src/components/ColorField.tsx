import { useState } from 'react'

import { t } from '../lib/i18n'
import { normalizeHex, PALETTE } from './palette'

const inPalette = (color: string) => PALETTE.some((c) => c.toLowerCase() === color.toLowerCase())

interface Props {
  value: string
  onChange: (color: string) => void
}

/** A course color: one of the suggested colors, or any color from the wheel or a hex code. */
export default function ColorField({ value, onChange }: Props) {
  const [mode, setMode] = useState<'preset' | 'custom'>(inPalette(value) ? 'preset' : 'custom')
  const [text, setText] = useState(value.toUpperCase())
  const valid = normalizeHex(text) !== null

  const pick = (color: string) => {
    onChange(color)
    setText(color.toUpperCase())
  }

  return (
    <fieldset className="field palette">
      <legend>{t('courses.color')}</legend>
      <div className="segmented color-mode" role="group" aria-label={t('courses.color')}>
        <button type="button" aria-pressed={mode === 'preset'} onClick={() => setMode('preset')}>
          {t('courses.colorPreset')}
        </button>
        <button type="button" aria-pressed={mode === 'custom'} onClick={() => setMode('custom')}>
          {t('courses.colorCustom')}
        </button>
      </div>

      {mode === 'preset' ? (
        <div className="palette-grid">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className="palette-chip"
              style={{ background: c }}
              aria-label={c}
              aria-pressed={value.toLowerCase() === c.toLowerCase()}
              onClick={() => pick(c)}
            />
          ))}
        </div>
      ) : (
        <div className="color-custom">
          <label className="color-wheel">
            <input
              type="color"
              value={value.toLowerCase()}
              aria-label={t('courses.colorWheel')}
              onChange={(e) => pick(e.target.value.toUpperCase())}
            />
            <span>{t('courses.colorWheel')}</span>
          </label>
          <label className="color-hex">
            <span className="visually-hidden">{t('courses.colorHex')}</span>
            <input
              className="input"
              dir="ltr"
              inputMode="text"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={7}
              placeholder="#3E5C8A"
              aria-invalid={!valid}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                const hex = normalizeHex(e.target.value)
                if (hex) onChange(hex)
              }}
              onBlur={() => setText(normalizeHex(text) ?? value.toUpperCase())}
            />
          </label>
          {!valid && <small className="danger-text color-hint">{t('courses.colorHexInvalid')}</small>}
        </div>
      )}
    </fieldset>
  )
}
