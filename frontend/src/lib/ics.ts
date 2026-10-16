// The calendar download (backend/app/routers/plan.py, calendar()) built on the phone from what it has saved, for
// when there is no connection.

import type { QueryClient } from '@tanstack/react-query'

import type { Assessment, Course, Plan, Term } from './api'

// oxlint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x09\x0b-\x1f\x7f]/g // every control character except the line break

const esc = (text: string) =>
  text.replace(CONTROL, '').replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll(',', '\\,').replaceAll('\n', '\\n')

const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
const ymd = (d: Date) => d.toISOString().slice(0, 10).replaceAll('-', '')
const mondayBased = (d: Date) => (d.getUTCDay() + 6) % 7

/** The file's text and name, or null when this device has not saved what the file needs. */
export function calendarFromDevice(qc: QueryClient, termId: number, study: boolean) {
  const term = qc.getQueryData<Term[]>(['terms'])?.find((t) => t.id === termId)
  const plan = qc.getQueryData<Plan>(['plan', termId])
  const courseList = qc.getQueryData<Course[]>(['courses', termId])
  const items = qc.getQueryData<Assessment[]>(['assessments', 'term', termId])
  if (!term || !plan || !courseList || !items) return null
  const courses = new Map(courseList.map((c) => [c.id, c]))
  const now = new Date()
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const until = `${ymd(day(term.end_date))}T235959Z`

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gam3a//Planner//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(term.name)}`]
  plan.blocks.forEach((b, i) => {
    if (b.kind === 'busy' || (b.kind === 'study' && !study)) return
    const start = day(term.start_date)
    start.setUTCDate(start.getUTCDate() + (((b.weekday - mondayBased(start)) % 7) + 7) % 7)
    const course = b.course_id !== null ? courses.get(b.course_id) : undefined
    const name = course ? course.name : b.title
    const summary = b.kind === 'class' ? `${name} (${b.detail.split(' · ')[0]})` : `Study: ${name}`
    lines.push(
      'BEGIN:VEVENT',
      `UID:gam3a-${term.id}-${b.kind}-${i}@gam3a`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${ymd(start)}T${b.start.replace(':', '')}00`,
      `DTEND:${ymd(start)}T${b.end.replace(':', '')}00`,
      `RRULE:FREQ=WEEKLY;UNTIL=${until}`,
      `SUMMARY:${esc(summary)}`,
    )
    if (b.kind === 'class' && b.detail.includes(' · ')) lines.push(`LOCATION:${esc(b.detail.slice(b.detail.indexOf(' · ') + 3))}`)
    lines.push('END:VEVENT')
  })
  for (const a of [...items].sort((x, y) => x.id - y.id)) {
    if (!a.due_date) continue
    const mine = a.course_id !== null ? courses.has(a.course_id) : a.due_date >= term.start_date && a.due_date <= term.end_date
    if (!mine) continue
    const course = a.course_id !== null ? courses.get(a.course_id) : undefined
    lines.push('BEGIN:VEVENT', `UID:gam3a-assessment-${a.id}@gam3a`, `DTSTAMP:${stamp}`)
    if (a.due_time) lines.push(`DTSTART:${a.due_date.replaceAll('-', '')}T${a.due_time.replace(':', '')}00`)
    else {
      const next = day(a.due_date)
      next.setUTCDate(next.getUTCDate() + 1)
      lines.push(`DTSTART;VALUE=DATE:${a.due_date.replaceAll('-', '')}`, `DTEND;VALUE=DATE:${ymd(next)}`)
    }
    lines.push(`SUMMARY:${esc(course ? `${a.title} — ${course.code || course.name}` : a.title)}`, 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  // the file name can only carry plain letters and digits
  const name = [...term.name].map((ch) => (/^[A-Za-z0-9]$/.test(ch) ? ch : '-')).join('').replace(/^-+|-+$/g, '') || 'term'
  return { text: lines.join('\r\n') + '\r\n', name: `${name}.ics` }
}

export function saveText(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
