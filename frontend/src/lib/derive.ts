// Numbers the server works out (a course's progress, GPA and CGPA, the weekly study plan), worked out here too, so
// they stay right after a change made without a connection. These are ports of backend/app/grading.py,
// planner.py and routers/plan.py: keep them in step with those files.

import type { QueryClient } from '@tanstack/react-query'

import type { Assessment, Block, Busy, Course, Grades, Meeting, Plan, Progress, Scale, Term, TermGrades, User } from './api'

// ---- grading tables (grading.py) -------------------------------------------------------

export const SCALES: Record<Scale, Record<string, number>> = {
  '4': { 'A+': 4.0, A: 4.0, 'A-': 3.7, 'B+': 3.3, B: 3.0, 'B-': 2.7, 'C+': 2.3, C: 2.0, 'C-': 1.7, 'D+': 1.3, D: 1.0, F: 0.0 },
  '5': { 'A+': 5.0, A: 4.75, 'B+': 4.5, B: 4.0, 'C+': 3.5, C: 3.0, 'D+': 2.5, D: 2.0, F: 1.0 },
}
const DEFAULT_CUTOFFS: Record<Scale, Record<string, number>> = {
  '4': { 'A+': 97, A: 93, 'A-': 89, 'B+': 84, B: 80, 'B-': 76, 'C+': 73, C: 70, 'C-': 67, 'D+': 64, D: 60, F: 0 },
  '5': { 'A+': 95, A: 90, 'B+': 85, B: 80, 'C+': 75, C: 70, 'D+': 65, D: 60, F: 0 },
}
const DEFAULT_BANDS: Record<Scale, Record<string, number>> = {
  '4': { excellent: 3.7, very_good: 2.7, good: 2.0, pass: 1.0 },
  '5': { excellent: 4.5, very_good: 3.75, good: 2.75, pass: 2.0 },
}
const BANDS = ['excellent', 'very_good', 'good', 'pass'] as const
const FAILING = new Set(['F'])

export const cutoffsFor = (scale: Scale, custom?: Record<string, number>) => {
  const base = { ...DEFAULT_CUTOFFS[scale] }
  for (const [letter, value] of Object.entries(custom ?? {})) if (letter in base && letter !== 'F') base[letter] = Number(value)
  return base
}
export const pointsFor = (scale: Scale, custom?: Record<string, number>) => {
  const base = { ...SCALES[scale] }
  for (const [letter, value] of Object.entries(custom ?? {})) if (letter in base) base[letter] = Number(value)
  return base
}
export const bandsFor = (scale: Scale, custom?: Record<string, number>) => {
  const base = { ...DEFAULT_BANDS[scale] }
  for (const [band, value] of Object.entries(custom ?? {})) if (band in base) base[band] = Number(value)
  return base
}

/** What a settings change leaves in the signed-in user (the server answers with the same). */
export function resolveUser(me: User, patch: Partial<User>): User {
  const next = { ...me, ...patch } as User
  const scale = next.scale
  if (patch.scale && patch.scale !== me.scale) {
    // a new scale starts from its own defaults (the server also keeps matching custom letters; it corrects this on sync)
    next.cutoffs = cutoffsFor(scale, patch.cutoffs)
    next.points = pointsFor(scale, patch.points)
    next.bands = bandsFor(scale, patch.bands)
  } else {
    if (patch.cutoffs !== undefined) next.cutoffs = cutoffsFor(scale, patch.cutoffs)
    if (patch.points !== undefined) next.points = pointsFor(scale, patch.points)
    if (patch.bands !== undefined) next.bands = bandsFor(scale, patch.bands)
  }
  if (!(next.default_target in SCALES[scale])) next.default_target = 'A'
  return next
}

// ---- number helpers --------------------------------------------------------------------

/** Python's round(x, 2): half to even on exact ties (a tie is only exact for eighths such as 0.125). */
function round2(x: number) {
  const sign = x < 0 ? -1 : 1
  const a = Math.abs(x)
  if (Number.isInteger(a * 8) && !Number.isInteger(a * 4)) {
    const f = Math.floor(a * 100)
    return (sign * (f % 2 === 0 ? f : f + 1)) / 100
  }
  return Number(x.toFixed(2))
}
const round6 = (x: number) => Number(x.toFixed(6))

