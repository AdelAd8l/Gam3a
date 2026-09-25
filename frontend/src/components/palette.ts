// Muted, print-like course colors that read well on the paper background in both themes.
export const PALETTE = [
  '#3E5C8A', '#4E7D5B', '#8A5A3E', '#7A4E8A', '#9A7B2F', '#3F7F86',
  '#A0525B', '#5A6FA8', '#6B7B4A', '#B06A3B', '#56607A', '#8A8F98',
]

/** "#3e5c8a", "3E5C8A" or "#f80" -> "#3E5C8A" / "#FF8800"; anything else -> null. */
export function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(s)) return `#${[...s].map((c) => c + c).join('')}`.toUpperCase()
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s}`.toUpperCase()
  return null
}
