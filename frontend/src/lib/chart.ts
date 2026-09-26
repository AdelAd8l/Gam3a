// Helpers shared by the hand-drawn SVG charts.

import { locale } from './i18n'

/** Mirrors x positions (and text anchors) for right-to-left pages. The SVG itself stays
 * left-to-right so its geometry is plain; only where things go is flipped. */
export function mirror(W: number) {
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl'
  return {
    rtl,
    /** a point */
    x: (x: number) => (rtl ? W - x : x),
    /** the left edge of something `w` wide that starts at `x` */
    box: (x: number, w: number) => (rtl ? W - x - w : x),
    anchor: (a: 'start' | 'end' | 'middle') => (rtl && a !== 'middle' ? (a === 'start' ? 'end' : 'start') : a),
    /** keep "3 آلاف" in reading order inside the left-to-right SVG */
    text: (s: string) => (rtl ? `\u2067${s}\u2069` : s),
  }
}

export type Mirror = ReturnType<typeof mirror>

/** 1.2K / 3 آلاف: short numbers for axis ticks. */
export const compact = (v: number) => new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(v)

/** "1 س و30 د" has words: shown as text, not forced left to right like a plain number. */
export const hasWords = (s: string) => /[\u0600-\u06FF]/.test(s)

/** The class for a value: plain numbers line up as numbers; values with words read as text. */
export const numClass = (s: string) => (hasWords(s) ? undefined : 'num')
