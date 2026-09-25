// Date, time and number helpers. Output follows the current app language.

import type { Term } from './api'
import { locale } from './i18n'

const pad = (n: number) => String(n).padStart(2, '0')

export function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const todayISO = () => isoDate(new Date())

export function parseISO(iso: string) {
  return new Date(`${iso}T00:00:00`)
}

export function addDays(iso: string, days: number) {
  const d = parseISO(iso)
  d.setDate(d.getDate() + days)
  return isoDate(d)
}

export function daysBetween(a: string, b: string) {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86_400_000)
}

/** Weekday used by the API: 0 = Monday … 6 = Sunday. */
export const weekdayOf = (iso: string) => (parseISO(iso).getDay() + 6) % 7

/** The 7 weekdays in the user's order, e.g. Saturday first. */
export const weekOrder = (weekStart: number) => Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7)

export function weekdayName(weekday: number, style: 'long' | 'short' = 'long') {
  // 2024-01-01 was a Monday.
  return new Date(2024, 0, 1 + weekday).toLocaleDateString(locale(), { weekday: style })
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export const fromMinutes = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`

/** "10:00" → "10:00 AM" / "10:00 ص" */
export function formatTime(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(2024, 0, 1, h, m).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
}

export const timeRange = (start: string, end: string) => `${formatTime(start)} – ${formatTime(end)}`

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  return parseISO(iso).toLocaleDateString(locale(), opts)
}

export function longDate(iso: string) {
  return formatDate(iso, { weekday: 'long', month: 'long', day: 'numeric' })
}

// GPAs are cut, never rounded, to 3 decimals: 3.4996 is 3.499, not 3.50.
// The tiny epsilon absorbs float noise (3.49 is stored as 3.48999…).
export const truncateGpa = (gpa: number) => Math.floor(gpa * 1000 + 1e-9) / 1000

const gpaFormat = () => new Intl.NumberFormat(locale(), { minimumFractionDigits: 3, maximumFractionDigits: 3 })

export function formatGpa(gpa: number | null | undefined) {
  if (gpa === null || gpa === undefined) return '—'
  return gpaFormat().format(truncateGpa(gpa))
}

/** For "you need at least X": round up so the target is never missed by a hair. */
export function formatGpaAtLeast(gpa: number) {
  return gpaFormat().format(Math.ceil(gpa * 1000 - 1e-9) / 1000)
}

export function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(value)
}

// ---- terms ----------------------------------------------------------------------

export type TermStatus = 'current' | 'upcoming' | 'past'

export function termStatus(term: Term, today = todayISO()): TermStatus {
  if (today < term.start_date) return 'upcoming'
  if (today > term.end_date) return 'past'
  return 'current'
}

/** The term to open by default: the one running today, else the next, else the latest. */
export function pickDefaultTerm(terms: Term[]): Term | undefined {
  const today = todayISO()
  return (
    terms.find((t) => termStatus(t, today) === 'current') ??
    terms.find((t) => termStatus(t, today) === 'upcoming') ??
    terms[terms.length - 1]
  )
}

export function termWeek(term: Term, today = todayISO()) {
  const total = Math.max(1, Math.ceil((daysBetween(term.start_date, term.end_date) + 1) / 7))
  const current = Math.min(total, Math.max(0, Math.floor(daysBetween(term.start_date, today) / 7) + 1))
  return { current, total }
}

// ---- grades ---------------------------------------------------------------------

export const GRADES: Record<'4' | '5', string[]> = {
  '4': ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F'],
  '5': ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D+', 'D', 'F'],
}

export const SPECIAL_GRADES = ['P', 'W', 'I']

export const POINTS: Record<'4' | '5', Record<string, number>> = {
  '4': { 'A+': 4, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, F: 0 },
  '5': { 'A+': 5, A: 4.75, 'B+': 4.5, B: 4, 'C+': 3.5, C: 3, 'D+': 2.5, D: 2, F: 1 },
}

/** A saved course as the payload the API expects when saving it again. */
export function courseInput(c: import('./api').Course): import('./api').CourseInput {
  return {
    term_id: c.term_id,
    code: c.code,
    name: c.name,
    credits: c.credits,
    instructor: c.instructor,
    color: c.color,
    grade: c.grade,
    in_gpa: c.in_gpa,
    target_grade: c.target_grade,
    meetings: c.meetings.map(({ weekday, start, end, kind, location }) => ({ weekday, start, end, kind, location })),
  }
}