/** 3.49966 -> 3.499: cut, never rounded (the tiny epsilon absorbs float noise). */
export const truncateGpa = (value: number) => Math.floor(value * 1000 + 1e-9) / 1000
export const ceilGpa = (value: number) => Math.ceil(value * 1000 - 1e-9) / 1000

export function letterFor(percent: number, cutoffs: Record<string, number>) {
  const sorted = Object.entries(cutoffs).sort((a, b) => b[1] - a[1])
  for (const [letter, minimum] of sorted) if (percent >= minimum - 1e-9) return letter
  return 'F'
}

export function classify(gpa: number | null, bands: Record<string, number>): string | null {
  if (gpa === null) return null
  for (const band of BANDS) if (gpa >= bands[band] - 1e-9) return band
  return 'fail'
}

// ---- a course's progress (grading.course_progress + routers/courses.progress_for) ------

interface Core {
  graded_weight: number
  listed_weight: number
  earned: number
  remaining_weight: number
  current: number | null
  max_possible: number
  required: number | null
  status: Progress['status']
}

export function courseProgress(items: { weight: number | null; score: number | null }[], target: number): Core {
  let gradedWeight = 0
  let earned = 0
  let listed = 0
  for (const item of items) {
    if (!item.weight) continue
    listed += item.weight
    if (item.score !== null) {
      gradedWeight += item.weight
      earned += (item.weight * item.score) / 100
    }
  }
  const remaining = Math.max(0, 100 - gradedWeight)
  const current = gradedWeight ? (earned / gradedWeight) * 100 : null
  const required = remaining > 1e-9 ? ((target - earned) / remaining) * 100 : null
  const maxPossible = earned + remaining

  let status: Core['status']
  if (earned >= target - 1e-9) status = 'secured'
  else if (maxPossible < target - 1e-9) status = 'out_of_reach'
  else if (current === null) status = 'no_data'
  else if (required !== null && current >= required - 1e-9) status = 'on_track'
  else status = 'needs'
  return {
    graded_weight: round2(gradedWeight),
    listed_weight: round2(listed),
    earned: round2(earned),
    remaining_weight: round2(remaining),
    current: current !== null ? round2(current) : null,
    max_possible: round2(maxPossible),
    required: required !== null ? round2(Math.max(required, 0)) : null,
    status,
  }
}

export function progressFor(course: Course, items: Assessment[], user: User): Progress {
  const cutoffs = user.cutoffs
  let target = course.target_grade && course.target_grade in cutoffs ? course.target_grade : user.default_target
  if (!(target in cutoffs)) target = 'A'
  const p = courseProgress(items.map((a) => ({ weight: a.weight, score: a.score })), cutoffs[target])
  return {
    target_grade: target,
    target_percent: cutoffs[target],
    graded_weight: p.graded_weight,
    listed_weight: p.listed_weight,
    earned: p.earned,
    remaining_weight: p.remaining_weight,
    current: p.current,
    current_letter: p.current !== null ? letterFor(p.current, cutoffs) : null,
    max_possible: p.max_possible,
    max_letter: letterFor(p.max_possible, cutoffs),
    required: p.required,
    status: p.status,
  }
}

// ---- GPA and CGPA (routers/grades.py) --------------------------------------------------

function termResult(courses: Course[], table: Record<string, number>) {
  let points = 0
  let credits = 0
  let earned = 0
  for (const c of courses) {
    if (!c.grade) continue // still in progress
    if (!FAILING.has(c.grade) && c.grade !== 'W' && c.grade !== 'I') earned += c.credits
    if (c.in_gpa && c.grade in table) {
      points += table[c.grade] * c.credits
      credits += c.credits
    }
  }
  return { gpa: credits ? truncateGpa(points / credits) : null, gpa_credits: credits, earned_credits: earned, points }
}

export function computeGrades(terms: Term[], courses: Course[], user: User): Grades {
  const ordered = [...terms].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id - b.id)
  const table = user.points
  const bands = user.bands
  const rows: TermGrades[] = []
  let points = 0
  let credits = 0
  let earned = 0
  for (const term of ordered) {
    const mine = courses.filter((c) => c.term_id === term.id)
    const r = termResult(mine, table)
    const cgpaBefore = credits ? truncateGpa(points / credits) : null
    points += r.points
    credits += r.gpa_credits
    earned += r.earned_credits
    const cgpa = credits ? truncateGpa(points / credits) : null
    rows.push({
      term_id: term.id,
      name: term.name,
      start_date: term.start_date,
      gpa: r.gpa,
      gpa_credits: r.gpa_credits,
      cgpa_before: cgpaBefore,
      earned_credits: r.earned_credits,
      cgpa,
      gpa_class: classify(r.gpa, bands),
      cgpa_class: r.gpa !== null ? classify(cgpa, bands) : null,
      cumulative_credits: credits,
      cumulative_points: round6(points),
      in_progress: mine.filter((c) => !c.grade).length,
    })
  }
  const cgpa = credits ? truncateGpa(points / credits) : null
  return {
    scale: user.scale,
    terms: rows,
    cgpa,
    cgpa_class: credits ? classify(cgpa, bands) : null,
    total_credits: credits,
    earned_credits: earned,
    points: round6(points),
  }
}

// ---- the weekly study plan (planner.py + routers/plan.py) ------------------------------

const BUFFER = 15 // minutes kept free before and after a class or commitment
const GAP = 15 // minutes between two study sessions
const MIN_SESSION = 30
const ROOMY = 30 // a gap with less than this to spare around a session counts as a squeeze

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':')
  return Number(h) * 60 + Number(m)
}
export const toHHMM = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

interface Slot {
  weekday: number
  start: number
  end: number
}
type Interval = [number, number]

function subtract(free: Interval[], block: Interval): Interval[] {
  const [s, e] = block
  const out: Interval[] = []
  for (const [fs, fe] of free) {
    if (e <= fs || s >= fe) {
      out.push([fs, fe])
      continue
    }
    if (fs < s) out.push([fs, s])
    if (e < fe) out.push([e, fe])
  }
  return out
}

function freeTime(window: Interval, taken: Slot[], rest: Set<number>) {
  const free: Record<number, Interval[]> = {}
  for (let day = 0; day < 7; day++) {
    if (rest.has(day)) {
      free[day] = []
      continue
    }
    let intervals: Interval[] = [window]
    for (const slot of taken) {
      if (slot.weekday === day) intervals = subtract(intervals, [slot.start - BUFFER, slot.end + BUFFER])
    }
    free[day] = intervals
  }
  return free
}

/** Python tuple comparison: element by element, False before True. */
function lessKey(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}

function planWeek(
  needs: { course_id: number; credits: number }[],
  taken: Slot[],
  window: Interval,
  rest: Set<number>,
  hoursPerCredit: number,
  sessionMinutes: number,
  order: number[],
) {
  sessionMinutes = Math.max(MIN_SESSION, sessionMinutes)
  const free = freeTime(window, taken, rest)
  const sessions: { course_id: number; weekday: number; start: number; end: number }[] = []
  const unplaced: Record<number, number> = {}

  const lengths = new Map<number, number[]>()
  for (const need of needs) {
    const minutes = pyRound(need.credits * hoursPerCredit * 60)
    const full = Math.floor(minutes / sessionMinutes)
    const rem = minutes % sessionMinutes
    const chunks = Array<number>(full).fill(sessionMinutes)
    if (rem) chunks.push(Math.max(MIN_SESSION, Math.ceil(rem / 15) * 15))
    lengths.set(need.course_id, chunks)
  }

  // round-robin, biggest courses first
  const queue: [number, number][] = []
  const bySize = [...needs].sort((a, b) => b.credits - a.credits || a.course_id - b.course_id)
  while (bySize.some((n) => lengths.get(n.course_id)!.length)) {
    for (const n of bySize) {
      const list = lengths.get(n.course_id)!
      if (list.length) queue.push([n.course_id, list.shift()!])
    }
  }

  const load: Record<number, number> = {}
  for (let d = 0; d < 7; d++) load[d] = taken.filter((s) => s.weekday === d).reduce((sum, s) => sum + (s.end - s.start), 0)
  const daysWith = new Map<number, Set<number>>(needs.map((n) => [n.course_id, new Set<number>()]))

  for (const [courseId, length] of queue) {
    let best: { key: number[]; day: number; start: number } | null = null
    for (const day of order) {
      for (const [fs, fe] of free[day]) {
        if (fe - fs < length) continue
        const key = [
          daysWith.get(courseId)!.has(day) ? 1 : 0, // spread a course over different days
          fe - fs - length < ROOMY ? 1 : 0, // avoid squeezing into a tight gap
          load[day], // lighter days first
          order.indexOf(day),
          fs,
        ]
        if (best === null || lessKey(key, best.key)) best = { key, day, start: fs }
      }
    }
    if (best === null) {
      unplaced[courseId] = (unplaced[courseId] ?? 0) + length
      continue
    }
    const end = best.start + length
    sessions.push({ course_id: courseId, weekday: best.day, start: best.start, end })
    free[best.day] = subtract(free[best.day], [best.start, end + GAP])
    load[best.day] += length
    daysWith.get(courseId)!.add(best.day)
  }
  sessions.sort((a, b) => order.indexOf(a.weekday) - order.indexOf(b.weekday) || a.start - b.start)
  return { sessions, unplaced }
}

/** Python's round() on a whole-number-ish value: half to even. */
function pyRound(x: number) {
  const f = Math.floor(x)
  const diff = x - f
  if (diff === 0.5) return f % 2 === 0 ? f : f + 1
  return Math.round(x)
}

/** Who gives a class: the TA of a section / lab; the doctor of a lecture (the course's main one unless set). */
const leader = (c: Course, m: Meeting) => m.ta || (m.kind === 'lecture' ? c.instructor : '')

export function buildPlan(term: Term, courses: Course[], busy: Busy[], user: User): Plan {
  const byId = new Map(courses.map((c) => [c.id, c]))
  const order = Array.from({ length: 7 }, (_, i) => (user.week_start + i) % 7)
  const blocks: Block[] = []
  const tagged: { index: number; slot: Slot }[] = []
  // the server reads the classes in the order they were saved (by id); ones made offline have negative ids and go last
  const meetings = courses.flatMap((c) => c.meetings.map((m) => ({ c, m })))
  const rank = (m: { id?: number }) => (m.id !== undefined && m.id > 0 ? [0, m.id] : [1, -(m.id ?? 0)])
  meetings.sort((x, y) => {
    const a = rank(x.m)
    const b = rank(y.m)
    return a[0] - b[0] || a[1] - b[1]
  })
  for (const { c, m } of meetings) {
    blocks.push({
      kind: 'class',
      weekday: m.weekday,
      start: m.start,
      end: m.end,
      course_id: c.id,
      ref_id: m.id ?? null,
      title: c.code || c.name,
      detail: [m.kind, m.location, leader(c, m)].filter(Boolean).join(' · '),
      color: null,
    })
    tagged.push({ index: blocks.length - 1, slot: { weekday: m.weekday, start: toMinutes(m.start), end: toMinutes(m.end) } })
  }
  const busyInOrder = [...busy].sort((x, y) => rank(x)[0] - rank(y)[0] || rank(x)[1] - rank(y)[1])
  for (const b of busyInOrder) {
    blocks.push({
      kind: 'busy',
      weekday: b.weekday,
      start: b.start,
      end: b.end,
      course_id: null,
      ref_id: b.id,
      title: b.title,
      detail: '',
      color: b.color,
    })
    tagged.push({ index: blocks.length - 1, slot: { weekday: b.weekday, start: toMinutes(b.start), end: toMinutes(b.end) } })
  }

  // overlapping classes / commitments, found before the list is sorted (they point into it by position)
  const overlaps: { a: Block; b: Block }[] = []
  tagged.forEach((x, i) => {
    for (const y of tagged.slice(i + 1)) {
      if (x.slot.weekday === y.slot.weekday && x.slot.start < y.slot.end && y.slot.start < x.slot.end) {
        overlaps.push({ a: blocks[x.index], b: blocks[y.index] })
      }
    }
  })

  const result = planWeek(
    courses.filter((c) => c.grade === null).map((c) => ({ course_id: c.id, credits: c.credits })),
    tagged.map((x) => x.slot),
    [toMinutes(term.study_start), toMinutes(term.study_end)],
    new Set(term.rest_days),
    term.hours_per_credit,
    term.session_minutes,
    order,
  )
  for (const s of result.sessions) {
    const c = byId.get(s.course_id)!
    blocks.push({
      kind: 'study',
      weekday: s.weekday,
      start: toHHMM(s.start),
      end: toHHMM(s.end),
      course_id: c.id,
      ref_id: null,
      title: c.code || c.name,
      detail: '',
      color: null,
    })
  }
  blocks.sort((a, b) => order.indexOf(a.weekday) - order.indexOf(b.weekday) || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const minutes = (kind: Block['kind']) =>
    blocks.filter((b) => b.kind === kind).reduce((sum, b) => sum + toMinutes(b.end) - toMinutes(b.start), 0)
  return {
    term_id: term.id,
    blocks,
    conflicts: overlaps,
    unplaced: Object.fromEntries(Object.entries(result.unplaced).map(([k, v]) => [k, v])),
    study_minutes: minutes('study'),
    class_minutes: minutes('class'),
  }
}

// ---- keeping the saved copy in step ------------------------------------------------------

const listOf = <T>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : data ? [data as T] : [])

/** After a change made offline: work out again whatever the server works out, from what this device has saved.
 * Only what the saved data fully covers is touched; the rest is corrected when the connection is back. */
export function refreshDerived(qc: QueryClient) {
  const me = qc.getQueryData<User>(['me'])
  if (!me) return
  const terms = qc.getQueryData<Term[]>(['terms'])

  const courses = new Map<number, Course>()
  for (const [, data] of qc.getQueriesData<unknown>({ queryKey: ['courses'] })) for (const c of listOf<Course>(data)) courses.set(c.id, c)
  const assessmentLists = qc.getQueriesData<Assessment[]>({ queryKey: ['assessments'] })

  // 1. each course's progress, when all of its items are saved (its own list, or its term's list)
  const keyed = (kind: string, id: number) => assessmentLists.find(([k]) => k[1] === kind && k[2] === id)?.[1]
  const itemsOf = (c: Course): Assessment[] | null => {
    const own = keyed('course', c.id)
    if (own) return own.filter((a) => a.course_id === c.id)
    const term = keyed('term', c.term_id)
    return term ? term.filter((a) => a.course_id === c.id) : null
  }
  for (const [key, data] of qc.getQueriesData<unknown>({ queryKey: ['courses'] })) {
    if (!data) continue
    const fix = (c: Course) => {
      const items = itemsOf(c)
      return items ? { ...c, progress: progressFor(c, items, me) } : c
    }
    qc.setQueryData(key, Array.isArray(data) ? (data as Course[]).map(fix) : fix(data as Course))
  }

  // 2. GPA / CGPA, when every term's courses are saved
  const fresh = new Map<number, Course>()
  for (const [, data] of qc.getQueriesData<unknown>({ queryKey: ['courses'] })) for (const c of listOf<Course>(data)) fresh.set(c.id, c)
  const hasCourses = (termId: number) =>
    !!qc.getQueryData(['courses', 'all']) || !!qc.getQueryData(['courses', termId])
  if (terms && qc.getQueryData(['grades']) && terms.every((t) => hasCourses(t.id))) {
    qc.setQueryData(['grades'], computeGrades(terms, [...fresh.values()], me))
  }

  // 3. each saved study plan, when the term's courses and commitments are saved
  for (const [key] of qc.getQueriesData<Plan>({ queryKey: ['plan'] })) {
    const termId = key[1] as number
    const term = terms?.find((t) => t.id === termId)
    const busy = qc.getQueryData<Busy[]>(['busy', termId])
    if (!term || !busy || !hasCourses(termId)) continue
    qc.setQueryData(['plan', termId], buildPlan(term, [...fresh.values()].filter((c) => c.term_id === termId), busy, me))
  }
}
